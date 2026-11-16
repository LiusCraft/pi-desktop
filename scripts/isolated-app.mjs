#!/usr/bin/env node
// Run `make dev` / `make demo` against their own Electron profile and app-data folder.
// The app is named "Pi Desktop" in every build, so without this an unpackaged run shares the
// installed app's profile: the single-instance lock kills it and both write the same sessions.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const MODES = ['dev', 'demo'];
const mode = process.argv[2];
if (!MODES.includes(mode)) {
  console.error(`usage: node scripts/isolated-app.mjs <${MODES.join('|')}>`);
  process.exit(2);
}

// PI_DESKTOP_HOME wins, so `PI_DESKTOP_HOME=~/.pi-desktop node scripts/isolated-app.mjs dev`
// can still use the real sessions; the profile stays under that folder either way.
const configured = process.env.PI_DESKTOP_HOME?.trim();
const home = configured
  ? path.resolve(configured === '~' ? os.homedir() : configured.replace(/^~(?=[\\/])/, os.homedir()))
  : path.join(os.homedir(), `.pi-desktop-${mode}`);
const userData = path.join(home, 'electron');
const isDemo = mode === 'demo';
// electron-vite forwards everything after `--` to Electron; the app reads `--demo` itself.
// `make demo` builds first, so preview does not build a second time.
const bin = path.join(
  path.dirname(createRequire(import.meta.url).resolve('electron-vite/package.json')),
  'bin/electron-vite.js',
);
const args = [
  bin,
  isDemo ? 'preview' : 'dev',
  ...(isDemo ? ['--skipBuild'] : []),
  '--',
  ...(isDemo ? ['--demo'] : []),
  `--user-data-dir=${userData}`,
];

console.log(`[isolated] ${mode}: ${home}\n[isolated] profile: ${userData}`);
const child = spawn(process.execPath, args, {
  stdio: 'inherit',
  env: { ...process.env, PI_DESKTOP_HOME: home },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
