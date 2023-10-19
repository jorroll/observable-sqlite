export const schema = `
CREATE TABLE counter (
    id TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE thread (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL
);

CREATE TABLE message (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  content TEXT NOT NULL
);
`;

export type TableToRecord = {
  counter: CounterRecord;
  thread: ThreadRecord;
  thread_message: ThreadMessageRecord;
  message: MessageRecord;
};

export type CounterRecord = {
  id: string;
  value: number;
};

export type ThreadRecord = {
  id: string;
  subject: string;
};

export type ThreadMessageRecord = {
  id: string;
  thread_id: string;
  message_id: string;
};

export type MessageRecord = {
  id: string;
  content: string;
};

export type RecordTable = keyof TableToRecord;
export type RecordValue<T extends RecordTable> = TableToRecord[T];

export type RecordMap = {
  [Table in RecordTable]: {
    [recordId: string]: RecordValue<Table>;
  };
};
