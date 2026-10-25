import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';

const shared = resolve(__dirname, 'src/shared');

// Content-Security-Policy for the packaged pages. Left out in dev, where Vite's
// HMR client needs inline scripts and a websocket.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  'frame-src http://localhost:* http://127.0.0.1:*',
  "connect-src 'none'",
].join('; ');
const csp: Plugin = {
  name: 'pi-desktop-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
};

export default defineConfig({
  // Main process and the agent host (an Electron utilityProcess) build together as ESM:
  // the pi SDK is ESM-only and stays external in node_modules.
  main: {
    resolve: { alias: { '@shared': shared } },
    build: {
      rolldownOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          agent: resolve(__dirname, 'src/agent/index.ts'),
        },
        output: { format: 'es' },
      },
    },
  },
  // Sandboxed preloads must be CommonJS.
  preload: {
    resolve: { alias: { '@shared': shared } },
    build: {
      rolldownOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: { format: 'cjs' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': shared,
      },
    },
    plugins: [react(), tailwindcss(), csp],
    build: {
      rolldownOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          settings: resolve(__dirname, 'src/renderer/settings.html'),
        },
      },
    },
  },
});
