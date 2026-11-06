import React from 'react';
import { createRoot } from 'react-dom/client';
import { i18nReady } from './i18n';
import './styles.css';
import { App } from './App';

await i18nReady;

const root = document.getElementById('root');
if (!root) throw new Error('Root element was not found');

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
