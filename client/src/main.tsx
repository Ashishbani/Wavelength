import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import { AuthProvider } from './auth/AuthContext.js';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>,
);

// Register the PWA service worker (production only; avoids dev caching surprises).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
