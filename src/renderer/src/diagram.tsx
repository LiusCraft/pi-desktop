import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';
import { useTheme } from './lib/theme';
import { call } from './lib/api';
import { DiagramViewer } from './components/common/DiagramViewer';

function DiagramApp() {
  useTheme();
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    call('diagram:get', location.hash.slice(1))
      .then(setSvg)
      .catch(() => setSvg(null));
  }, []);
  return svg ? <DiagramViewer svg={svg} /> : null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DiagramApp />
  </StrictMode>,
);
