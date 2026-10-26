// Open a session folder in an editor, a terminal, or the file manager.
//
// Editors are detected, not assumed: the "Open in" menu only lists what is
// actually installed (on PATH, or in the usual per-platform install spots).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type SpawnOptions } from 'node:child_process';
import { app, shell } from 'electron';
import type { OpenTarget, OpenTargetEntry } from '@shared/protocol';
import { childEnv } from '../agent/env';

type EditorId = Exclude<OpenTarget, 'terminal' | 'folder'>;

interface EditorSpec {
  id: EditorId;
  /** Launcher names looked up on PATH. */
  cli: string[];
  /** macOS bundle names (without `.app`). */
  mac?: string[];
  /** The GUI executable whose icon represents the app on Windows. */
  exe?: string;
  /** Windows launchers, relative to `%LOCALAPPDATA%\Programs` or `%ProgramFiles%`. */
  win?: string[];
  /** JetBrains installs are versioned folders: `<prefix>*\bin\<exe>` under `...\JetBrains`. */
  jetbrains?: { dir: string; exe: string };
}

const jb = (id: EditorId, cli: string, dir: string, exe: string, mac = dir): EditorSpec =>
  ({ id, cli: [cli], mac: [mac, `${mac} CE`], exe, jetbrains: { dir, exe } });

const EDITORS: EditorSpec[] = [
  { id: 'vscode', exe: 'Code.exe', cli: ['code'], mac: ['Visual Studio Code'], win: ['Microsoft VS Code/bin/code.cmd'] },
  { id: 'vscode-insiders', exe: 'Code - Insiders.exe', cli: ['code-insiders'], mac: ['Visual Studio Code - Insiders'], win: ['Microsoft VS Code Insiders/bin/code-insiders.cmd'] },
  { id: 'cursor', exe: 'Cursor.exe', cli: ['cursor'], mac: ['Cursor'], win: ['cursor/resources/app/bin/cursor.cmd', 'Cursor/resources/app/bin/cursor.cmd'] },
  { id: 'windsurf', exe: 'Windsurf.exe', cli: ['windsurf'], mac: ['Windsurf'], win: ['Windsurf/bin/windsurf.cmd'] },
  { id: 'trae', exe: 'Trae.exe', cli: ['trae'], mac: ['Trae'], win: ['Trae/bin/trae.cmd'] },
  { id: 'antigravity', exe: 'Antigravity.exe', cli: ['antigravity'], mac: ['Antigravity'], win: ['Antigravity/bin/antigravity.cmd'] },
  { id: 'vscodium', exe: 'VSCodium.exe', cli: ['codium'], mac: ['VSCodium'], win: ['VSCodium/bin/codium.cmd'] },
  { id: 'zed', exe: 'zed.exe', cli: ['zed'], mac: ['Zed'], win: ['Zed/zed.exe'] },
  { id: 'sublime', exe: 'sublime_text.exe', cli: ['subl'], mac: ['Sublime Text'], win: ['Sublime Text/subl.exe'] },
  jb('idea', 'idea', 'IntelliJ IDEA', 'idea64.exe'),
  jb('webstorm', 'webstorm', 'WebStorm', 'webstorm64.exe'),
  jb('pycharm', 'pycharm', 'PyCharm', 'pycharm64.exe'),
  jb('goland', 'goland', 'GoLand', 'goland64.exe'),
  jb('rustrover', 'rustrover', 'RustRover', 'rustrover64.exe'),
  jb('clion', 'clion', 'CLion', 'clion64.exe'),
  jb('phpstorm', 'phpstorm', 'PhpStorm', 'phpstorm64.exe'),
];

/** How to start something: run a file, or ask macOS to open a bundle. */
type Launcher = { file: string } | { app: string };

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

const exists = (p: string) => {
  try { return fs.statSync(p).isFile(); } catch { return false; }
};

function onPath(name: string): string | undefined {
  const exts = isWin ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  const dirs = String(childEnv().PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) for (const ext of exts) {
    const file = path.join(dir, name + ext.toLowerCase());
    if (exists(file)) return file;
  }
}

function winRoots() {
  return [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'),
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
  ].filter((p): p is string => !!p);
}

function findJetBrains(dir: string, exe: string): string | undefined {
  const bases = [
    ...winRoots().map((r) => path.join(r, 'JetBrains')),
    ...winRoots(),
  ];
  for (const base of bases) {
    let names: string[] = [];
    try { names = fs.readdirSync(base); } catch { continue; }
    for (const name of names.filter((n) => n.startsWith(dir)).sort().reverse()) {
      const file = path.join(base, name, 'bin', exe);
      if (exists(file)) return file;
    }
  }
}

