import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The pi-remote extension is one self-contained ES module: the session hub and the remote server are
// bundled in; what pi supplies to every extension (its own SDK and typebox) stays external.
const root = resolve(__dirname, '..');
export default defineConfig({
  root,
  resolve: { alias: { '@shared': resolve(root, 'src/shared') } },
  ssr: {
    noExternal: true,
    external: [
      '@earendil-works/pi-coding-agent',
      '@earendil-works/pi-ai',
      '@earendil-works/pi-agent-core',
      '@earendil-works/pi-tui',
      'typebox',
    ],
  },
  build: {
    ssr: resolve(root, 'src/agent/remote/plugin.ts'),
    outDir: resolve(__dirname, 'pi-remote'),
    emptyOutDir: false,
    minify: false,
    rolldownOptions: { output: { format: 'es', entryFileNames: 'index.js' } },
  },
});
