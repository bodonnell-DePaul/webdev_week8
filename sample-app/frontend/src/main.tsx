// =============================================================================
// main.tsx — React entry point
// =============================================================================
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

// Register the service worker (lecture §10).
// `virtual:pwa-register` is injected by vite-plugin-pwa.
import('virtual:pwa-register').then(({ registerSW }) => {
  registerSW({
    immediate: true,
    onRegistered(_r) {
      console.log('[PWA] service worker registered');
    },
    onRegisterError(error) {
      console.error('[PWA] service worker registration failed', error);
    },
  });
}).catch(() => {
  // Plugin not available — silently ignore (e.g. in unit tests).
});
