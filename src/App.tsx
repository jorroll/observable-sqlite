import reactLogo from './assets/react.svg';
import viteLogo from '/vite.svg';
import './App.css';
import { ProvideDatabaseContext } from './database/context';
import { Counter } from './Counter';
import { Suspense } from 'react';

function App() {
  return (
    <ProvideDatabaseContext>
      <div>
        <a href="https://vitejs.dev" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>

      <h1>ObserveSQLite</h1>

      <Counter />
    </ProvideDatabaseContext>
  );
}

export default App;
