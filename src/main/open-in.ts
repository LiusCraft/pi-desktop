// Open a session folder in an editor, a terminal, or the file manager.
import { spawn, type SpawnOptions } from 'node:child_process';
import { shell } from 'electron';
import type { OpenTarget } from '@shared/protocol';
import { childEnv } from '../agent/env';

export function openIn(target: OpenTarget, cwd: string, resource = cwd) {
  // .cmd shims (code.cmd, cursor.cmd) only resolve through the command
  // processor; everywhere else we exec the binary directly.
  const winQuote = (s: string) => (/[\s"]/.test(s) ? `"${s.split('"').join('""')}"` : s);
  const detached = (cmd: string, args: string[], opts: SpawnOptions = {}) => {
    const base: SpawnOptions = { cwd, env: childEnv(), detached: true, stdio: 'ignore', windowsHide: true, ...opts };
    const p = process.platform === 'win32'
      ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', [cmd, ...args].map(winQuote).join(' ')], base)
      : spawn(cmd, args, base);
    p.on('error', () => {});
    p.unref();
  };
  switch (target) {
    case 'vscode': return detached('code', [resource]);
    case 'cursor': return detached('cursor', [resource]);
    case 'folder': return void shell.openPath(resource);
    case 'terminal':
      if (process.platform === 'darwin') return detached('open', ['-a', 'Terminal', cwd]);
      if (process.platform === 'win32') return detached('wt', ['-d', cwd]);
      return detached('x-terminal-emulator', [], { cwd });
  }
}
