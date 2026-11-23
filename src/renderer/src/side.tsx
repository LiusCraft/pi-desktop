import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';
import './lib/scrollbars';
import './lib/selection';
import { SideChatView } from './components/side/SideChat';
import { TooltipProvider } from './components/ui/tooltip';
import { useTheme } from './lib/theme';
import { watchSideWindows } from './store/side';
import { useEffect } from 'react';

function SideApp() {
  useTheme();
  useEffect(() => watchSideWindows(), []);
  const [sid, chatId] = decodeURIComponent(location.hash.slice(1)).split(':');
  return sid && chatId ? <SideChatView sid={sid} chatId={chatId} mode="window" /> : null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <SideApp />
    </TooltipProvider>
  </StrictMode>,
);
