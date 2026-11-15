import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@cachet/react/styles.css';
import './app.css';
import { App } from './App.tsx';

const saved = (() => {
  try {
    return localStorage.getItem('cachet.theme');
  } catch {
    return null;
  }
})();
if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
