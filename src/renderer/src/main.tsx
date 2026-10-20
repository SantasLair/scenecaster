import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { applyTheme, deriveTheme } from './theme/godotTheme';
import { loadTheme } from './theme/themeSettings';

applyTheme(deriveTheme(loadTheme()));

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
