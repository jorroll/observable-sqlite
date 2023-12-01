# Observable SQLite

This repo is a minimal example of how to subscribe to SQL queries in a SQLite database. This example uses typescript and the official WASM distribution of SQLite.

The basic strategy is that we provide a thin wrapper around SQLite for performing queries. This wrapper primarily does three things.
1. It provides a method to update records in the SQLite database. All updates to the database should go through this method.
2. When a record is updated, we emit a table change event that subscribers can listen to to know when a table has been updated.
3. We provide a subscribeToQuery or observeQuery method that we can use to view updates to a specific query. This method accepts a query string, then it parses it and notes what tables are touched by the query, then we subscribe to updates to those tables. Whenever a table touched by the query is changed, we re-run the query. While this method of observing queries isn't the most efficient (the query might rerender even if it's results haven't changed), most applications will probably be pleasantly surprised that it's more than good enough for their use case. SQLite can be very fast. 

To learn more, [open this repo in Stackblitz](https://stackblitz.com/~/github.com/jorroll/observable-sqlite) and check out `./src/database/SqliteDatabase.ts`. The `liveQuery` method shows how you might subscribe to a query without using [RxJS](https://rxjs.dev/) and the `observeQuery` method shows the same thing except using [RxJS](https://rxjs.dev/). 

If you open up the stackblitz example, not that clicking the `increment` button in the demo is using SQlite reactivity to update.