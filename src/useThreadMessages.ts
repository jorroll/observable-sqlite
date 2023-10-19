import sql from 'sql-template-tag';
import { useDatabaseContext } from './database/context';
import { SQLiteClient } from './database/SqliteDatabase';
import { useObservable, useObservableState } from 'observable-hooks';
import { of, switchMap } from 'rxjs';
import { MessageRecord } from './database/schema';

export function useThreadMessages(threadId: string | null | undefined) {
  const db = useDatabaseContext();

  const query = useObservable(
    (inputs$) => {
      return inputs$.pipe(
        switchMap(([threadId, db]) =>
          threadId
            ? db.observeQuery(getSqlForThreadMessages(threadId))
            : of(null)
        )
      );
    },
    [threadId, db]
  );

  const record = useObservableState(query, 'loading');

  return record;
}

export async function getThreadMessages(db: SQLiteClient, threadId: string) {
  const query = getSqlForThreadMessages(threadId);

  const { resultRows } = await db.exec<MessageRecord>({
    sql: query.sql,
    bind: query.values,
  });

  return resultRows;
}

// What if we had a server we were fetching these records from and then
// loading them into the client. When should this query update?
//
// 1. It should update if any of the records returned from this query
//    are updated.
// 2. It should update if any records are added or removed from the
//    `message` table IF those records have `thread_id = ${threadId}`
//
// We can handle #1 easily enough. Simply create a globally unique key for
// the record and request updates about it from the server. E.g.
// `${table}:${recordId}`. The server can easily figure out when to send
// updates if a record with that ID and table is updated.
//
// What about #2? Here we can also pass a key to the server asking it
// for specific updates. In this case we can use
// `message:thread_id:${threadId}` for the key. The server knows
// that if any `message` record with a `message.thread_id === ${threadId}`
// is updated, then we send an update message down to the client containing
// a globally unique identifier (e.g `${table}:${recordId}`) for that
// record. The client then just fetches that record and our SQLite
// observability automatically kicks in and rerenders any queries.
const getSqlForThreadMessages = (threadId: string) => sql`
  SELECT
    *
  FROM
    message
  WHERE
    message.thread_id = ${threadId};
`;

// But what about more complex queries? In this case the client
// might need to subscribe to multiple keys associated with the query.
// For example, below is a contrived query that involves two joins.
// This query it attempting to fetch the labels which are associated
// with the threads in a specific channel. It's a many to many to many
// join.
//
// This query will update when
// 1. Any of the returned labels update or
// 2. A channel_thread is added/removed with `channel_thread.channel_id === ${channelId}`
// 3. A thread_label is added/removed with
//    `thread_id === ${...uhh...how do we do this?}`
const getSqlForLabelsAssocWithThreadsInChannel = (channelId: string) => sql`
  SELECT
    label.*
  FROM
    channel_thread
  JOIN
    thread_label ON thread_label.thread_id = channel_thread.thread_id
  JOIN
    label ON label.id = thread_label.label_id
  WHERE
    channel_thread.channel_id = ${channelId}
`;

// In this case, we can't use the same technique as before on this query.
// So we have two choices.

// 1. We can create a custom subscription key and send that to the client saying
//    I'd like updates to the getSqlForLabelsAssocWithThreadsInChannel query with
//    channelId === "1" (or whatever) please. Then the server needs to figure out
//    when that query has been updated and send updates to the client. This
//    sounds difficult...
//
// 2. The better choice is to harness the power of observables and perform some
//    simpler client side joins which we can easily track.
//
// Lets see what that looks like!
//
// Lets try breaking up the above query into two queries.
//
// This thread is updated when
// 1. A returned channel_thread is updated
// 2. A channel_thread with `channel_id === ${channelId}` is added or removed.
const getSqlForChannelThreads = (channelId: string) => sql`
  SELECT
    *
  FROM
    channel_thread
  WHERE
    channel_thread.channel_id = ${channelId}
`;

// And this one is updated when
// 1. A returned label is updated
// 2. A thread_label with `thread_id === ${threadId}` is
//    added/removed
const getSqlForLabelsInThread = (threadId: string) => sql`
  SELECT
    label.*
  FROM
    thread_label
  JOIN
    label ON label.id = thread_label.label_id
  WHERE
    thread_label.thread_id = ${threadId}
`;

// We can combine these queries with a client-side join using our live
// query results and [rxjs](https://rxjs.dev). Here's we're subscribing to
// our channel threads query, then using the results to subscribe to a bunch
// of labels for thread queries. Then we deduplicate the results.
//
// This does increase the total amount of time it takes us to resolve this query,
// but if your queries are each resolving in milliseconds this should often be
// acceptable.
function observeLabelsAssocWithThreadsInChannel(
  db: SQLiteClient,
  channelId: string
): Observable<LabelRecord[]> {
  return db.observeQuery(getSqlForChannelThreads(channelId)).pipe(
    switchMap((threadLabels) => {
      if (threadLabels.length === 0) return of([]);

      return combineLatest(
        threadLabels.map((thread_id) =>
          db.observeQuery(getSqlForLabelsInThread(thread_id))
        )
      );
    }),
    map((results) => uniqBy(results.flat(), 'id'))
  );
}
