import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@cachet/react/styles.css';
import './app.css';
import { App } from './App.tsx';
import { applyTheme, savedTheme } from './lib/theme.ts';

applyTheme(savedTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
