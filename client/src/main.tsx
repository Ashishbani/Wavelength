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
