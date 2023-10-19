import { ComponentType, useCallback } from 'react';
import sql from 'sql-template-tag';
import { useDatabaseContext } from './database/context';
import { SQLiteClient } from './database/SqliteDatabase';
import { useObservable, useObservableState } from 'observable-hooks';
import { of, switchMap } from 'rxjs';
import { CounterRecord } from './database/schema';

export const Counter: ComponentType<{}> = () => {
  const counterId = '1';
  const counter = useCounter(counterId);
  const increment = useIncrement();

  if (counter === 'loading') return 'loading';

  return (
    <div>
      <h2>The current count is: {counter?.value ?? 0}</h2>
      <button type="button" onClick={() => increment(counterId)}>
        Increment
      </button>
    </div>
  );
};

function useCounter(counterId: string | null | undefined) {
  const db = useDatabaseContext();

  const query = useObservable(
    (inputs$) => {
      return inputs$.pipe(
        switchMap(([counterId, db]) =>
          counterId ? db.observeRecord('counter', counterId) : of(null)
        )
      );
    },
    [counterId, db]
  );

  const record = useObservableState(query, 'loading');

  return record;
}

function useIncrement() {
  const db = useDatabaseContext();

  return useCallback(
    async (counterId: string) => {
      const count = await getCounter(db, counterId);

      await db.writeRecordMap({
        counter: {
          [counterId]: {
            id: counterId,
            value: count.value + 1,
          },
        },
      });
    },
    [db]
  );
}

async function getCounter(db: SQLiteClient, counterId: string) {
  const query = sql`
    SELECT * FROM counter WHERE counter.id = ${counterId}
  `;

  const { resultRows } = await db.exec<CounterRecord>({
    sql: query.sql,
    bind: query.values,
  });

  return (
    resultRows[0] || { id: counterId, value: 0 } // Lets return this default value if the record doesn'talready exist
  );
}
