// The `bash` tool as the desktop registers it: pi's own definition plus `workdir`, running through
// the shared shell so a `cd` carries over — and saying where the shell ended up.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDesktopKit, type KitHost } from '../src/agent/desktop-kit';
import type { ShellSessionMode } from '../src/shared/protocol';

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-shell-tool-'));
fs.mkdirSync(path.join(folder, 'sub'), { recursive: true });

const shutdowns: (() => void)[] = [];

function load(mode: ShellSessionMode) {
  const tools = new Map<string, any>();
  const handlers = new Map<string, ((...args: any[]) => void)[]>();
  const pi = {
    on: (event: string, handler: (...args: any[]) => void) => { handlers.set(event, [...(handlers.get(event) ?? []), handler]); },
    getAllTools: () => [],
    registerTool: (tool: any) => tools.set(tool.name, tool),
    getSettings: () => ({}),
  };
  const state = { mode: 'bypass', profile: 'code', outputStyle: 'default', allowed: new Set<string>() } as KitHost['state'];
  createDesktopKit({ state, cwd: folder, shellSession: () => mode, ask: async () => ({ value: 'Allow' }), setMode: () => {} })(pi as any);
  // The bash tool is registered when the session starts, once pi's settings are readable.
  for (const handler of handlers.get('session_start') ?? []) handler({ type: 'session_start' });
  shutdowns.push(...(handlers.get('session_shutdown') ?? []));
  return tools.get('bash');
}

/** What the model would read: the text blocks of a tool result. */
const text = (result: any) => result.content.map((block: any) => block.text).join('');

/** Git Bash spells a folder `C:/…` where node says `C:\…`, and may keep its 8.3 name: compare folders, not text. */
const canonical = (folder: string) => {
  const full = fs.realpathSync.native(folder.trim());
  return process.platform === 'win32' ? full.toLowerCase() : full;
};

const context = () => ({
  cwd: folder,
  model: undefined,
  thinkingLevel: undefined,
  sessionManager: { getSessionId: () => 'test-session', getSessionFile: () => null },
}) as any;

afterEach(() => {
  for (const stop of shutdowns.splice(0)) stop();
});

describe('bash tool', () => {
  it('keeps pi\'s own description and adds workdir on top', () => {
    const tool = load('session');
    expect(tool.description).toMatch(/Execute a bash command/);
    expect(tool.description).toMatch(/workdir/);
    expect(Object.keys(tool.parameters.properties)).toEqual(['command', 'timeout', 'workdir']);
  });

  it('runs a command in the workdir it was given', async () => {
    const tool = load('command');
    const result = await tool.execute('call-1', { command: 'basename "$PWD"', workdir: 'sub' }, undefined, undefined, context());
    expect(text(result)).toContain('sub');
  });

  it('refuses a workdir that is not a folder', async () => {
    const tool = load('command');
    await expect(tool.execute('call-1', { command: 'pwd', workdir: 'nope' }, undefined, undefined, context())).rejects.toThrow(/not a folder/);
  });

  it('treats a `null` workdir as none', async () => {
    const tool = load('command');
    // Optional arguments arrive stringified: `workdir: null` reaches the tool as "null".
    const result = await tool.execute('call-1', { command: 'basename "$PWD"', workdir: 'null' }, undefined, undefined, context());
    expect(text(result)).toContain(path.basename(folder));
  });

  it('keeps the folder a cd moved to, and says so in the result', async () => {
    const tool = load('session');
    await tool.execute('call-1', { command: 'cd sub' }, undefined, undefined, context());
    const result = await tool.execute('call-2', { command: 'pwd' }, undefined, undefined, context());
    const moved = path.join(folder, 'sub');
    const [printed] = text(result).split('\n');
    expect(canonical(printed)).toBe(canonical(moved));
    const noted = /\[shell folder: ([^\]]+)\]/.exec(text(result))?.[1];
    expect(noted && canonical(noted)).toBe(canonical(moved));
  });

  it('runs a workdir command without moving the shared shell', async () => {
    const tool = load('session');
    await tool.execute('call-1', { command: 'basename "$PWD"', workdir: 'sub' }, undefined, undefined, context());
    const after = await tool.execute('call-2', { command: 'basename "$PWD"' }, undefined, undefined, context());
    expect(text(after)).toContain(path.basename(folder));
    // Nothing to report: the shell is still in the session folder.
    expect(text(after)).not.toMatch(/shell folder/);
  });

  it('gives every command its own process in `command` mode, with nothing to report', async () => {
    const tool = load('command');
    await tool.execute('call-1', { command: 'cd sub' }, undefined, undefined, context());
    const next = await tool.execute('call-2', { command: 'basename "$PWD"' }, undefined, undefined, context());
    expect(text(next)).toContain(path.basename(folder));
  });

  it('says so when a command repeats a `cd` into the folder the shell is already in', async () => {
    const tool = load('session');
    const repeated = await tool.execute('call-1', { command: `cd '${folder}' && echo hi` }, undefined, undefined, context());
    expect(text(repeated)).toContain('hi');
    expect(text(repeated)).toMatch(/already in that folder/);
  });

  it('stays quiet when the command does not repeat the session folder', async () => {
    const tool = load('session');
    const plain = await tool.execute('call-1', { command: 'echo hi' }, undefined, undefined, context());
    expect(text(plain)).not.toMatch(/already in that folder/);
    const elsewhere = await tool.execute('call-2', { command: 'cd sub && echo hi' }, undefined, undefined, context());
    expect(text(elsewhere)).not.toMatch(/already in that folder/);
  });

  it('reports the exit code of a failing command', async () => {
    const tool = load('session');
    const result = await tool.execute('call-1', { command: 'exit 3' }, undefined, undefined, context());
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('code 3');
  });
});
