import sql, { Sql } from "sql-template-tag";
import { RecordTable, RecordValue, TableToRecord } from "./schema";

export function upsertRecordSql<T extends RecordTable>(table: T, record: RecordValue<T>) {
  return upsertRecordMap[table](record);
}

const upsertRecordMap = {
  counter: (record) => sql`
    INSERT INTO counter (
      id, 
      value
    ) 
    VALUES (
      ${record.id}, 
      ${record.value}
    ) 
    ON CONFLICT(id) 
    DO UPDATE SET 
      value = ${record.value};
  `
} satisfies {
  [K in RecordTable]: (record: TableToRecord[K]) => Sql
}