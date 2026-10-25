import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';
import './lib/theme';
import './lib/scrollbars';
import './lib/selection';
import { SettingsApp } from './settings/SettingsApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsApp />
  </StrictMode>,
);
