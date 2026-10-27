// Terminal tabs: plain shells on a pseudo-terminal, one or more per session.
//
// The renderer draws them with xterm.js; this side owns the processes, so a tab
// keeps running (and keeps its output) while the panel is hidden.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as pty from 'node-pty';
import type { TerminalAttach, TerminalInfo, TerminalShell } from '@shared/protocol';
import { childEnv, realBashDir } from '../agent/env';

const isWin = process.platform === 'win32';

/** Output kept per terminal to repaint a view that attaches late (panel reopened, window reloaded). */
const BACKLOG_CHARS = 200_000;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

// ------------------------------------------------------------ shells

const exists = (file: string) => {
  try { return fs.statSync(file).isFile(); } catch { return false; }
};

function onPath(name: string): string | undefined {
  const exts = isWin ? ['.exe', '.cmd'] : [''];
  for (const dir of String(childEnv().PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const file = path.join(dir, name + ext);
      if (exists(file)) return file;
    }
  }
}

function windowsShells(): TerminalShell[] {
  const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const bashDir = realBashDir();
  const found: (TerminalShell | undefined)[] = [
    pick('PowerShell 7', onPath('pwsh')),
    pick('Windows PowerShell', path.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe')),
    pick('命令提示符', path.join(system, 'cmd.exe')),
    pick('Git Bash', bashDir ? path.join(bashDir, 'bash.exe') : undefined),
    pick('WSL', path.join(system, 'wsl.exe')),
  ];
  return found.filter((s): s is TerminalShell => !!s);
}

function pick(label: string, file: string | undefined): TerminalShell | undefined {
  return file && exists(file) ? { file, label } : undefined;
}

function unixShells(): TerminalShell[] {
  const files = new Set<string>();
  if (process.env.SHELL) files.add(process.env.SHELL);
  try {
    for (const line of fs.readFileSync('/etc/shells', 'utf8').split('\n')) {
      const l = line.trim();
      if (l && !l.startsWith('#')) files.add(l);
    }
  } catch {}
  return [...files].filter(exists).map((file) => ({ file, label: path.basename(file) }));
}

export function terminalShells(): TerminalShell[] {
  return isWin ? windowsShells() : unixShells();
}

/** The configured shell if it is still there, else the system default. */
function resolveShell(configured: string | null): string {
  if (configured && exists(configured)) return configured;
  const shells = terminalShells();
  if (!isWin && process.env.SHELL && shells.some((s) => s.file === process.env.SHELL)) return process.env.SHELL;
  return shells[0]?.file ?? (isWin ? 'cmd.exe' : '/bin/sh');
}

/**
 * node-pty launches the shell through a `spawn-helper` binary, and npm can unpack it without the
 * executable bit; posix_spawn then fails and no terminal opens. Restore the bit before spawning.
 */
let helperChecked = false;
function ensureSpawnHelper() {
  if (isWin || helperChecked) return;
  helperChecked = true;
  try {
    const root = path.dirname(createRequire(import.meta.url).resolve('node-pty/package.json'));
    for (const dir of [path.join(root, 'build', 'Release'), path.join(root, 'build', 'Debug'), path.join(root, 'prebuilds', `${process.platform}-${process.arch}`)]) {
      const helper = path.join(dir, 'spawn-helper');
      if (exists(helper)) fs.chmodSync(helper, 0o755);
    }
  } catch {}
}

/** Login shell on unix so a GUI launch gets the profile's PATH, as in Terminal.app. */
const shellArgs = (file: string) => (isWin || !/(^|\/)(bash|zsh|fish|sh)$/.test(file) ? [] : ['-l']);

// ------------------------------------------------------------ terminals

interface Term {
  id: string;
  sessionId: string;
  title: string;
  proc: pty.IPty;
  backlog: string;
  exited: boolean;
}

export interface TerminalHost {
  data(id: string, data: string): void;
  exit(id: string, code: number): void;
}

export class Terminals {
  private terms = new Map<string, Term>();
  private counter = new Map<string, number>();

  constructor(private host: TerminalHost) {}

  list(sessionId: string): TerminalInfo[] {
    return [...this.terms.values()].filter((t) => t.sessionId === sessionId).map(({ id, title }) => ({ id, title }));
  }

  create(sessionId: string, cwd: string, configured: string | null): TerminalInfo {
    ensureSpawnHelper();
    const file = resolveShell(configured);
    const n = (this.counter.get(sessionId) ?? 0) + 1;
    this.counter.set(sessionId, n);
    const proc = pty.spawn(file, shellArgs(file), {
      name: 'xterm-256color',
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      cwd,
      env: childEnv({ TERM_PROGRAM: 'pi-desktop', COLORTERM: 'truecolor' }) as Record<string, string>,
    });
    const term: Term = { id: randomUUID(), sessionId, title: `${path.basename(file, path.extname(file))} ${n}`, proc, backlog: '', exited: false };
    this.terms.set(term.id, term);
    proc.onData((data) => {
      term.backlog = (term.backlog + data).slice(-BACKLOG_CHARS);
      this.host.data(term.id, data);
    });
    proc.onExit(({ exitCode }) => {
      term.exited = true;
      this.host.exit(term.id, exitCode);
    });
    return { id: term.id, title: term.title };
  }

  attach(id: string): TerminalAttach {
    const t = this.get(id);
    return { backlog: t.backlog, exited: t.exited };
  }

  write(id: string, data: string) {
    const t = this.terms.get(id);
    if (t && !t.exited) t.proc.write(data);
  }

  resize(id: string, cols: number, rows: number) {
    const t = this.terms.get(id);
    if (!t || t.exited || cols < 1 || rows < 1) return;
    try { t.proc.resize(Math.floor(cols), Math.floor(rows)); } catch {}
  }

  close(id: string) {
    const t = this.terms.get(id);
    if (!t) return;
    this.terms.delete(id);
    if (!t.exited) try { t.proc.kill(); } catch {}
  }

  /** A deleted session leaves no shell behind. */
  closeSession(sessionId: string) {
    for (const t of this.list(sessionId)) this.close(t.id);
    this.counter.delete(sessionId);
  }

  closeAll() {
    for (const id of [...this.terms.keys()]) this.close(id);
  }

  private get(id: string) {
    const t = this.terms.get(id);
    if (!t) throw new Error('终端已关闭');
    return t;
  }
}
