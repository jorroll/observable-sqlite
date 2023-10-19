import {
  createContext,
  useContext,
  PropsWithChildren,
  useState,
  useEffect,
  FunctionComponent,
} from 'react';
import { SQLiteClient } from './SqliteDatabase';

const DatabaseContext = createContext<SQLiteClient | null>(null);

export const ProvideDatabaseContext: FunctionComponent<PropsWithChildren<{}>> =
  (props) => {
    const [context, setContext] = useState<SQLiteClient | null>(null);

    useEffect(() => {
      SQLiteClient.init().then(setContext);
    }, []);

    if (!context) return null;

    return (
      <DatabaseContext.Provider value={context}>
        {props.children}
      </DatabaseContext.Provider>
    );
  };

export function useDatabaseContext() {
  const context = useContext(DatabaseContext);

  if (!context) {
    throw new Error('DatabaseContext not provided');
  }

  return context as SQLiteClient;
}
