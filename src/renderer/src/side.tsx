import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';
import './lib/scrollbars';
import './lib/selection';
import { SideChatView } from './components/side/SideChat';
import { useTheme } from './lib/theme';
import { watchSideWindows } from './store/side';
import { useEffect } from 'react';

function SideApp() {
  useTheme();
  useEffect(() => watchSideWindows(), []);
  const sid = decodeURIComponent(location.hash.slice(1));
  return sid ? <SideChatView sid={sid} mode="window" /> : null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SideApp />
  </StrictMode>,
);
