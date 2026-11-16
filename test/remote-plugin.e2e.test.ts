// The pi-remote extension, loaded the way pi loads it (a factory given the extension API), serving a real
// session hub to a remote client.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HostEvent, SessionMeta } from '../src/shared/protocol';
import { RemoteClient } from '../src/agent/remote/client';
import piRemote from '../src/agent/remote/plugin';

type Command = {
  handler: (args: string, ctx: { ui: { notify(message: string, type?: string): void } }) => Promise<void>;
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-remote-e2e-'));
const project = path.join(root, 'project');
const saved = { home: process.env.PI_REMOTE_HOME, agent: process.env.PI_CODING_AGENT_DIR };
const messages: string[] = [];
let command: Command;

beforeAll(() => {
  fs.mkdirSync(project);
  process.env.PI_REMOTE_HOME = path.join(root, 'remote-home');
  process.env.PI_CODING_AGENT_DIR = path.join(root, 'agent');
  const pi = {
    registerFlag() {},
    registerCommand(_name: string, options: Command) {
      command = options;
    },
    on() {},
    getFlag: () => false,
  };
  piRemote(pi as never);
});

afterAll(async () => {
  await command.handler('stop', { ui: { notify: () => {} } });
  process.env.PI_REMOTE_HOME = saved.home;
  process.env.PI_CODING_AGENT_DIR = saved.agent;
  fs.rmSync(root, { recursive: true, force: true });
});

const run = async (args: string) => {
  messages.length = 0;
  await command.handler(args, { ui: { notify: (m) => messages.push(m) } });
  return messages.join('\n');
};

describe('pi-remote plugin', () => {
  it('serves a hub over the remote protocol: projects, sessions and their events', async () => {
    const started = await run('start --port 17431');
    const token = /Access token: (\S+)/.exec(started)?.[1];
    expect(token).toBeTruthy();
    expect(started).toContain('http://127.0.0.1:17431');

    const events: HostEvent[] = [];
    const client = new RemoteClient({
      url: 'http://127.0.0.1:17431',
      token: token!,
      onEvent: (e) => events.push(e),
      onState: () => {},
    });
    await client.start();
    try {
      const added = await client.call<{ path: string }>('projects:addPath', project);
      expect(added.path).toBe(project);
      expect(await client.call<unknown[]>('projects:list')).toHaveLength(1);

      const meta = await client.call<SessionMeta>('sessions:create', {
        kind: 'code',
        projectPath: project,
        worktree: false,
      });
      expect(meta.cwd).toBe(project);
      expect((await client.call<{ id: string }[]>('sessions:list')).map((s) => s.id)).toContain(meta.id);

      const listing = await client.call<{ path: string; dirs: unknown[] }>('remote:browse', root);
      expect(listing.path).toBe(root);
      await expect(client.call('models:login', 'x', 'oauth')).rejects.toThrow('unavailable');
      await expect(client.call('tasks:list')).rejects.toThrow('not available on this host');
    } finally {
      client.close();
    }
  });

  it('keeps its token across restarts and can rotate it', async () => {
    const first = /Access token: (\S+)/.exec(await run('token'))?.[1];
    expect(first).toBeTruthy();
    const again = /Access token: (\S+)/.exec(await run('token'))?.[1];
    expect(again).toBe(first);
    const rotated = /token: (\S+)/.exec(await run('rotate'))?.[1];
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(first);
    expect(await run('status')).toContain(rotated!);
  });

  it('rejects a port outside the allowed range', async () => {
    const out = await run('start --port 80');
    expect(out).toContain('between 1024 and 65535');
  });
});
