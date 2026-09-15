import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles/globals.css';

async function bootstrap() {
  /**
   * Se window.concord ja existe, estamos dentro do Electron (o preload ja
   * injetou a API). Caso contrario, instalamos o adaptador WebSocket para
   * o browser conseguir falar com o servidor.
   */
  if (!('concord' in window)) {
    const { installWebAdapter } = await import('./lib/webAdapter');
    await installWebAdapter();
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
