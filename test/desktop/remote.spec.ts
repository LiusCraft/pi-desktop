// Two real Pi Desktop instances: B shares its sessions, A connects and drives them.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { RemoteServeState } from '../../src/shared/remote';

const PORT = 17432;

interface Instance {
  app: ElectronApplication;
  page: Page;
  dataDir: string;
}

async function launch(root: string, name: string): Promise<Instance> {
  const dir = path.join(root, name);
  const dataDir = path.join(dir, 'data');
  const profile = path.join(dir, 'electron-profile');
  fs.mkdirSync(profile, { recursive: true });
  const app = await electron.launch({
    executablePath: createRequire(path.resolve('package.json'))('electron') as string,
    args: [path.resolve('.'), '--demo', '--lang=en-US', `--user-data-dir=${profile}`],
    env: { ...process.env, PI_DESKTOP_HOME: dataDir, PI_CODING_AGENT_DIR: path.join(dir, 'agent'), PI_OFFLINE: '1' },
  });
  const page = await app.firstWindow();
  await expect(page.getByPlaceholder('Describe a task or ask a question')).toBeVisible();
  return { app, page, dataDir };
}

const invoke = <T>(page: Page, channel: string, ...args: unknown[]) =>
  page.evaluate(([c, a]) => (window as any).piDesktop.invoke(c, ...(a as unknown[])), [
    channel,
    args,
  ] as const) as Promise<T>;

test('drives the sessions of another Pi Desktop', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-desktop-remote-'));
  const host = await launch(root, 'host');
  const client = await launch(root, 'client');
  try {
    const state = await invoke<RemoteServeState>(host.page, 'remote:serveSet', { enabled: true, port: PORT });
    expect(state.listening).toBe(true);

    const [saved] = await invoke<{ id: string }[]>(client.page, 'remote:save', {
      name: 'Host',
      url: `127.0.0.1:${PORT}`,
      token: 'wrong',
    });
    await expect(invoke(client.page, 'remote:connect', saved.id)).rejects.toThrow('Wrong access token');

    await invoke(client.page, 'remote:save', {
      id: saved.id,
      name: 'Host',
      url: `127.0.0.1:${PORT}`,
      token: state.token,
    });
    const reloaded = client.page.waitForEvent('load');
    await invoke(client.page, 'remote:connect', saved.id);
    await reloaded;

    // The window now shows the host's world.
    await expect(client.page.getByText('Host', { exact: true })).toBeVisible();
    const projects = await invoke<{ path: string }[]>(client.page, 'projects:list');
    expect(projects.length).toBeGreaterThan(0);
    for (const p of projects) expect(fs.realpathSync(p.path).startsWith(fs.realpathSync(host.dataDir))).toBe(true);

    // Run a turn on the host from the client; the transcript comes back through the event stream.
    const meta = await invoke<{ id: string }>(client.page, 'sessions:create', {
      kind: 'code',
      projectPath: projects[0].path,
      worktree: false,
      model: 'demo/demo-coder',
    });
    await invoke(client.page, 'sessions:open', meta.id);
    await invoke(client.page, 'sessions:prompt', meta.id, { text: 'hello from the client', attachments: [] }, 'steer');
    await expect
      .poll(async () => {
        const opened = await invoke<{ messages: { role: string }[]; isStreaming: boolean }>(
          host.page,
          'sessions:open',
          meta.id,
        );
        return !opened.isStreaming && opened.messages.some((m) => m.role === 'assistant');
      })
      .toBe(true);

    // Local-only actions say so instead of touching the wrong machine.
    await expect(invoke(client.page, 'terminal:create', meta.id)).rejects.toThrow('remote host');

    const back = client.page.waitForEvent('load');
    await invoke(client.page, 'remote:disconnect');
    await back;
    const local = await invoke<{ path: string }[]>(client.page, 'projects:list');
    for (const p of local) expect(fs.realpathSync(p.path).startsWith(fs.realpathSync(client.dataDir))).toBe(true);
  } finally {
    await client.app.close();
    await host.app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
