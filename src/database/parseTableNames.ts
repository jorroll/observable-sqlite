import { astVisitor, parse } from 'pgsql-ast-parser';

export function parseTestTableNames(sqlQuery: string): string[] {
  const statements = parse(sqlQuery);

  if (statements.length !== 1) {
    throw new Error(`Must receive exactly one SQL statement`);
  }

  const statement = statements[0]!;

  const tables = new Set<string>();

  const visitor = astVisitor(() => ({
    tableRef: (t) => tables.add(t.name),
  }));

  visitor.statement(statement);

  return Array.from(tables);
}

export function hasIntersection<A, B>(
  first: A[],
  second: B[],
  isEqual: (a: A, b: B) => boolean = Object.is
): boolean {
  const tLen = first.length;
  const cLen = second.length;

  for (let i = 0; i < tLen; ++i) {
    const tablename = first[i];

    for (let j = 0; j < cLen; ++j) {
      const candidate = second[j];

      if (isEqual(tablename, candidate)) {
        return true;
      }
    }
  }

  return false;
}
