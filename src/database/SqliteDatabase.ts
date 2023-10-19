import sqlite3InitModule, { Database, SqlValue } from '@sqlite.org/sqlite-wasm';
import { hasIntersection, parseTestTableNames } from './parseTableNames';
import { Observable, from, share, switchMap, throttle } from 'rxjs';
import { RecordMap, RecordTable, schema } from './schema';
import { upsertRecordSql } from './upsertRecordSql';

const modulePromise = sqlite3InitModule({
  print: console.log,
  printErr: console.error,
});

export class SQLiteClient {
  static async init() {
    const sqlite3 = await modulePromise;
    const db = new sqlite3.oo1.DB(':memory:');
    db.exec({ sql: schema });
    return new SQLiteClient(db);
  }

  private changeSubscriptions = new Set<(change: DatabaseChange) => void>();

  private constructor(private db: Database) {}

  async exec<T = { [columnName: string]: SqlValue }>(
    args: SQLiteClientExecProps
  ): Promise<{ resultRows: T[] }> {
    // Worth noting that this is actually a synchronous operation since we're
    // using the synchronous build of sqlite. But we don't want to commit to
    // using the sync build so we wrap this method in a promise.
    const res = this.db.exec({
      sql: args.sql,
      bind: args.bind,
      returnValue: 'resultRows',
      rowMode: 'object',
    });

    return {
      resultRows: res as T[],
    };
  }

  /**
   * @returns an object with runQuery and subscribe methods.
   *   - runQuery will run an async query returning the specified record or null.
   *   - subscribe recieves an onChange callback that will be called whenever the
   *     runQuery result changes in the database. It returns an unsubscribe function.
   *     Use runQuery inside the onChange callback to get the current query results.
   */
  liveRecord(table: RecordTable, id: string) {
    const runQuery = async () => {
      const { resultRows } = await this.exec({
        sql: `SELECT * FROM ${table} WHERE ${table}.id = $1 LIMIT 1`,
        bind: { $1: id },
      });

      return resultRows[0] || null;
    };

    return {
      runQuery,
      subscribe: (onChange: () => void) =>
        this.subscribeToRowChanges(({ changes }) => {
          if (!(table in changes) || !(id in changes[table])) return;
          onChange();
        }),
    };
  }

  /**
   * Same as liveRecord except returns an Observable for the query.
   * The observable version has backpressure support which the liveRecord
   * version doesn't have out of the box (you'd need to build it on
   * top of the liveRecord version).
   */
  observeRecord(table: RecordTable, id: string) {
    const runQuery = async () => {
      const { resultRows } = await this.exec({
        sql: `SELECT * FROM ${table} WHERE ${table}.id = $1 LIMIT 1`,
        bind: { $1: id },
      });

      return resultRows[0] || null;
    };

    const subscribeToQuery = (onChange: () => void) =>
      this.subscribeToRowChanges(({ changes }) => {
        if (!(table in changes) || !(id in changes[table])) return;
        onChange();
      });

    return observable({
      runQuery,
      subscribeToQuery,
    });
  }

  /**
   * @returns an object with runQuery and subscribe methods.
   *   - runQuery will run an async query returning the current query results.
   *   - subscribe recieves an onChange callback that will be called whenever the
   *     runQuery result may have changed in the database. `onChange` will likely
   *     be called more times than necessary. It returns an unsubscribe
   *     function. Use runQuery inside the onChange callback to get the current
   *     query results.
   */
  liveQuery(statement: { sql: string; values: any[] }) {
    const affectedTableNames = parseTestTableNames(statement.sql);

    if (affectedTableNames.length === 0) {
      throw new Error('Could not calculate selected table names');
    }

    const runQuery = () =>
      this.exec({ sql: statement.sql, bind: statement.values });

    return {
      runQuery,
      subscribe: (onChange: () => void) =>
        this.subscribeToRowChanges(({ tableNames }) => {
          if (!hasIntersection(affectedTableNames, tableNames)) return;
          onChange();
        }),
    };
  }

  /**
   * Same as liveQuery except returns an Observable for the query.
   * The observable version has backpressure support which the liveQuery
   * version doesn't have out of the box (you'd need to build it on
   * top of the liveQuery version).
   */
  observeQuery(statement: { sql: string; values: any[] }) {
    const affectedTableNames = parseTestTableNames(statement.sql);

    if (affectedTableNames.length === 0) {
      throw new Error('Could not calculate selected table names');
    }

    const runQuery = () =>
      this.exec({ sql: statement.sql, bind: statement.values });

    const subscribeToQuery = (onChange: () => void) =>
      this.subscribeToRowChanges(({ tableNames }) => {
        if (!hasIntersection(affectedTableNames, tableNames)) return;
        onChange();
      });

    return observable({
      runQuery,
      subscribeToQuery,
    });
  }

