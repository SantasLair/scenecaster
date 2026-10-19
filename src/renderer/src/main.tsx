import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { applyTheme, deriveTheme, DEFAULT_PRESET, PRESETS } from './theme/godotTheme';

applyTheme(deriveTheme(PRESETS[DEFAULT_PRESET]));

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