function macApp(names: string[]): string | undefined {
  const roots = ['/Applications', path.join(os.homedir(), 'Applications')];
  for (const name of names) for (const root of roots) {
    if (fs.existsSync(path.join(root, `${name}.app`))) return name;
  }
}

function locate(spec: EditorSpec): Launcher | undefined {
  const cli = spec.cli.map(onPath).find(Boolean);
  if (cli) return { file: cli };
  if (isMac) {
    const app = macApp(spec.mac ?? []);
    return app ? { app } : undefined;
  }
  if (isWin) {
    for (const rel of spec.win ?? []) for (const root of winRoots()) {
      const file = path.join(root, ...rel.split('/'));
      if (exists(file)) return { file };
    }
    if (spec.jetbrains) {
      const file = findJetBrains(spec.jetbrains.dir, spec.jetbrains.exe);
      if (file) return { file };
    }
  }
}

function locateTerminal(): Launcher | undefined {
  if (isMac) return { app: 'Terminal' };
  const names = isWin ? ['wt'] : ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm'];
  const file = names.map(onPath).find(Boolean);
  return file ? { file } : undefined;
}

/** The file whose icon stands for the app: the .app bundle on macOS, the GUI .exe on Windows. */
function iconSource(spec: EditorSpec, launcher: Launcher): string | undefined {
  if (isMac) {
    const name = 'app' in launcher ? launcher.app : macApp(spec.mac ?? []);
    if (!name) return;
    return ['/Applications', path.join(os.homedir(), 'Applications')].map((r) => path.join(r, `${name}.app`)).find((p) => fs.existsSync(p));
  }
  if (!isWin || 'app' in launcher) return;
  if (launcher.file.toLowerCase().endsWith('.exe')) return launcher.file;
  // A .cmd shim sits in `<install>in` (or deeper); the app's .exe is next to it up the tree.
  let dir = path.dirname(launcher.file);
  for (let i = 0; i < 4 && spec.exe; i++, dir = path.dirname(dir)) {
    const file = path.join(dir, spec.exe);
    if (exists(file)) return file;
  }
}

const TTL = 30_000;
let cache: { at: number; entries: Promise<OpenTargetEntry[]>; found: Map<EditorId, Launcher> } | undefined;

async function iconOf(file: string | undefined) {
  if (!file) return undefined;
  try { return (await app.getFileIcon(file, { size: 'normal' })).toDataURL(); } catch { return undefined; }
}

function detect() {
  if (cache && Date.now() - cache.at < TTL) return cache;
  const found = new Map<EditorId, Launcher>();
  for (const spec of EDITORS) {
    const launcher = locate(spec);
    if (launcher) found.set(spec.id, launcher);
  }
  const editors = EDITORS.filter((e) => found.has(e.id));
  const entries = Promise.all(editors.map(async (e): Promise<OpenTargetEntry> => ({
    id: e.id, icon: await iconOf(iconSource(e, found.get(e.id)!)),
  }))).then((list) => [...list, { id: 'terminal' as const }, { id: 'folder' as const }]);
  return (cache = { at: Date.now(), entries, found });
}

/** Targets that can actually be opened on this machine, in menu order, with the app's own icon where it can be read. */
export function openTargets(): Promise<OpenTargetEntry[]> {
  return detect().entries;
}

export function openIn(target: OpenTarget, cwd: string, resource = cwd) {
  const winQuote = (s: string) => `"${s.split('"').join('""')}"`;
  const run = (launcher: Launcher, args: string[], opts: SpawnOptions = {}) => {
    const base: SpawnOptions = { cwd, env: childEnv(), detached: true, stdio: 'ignore', windowsHide: true, ...opts };
    let p;
    if ('app' in launcher) p = spawn('open', ['-a', launcher.app, ...args], base);
    else if (isWin && /\.(cmd|bat)$/i.test(launcher.file)) {
      // .cmd shims only run through the command processor; wrapping the whole
      // line in one more pair of quotes keeps paths with spaces intact.
      const line = [launcher.file, ...args].map(winQuote).join(' ');
      p = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { ...base, windowsVerbatimArguments: true });
    } else p = spawn(launcher.file, args, base);
    p.on('error', () => {});
    p.unref();
  };

  switch (target) {
    case 'folder': return void shell.openPath(resource);
    case 'terminal': {
      const launcher = locateTerminal();
      if (launcher) return run(launcher, 'app' in launcher ? [cwd] : isWin ? ['-d', cwd] : []);
      // No Windows Terminal: a plain console window in the folder.
      if (isWin) return run({ file: process.env.ComSpec || 'cmd.exe' }, ['/c', 'start', '', 'cmd.exe'], { windowsHide: false });
      return;
    }
    default: {
      const launcher = detect().found.get(target);
      if (!launcher) throw new Error(`${target} is not installed`);
      return run(launcher, [resource]);
    }
  }
}
