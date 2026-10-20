import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Fonts are imported here, not with @import in index.css: Tailwind inlines CSS imports and leaves the fonts' relative url()s unresolved.
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './index.css';
import { applyTheme, deriveTheme } from './theme/godotTheme';
import { loadTheme } from './theme/themeSettings';

applyTheme(deriveTheme(loadTheme()));

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
