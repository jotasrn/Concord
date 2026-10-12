import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles/globals.css';

// A API (window.concord) e injetada pelo preload do Electron antes da pagina
// carregar. Nao ha modo navegador: o Concord e so o executavel.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