  async writeRecordMap(recordMap: RecordMap) {
    this.db.transaction((db) => {
      for (const [table, rows] of Object.entries(recordMap)) {
        for (const row of Object.values(rows)) {
          const query = upsertRecordSql(table as RecordTable, row);

          db.exec({
            sql: query.sql,
            bind: query.values as any[],
            returnValue: 'resultRows',
            rowMode: 'object',
          });
        }
      }
    });

    this.emitTableChanges({
      tableNames: Object.keys(recordMap),
      changes: recordMap,
    });
  }

  subscribeToRowChanges(callback: (change: DatabaseChange) => void) {
    this.changeSubscriptions.add(callback);

    return () => {
      this.changeSubscriptions.delete(callback);
    };
  }

  private emitTableChanges(change: DatabaseChange) {
    console.log('Database changes:', change);

    for (const callback of this.changeSubscriptions) {
      callback(change);
    }
  }
}

function observable(args: {
  runQuery: () => Promise<SQLiteClientExecResult>;
  subscribeToQuery: (onChanges: () => void) => () => void;
}) {
  const { runQuery, subscribeToQuery } = args;

  let query: Promise<SQLiteClientExecResult>;

  return new Observable((subscriber) => {
    const unsubscribe = subscribeToQuery(async () => subscriber.next(null));
    subscriber.next(null);

    return () => {
      unsubscribe();
    };
  }).pipe(
    // If the Observable's `subscribeToQuery` onChanges callback fired, and
    // then the observable ran the query again in switchMap (below), if the
    // `subscribeToQuery#onChanges` callback fired again before `runQuery`
    // had finished processing then the result of the previous run would
    // be discarded and the query execution would restart. Potentially,
    // this cycle could happen repeatedly causing this observable to never
    // re-emit. Or, more practically, it could just delay emission of the
    // the query. We throttle the onChanges emissions to ensure that we
    // a query being processed currently has a chance to complete. By
    // using `trailing` true, we ensure that we also always get the
    // latest values.
    throttle(
      () => {
        // This works because we have `leading: true` so emitted values
        // first pass through `throttle` (triggering switchMap) before
        // this factory function is called (confirmed expirimentally).
        return from(query);
      },
      {
        leading: true,
        trailing: true,
      }
    ),
    switchMap(() => {
      query = runQuery();
      return query;
    }),
    share({ resetOnRefCountZero: true })
  );
}

interface DatabaseChange {
  tableNames: string[];
  changes: RecordMap;
}

type SQLiteClientExecProps = {
  sql: string;
  /**
   * Binds one or more values to its bindable parameters. It accepts 1 or 2 arguments:
   *
   * If passed a single argument, it must be either an array, an object, or a value of
   * a bindable type (see below). Its bind index is assumed to be 1.
   *
   * If passed 2 arguments, the first one is the 1-based bind index or bindable
   * parameter name and the second one must be a value of a bindable type.
   *
   * Bindable value types:
   * - null is bound as NULL.
   * - undefined as a standalone value is a no-op: passing undefined as a value to this
   *   function will not actually bind anything and this function will skip confirmation
   *   that binding is even legal. (Those semantics simplify certain client-side uses.)
   *   Conversely, a value of undefined as an array or object property when binding an
   *   array/object (see below) is treated the same as null.
   * - Numbers are bound as either doubles or integers: doubles if they are larger than
   *   32 bits, else double or int32, depending on whether they have a fractional part.
   *   Booleans are bound as integer 0 or 1. It is not expected the distinction of
   *   binding doubles which have no fractional parts as integers is significant for the
   *   majority of clients due to sqlite3's data typing model. If BigInt support is
   *   enabled then this routine will bind BigInt values as 64-bit integers if they'll
   *   fit in 64 bits. If that support is disabled, it will store the BigInt as an int32
   *   or a double if it can do so without loss of precision. In either case, if a BigInt
   *   is too BigInt then it will throw.
   * - Strings are bound as strings (use bindAsBlob() to force blob binding).
   * - Uint8Array, Int8Array, and ArrayBuffer instances are bound as blobs.
   *
   * If passed an array, each element of the array is bound at the parameter index equal
   * to the array index plus 1 (because arrays are 0-based but binding is 1-based).
   *
   * If passed an object, each object key is treated as a bindable parameter name. The
   * object keys must match any bindable parameter names, including any $, @, or : prefix.
   * Because $ is a legal identifier chararacter in JavaScript, that is the suggested
   * prefix for bindable parameters: stmt.bind({$a: 1, $b: 2}).
   *
   * It returns this object on success and throws on error. Errors include:
   * - Any bind index is out of range, a named bind parameter does not match, or this
   *   statement has no bindable parameters.
   * - Any value to bind is of an unsupported type.
   * - Passed no arguments or more than two.
   * - The statement has been finalized.
   */
  bind?: any[] | { [key: string]: any };
  /**
   * One of
   * - 'array' (the default) causes the results of stmt.get([]) to be passed to the
   *   callback and/or appended to resultRows.
   * - 'object' causes the results of stmt.get(Object.create(null)) to be passed to the
   *   callback and/or appended to resultRows. Achtung: an SQL result may have multiple
   *   columns with identical names. In that case, the right-most column will be the one
   *   set in this object!
   */
  // rowMode?: 'object' | 'array';
};
