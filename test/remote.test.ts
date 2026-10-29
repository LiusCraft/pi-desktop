import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostEvent } from '../src/shared/protocol';
import {
  isServedMethod,
  normalizeRemoteUrl,
  REMOTE_API_VERSION,
  type RemoteLinkState,
  type RemotePing,
} from '../src/shared/remote';
import { pingRemote, RemoteClient } from '../src/agent/remote/client';
import { newRemoteToken, RemoteServer } from '../src/agent/remote/server';
import { Store } from '../src/agent/store';
import { browse, existingFolder, ProjectBook, workspaceCall } from '../src/agent/remote/workspace';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const until = async (check: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

async function serve(token = newRemoteToken(), port = 0) {
  const calls: [string, unknown[]][] = [];
  const server = new RemoteServer({
    token,
    port,
    lan: false,
    backend: {
      kind: 'plugin',
      call: async (method, args) => {
        calls.push([method, args]);
        if (method === 'sessions:abort') throw new Error('nothing to abort');
        return { method, args };
      },
    },
  });
  await server.start();
  cleanups.push(() => server.stop());
  return { server, token, calls, url: `http://127.0.0.1:${server.port}` };
}

/** Whatever a remote answers `/v1/ping` with, including endpoints from other versions. */
async function fakePing(ping: Partial<RemotePing>): Promise<string> {
  const server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(ping));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function connect(url: string, token: string) {
  const events: HostEvent[] = [];
  const states: RemoteLinkState[] = [];
  const client = new RemoteClient({ url, token, onEvent: (e) => events.push(e), onState: (s) => states.push(s) });
  cleanups.push(() => client.close());
  return { client, events, states };
}

describe('remote protocol', () => {
  it('answers the ping without a token and refuses everything else without one', async () => {
    const { url } = await serve();
    expect((await pingRemote(url)).kind).toBe('plugin');
    expect((await fetch(`${url}/v1/rpc`, { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await fetch(`${url}/v1/events`, { headers: { authorization: 'Bearer nope' } })).status).toBe(401);
  });

  it('names the side to update when the two ends speak different protocol versions', async () => {
    const older = await fakePing({ app: 'pi-remote', version: REMOTE_API_VERSION - 1, kind: 'plugin' });
    await expect(pingRemote(older)).rejects.toThrow(/update the pi-remote plugin there/);
    const silent = await fakePing({ app: 'pi-remote', kind: 'desktop' });
    await expect(pingRemote(silent)).rejects.toThrow(
      /an unknown protocol, older than v\d+ here: update Pi Desktop there/,
    );
    const newer = await fakePing({ app: 'pi-remote', version: REMOTE_API_VERSION + 1, kind: 'desktop' });
    await expect(pingRemote(newer)).rejects.toThrow(/update Pi Desktop here/);
  });

  it('carries a call to the backend and its error back', async () => {
    const { url, token, calls } = await serve();
    const { client } = connect(url, token);
    expect(await client.call('sessions:list', 1, 'a')).toEqual({ method: 'sessions:list', args: [1, 'a'] });
    expect(calls).toEqual([['sessions:list', [1, 'a']]]);
    await expect(client.call('sessions:abort', 'x')).rejects.toThrow('nothing to abort');
  });

  it('serves the agent host calls and the folder lists, not logins or internals', () => {
    expect(isServedMethod('sessions:prompt')).toBe(true);
    expect(isServedMethod('projects:list')).toBe(true);
    expect(isServedMethod('models:login')).toBe(false);
    expect(isServedMethod('host:shutdown')).toBe(false);
    expect(isServedMethod('terminal:create')).toBe(true);
    expect(isServedMethod('terminal:shells')).toBe(false);
    expect(isServedMethod('attachments:upload')).toBe(true);
  });

  it('rejects a method it does not serve before it reaches the backend', async () => {
    const { url, token, calls } = await serve();
    const { client } = connect(url, token);
    await expect(client.call('host:shutdown')).rejects.toThrow('Unknown or unavailable');
    expect(calls).toEqual([]);
  });

  it('refuses a wrong token when opening the stream', async () => {
    const { url } = await serve();
    const { client } = connect(url, 'wrong');
    await expect(client.start()).rejects.toThrow('Wrong access token');
  });

  it('streams host events to every client', async () => {
    const { server, url, token } = await serve();
    const a = connect(url, token);
    const b = connect(url, token);
    await Promise.all([a.client.start(), b.client.start()]);
    await until(() => server.clients === 2);
    const event: HostEvent = { type: 'status', sessionId: 's1', status: 'running' };
    server.publish(event);
    await until(() => a.events.length === 1 && b.events.length === 1);
    expect(a.events[0]).toEqual(event);
  });

  it('reconnects after the server restarts and reports the link states', async () => {
    const { server, url, token } = await serve();
    const port = server.port;
    const { client, events, states } = connect(url, token);
    await client.start();
    await server.stop();
    await until(() => states.includes('reconnecting'));
    const again = new RemoteServer({ token, port, lan: false, backend: { kind: 'plugin', call: async () => null } });
    await again.start();
    cleanups.push(() => again.stop());
    await until(() => states.at(-1) === 'connected', 15_000);
    again.publish({ type: 'changed', resource: 'models' });
    await until(() => events.some((e) => e.type === 'changed'));
    expect(states).toEqual(['connected', 'reconnecting', 'connected']);
  });
});

describe('remote addresses', () => {
  it('fills in the scheme and drops trailing paths', () => {
    expect(normalizeRemoteUrl('192.168.1.5:7431')).toBe('http://192.168.1.5:7431');
    expect(normalizeRemoteUrl(' https://box.example.com/ ')).toBe('https://box.example.com');
    expect(() => normalizeRemoteUrl('ftp://x')).toThrow(Error);
    expect(() => normalizeRemoteUrl('  ')).toThrow(Error);
  });
});

describe('remote workspace', () => {
  const tmp = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-remote-'));
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
  };

  it('keeps projects and work folders, most recent first', () => {
    const data = tmp();
    const a = path.join(tmp(), 'a');
    const b = path.join(tmp(), 'b');
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    const book = new ProjectBook(new Store(data));
    workspaceCall(book, 'projects:addPath', [a]);
    workspaceCall(book, 'projects:addPath', [b]);
    expect((workspaceCall(book, 'projects:list', []) as { path: string }[]).map((p) => p.path)).toEqual([b, a]);
    expect((workspaceCall(book, 'projects:remove', [b]) as { path: string }[]).map((p) => p.path)).toEqual([a]);
  });

  it('refuses a path that is not a folder on that machine', () => {
    const file = path.join(tmp(), 'f.txt');
    fs.writeFileSync(file, 'x');
    expect(() => existingFolder(file)).toThrow('not a folder');
    expect(() => existingFolder('relative/dir')).toThrow(/absolute path/);
  });

  it('lists sub-folders without hidden ones, and the way back up', () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, 'src'));
    fs.mkdirSync(path.join(root, '.git'));
    fs.writeFileSync(path.join(root, 'a.txt'), '');
    const listing = browse(root);
    expect(listing.dirs).toEqual([{ name: 'src', path: path.join(root, 'src') }]);
    expect(listing.parent).toBe(path.dirname(root));
  });
});
