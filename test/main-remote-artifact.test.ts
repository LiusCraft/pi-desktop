// Exercise main's real IPC routing and artifact cache without launching Electron windows or an agent
// process. The remote HTTP server, transfer handlers, filesystem and client are not mocked.
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BrowserWindow } from 'electron';
import { ArtifactService } from '../src/agent/artifacts';
import { appRemoteArtifactsDir } from '../src/agent/app-paths';
import { newRemoteToken, RemoteServer } from '../src/agent/remote/server';
import { transferCall } from '../src/agent/remote/transfer';
import { ObjectStorage } from '../src/agent/storage';
import { Store } from '../src/agent/store';
import { activeLocale, setActiveLocale, tr } from '../src/shared/i18n/runtime';
import { isTransferMethod, type RemoteTransferResult } from '../src/shared/remote';
import { ARTIFACT_ENTRY, ARTIFACT_SITE_DIR } from '../src/shared/artifacts';

const desktop = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => {
  class Window {
    static windows: Window[] = [];
    webContents = {
      on: vi.fn<() => void>(),
      send: vi.fn<() => void>(),
      reload: vi.fn<() => void>(),
      setWindowOpenHandler: vi.fn<() => void>(),
      session: { setPermissionRequestHandler: vi.fn<() => void>() },
    };
    on = vi.fn<() => void>();
    once = vi.fn<() => void>();
    loadFile = vi.fn<(file: string) => Promise<void>>(async (_file) => {});
    loadURL = vi.fn<(url: string) => Promise<void>>(async (_url) => {});
    isDestroyed = () => false;
    show = vi.fn<() => void>();
    focus = vi.fn<() => void>();

    constructor() {
      Window.windows.push(this);
    }

    static getAllWindows() {
      return Window.windows;
    }
  }
  return {
    app: {
      isPackaged: true,
      setName: vi.fn<() => void>(),
      setAppUserModelId: vi.fn<() => void>(),
      requestSingleInstanceLock: () => true,
      getLocale: () => 'en-US',
      getAppPath: () => process.cwd(),
      getVersion: () => '0.1.0',
      on: vi.fn<() => void>(),
      quit: vi.fn<() => void>(),
      whenReady: () => Promise.resolve(),
    },
    BrowserWindow: Window,
    ipcMain: {
      on: vi.fn<() => void>(),
      handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
        desktop.handlers.set(channel, handler);
      },
    },
    nativeTheme: { shouldUseDarkColors: false, on: vi.fn<() => void>() },
    protocol: { registerSchemesAsPrivileged: vi.fn<() => void>(), handle: vi.fn<() => void>() },
    clipboard: {},
    dialog: {},
    Menu: {},
    net: {},
    Notification: class {},
    screen: {},
    shell: {},
    safeStorage: {},
  };
});

vi.mock('../src/main/agent-client', () => ({
  AgentClient: class {
    start = vi.fn<() => Promise<void>>(async () => {});
    stop = vi.fn<() => Promise<void>>(async () => {});
    call = vi.fn<() => Promise<void>>(async () => {});
  },
}));
vi.mock('node-pty', () => ({ spawn: vi.fn<() => void>() }));

// Main's unrelated settings/pet subscriptions must not outlive this test's temporary folder.
class QuietWatcher extends EventEmitter implements fs.FSWatcher {
  close() {}
  ref() {
    return this;
  }
  unref() {
    return this;
  }
}

async function invoke(channel: string, ...args: unknown[]): Promise<void> {
  const handler = desktop.handlers.get(channel);
  if (!handler) throw new Error(`IPC handler not registered: ${channel}`);
  await handler({}, ...args);
}

let root: string;
let dataDir: string;
let service: ArtifactService;
let server: RemoteServer | undefined;
const locale = activeLocale();
const remoteCall = vi.fn<(method: string, args: unknown[]) => Promise<RemoteTransferResult>>(async (method, args) => {
  if (!isTransferMethod(method)) throw new Error(`Unexpected remote call: ${method}`);
  return transferCall(path.join(root, 'host'), method, args);
});

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-main-remote-artifact-'));
  dataDir = path.join(root, 'client');
  vi.stubEnv('PI_DESKTOP_HOME', dataDir);
  vi.stubEnv('PI_CODING_AGENT_DIR', path.join(root, 'agent'));
  vi.spyOn(fs, 'watch').mockImplementation(() => new QuietWatcher());
  const host = path.join(root, 'host');
  service = new ArtifactService(host, new ObjectStorage(host));
  const token = newRemoteToken();
  server = new RemoteServer({ token, port: 0, lan: false, backend: { kind: 'plugin', call: remoteCall } });
  await server.start();
  const store = new Store(dataDir);
  store.set('remoteConnections', [{ id: 'host', name: 'Host', url: `http://127.0.0.1:${server.port}`, token }]);

  // Discard main's scheduled update checks before using real timers for the network connection.
  vi.useFakeTimers();
  await import('../src/main/index');
  vi.clearAllTimers();
  vi.useRealTimers();
  await invoke('remote:connect', 'host');
});

afterAll(async () => {
  try {
    if (desktop.handlers.has('remote:disconnect')) await invoke('remote:disconnect');
    await server?.stop();
  } finally {
    if (vi.isFakeTimers()) {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    setActiveLocale(locale);
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('main remote artifact previews', () => {
  it('downloads, reuses and refreshes the preview cache through the artifacts IPC handler', async () => {
    const source = path.join(root, 'source');
    fs.mkdirSync(path.join(source, 'css'), { recursive: true });
    fs.writeFileSync(path.join(source, ARTIFACT_ENTRY), '<h1>first</h1>');
    fs.writeFileSync(path.join(source, 'css', 'page.css'), 'h1 { color: red; }');
    const meta = service.save({ source });
    const cache = path.join(appRemoteArtifactsDir(dataDir), 'host', meta.id);
    const site = path.join(cache, ARTIFACT_SITE_DIR);
    const entry = path.join(site, ARTIFACT_ENTRY);

    await invoke('artifacts:preview', meta.id);
    expect(remoteCall).toHaveBeenLastCalledWith('artifacts:site', [meta.id, -1]);
    expect(fs.readFileSync(entry, 'utf8')).toBe('<h1>first</h1>');
    expect(fs.readFileSync(path.join(site, 'css', 'page.css'), 'utf8')).toBe('h1 { color: red; }');
    expect(fs.readFileSync(path.join(cache, '.version'), 'utf8')).toBe(String(meta.version));
    const preview = BrowserWindow.getAllWindows().find((window) =>
      vi.mocked(window.loadFile).mock.calls.some(([file]) => file === entry),
    );
    expect(preview).toBeDefined();
    const windowCount = BrowserWindow.getAllWindows().length;

    const marker = path.join(site, 'cached.txt');
    fs.writeFileSync(marker, 'unchanged');
    await invoke('artifacts:preview', meta.id);
    expect(remoteCall).toHaveBeenLastCalledWith('artifacts:site', [meta.id, meta.version]);
    expect(fs.readFileSync(marker, 'utf8')).toBe('unchanged');
    expect(BrowserWindow.getAllWindows()).toHaveLength(windowCount);
    expect(preview?.loadFile).toHaveBeenLastCalledWith(entry);

    // A version marker alone must not suppress a download when the entry page has gone missing.
    fs.unlinkSync(entry);
    await invoke('artifacts:preview', meta.id);
    expect(remoteCall).toHaveBeenLastCalledWith('artifacts:site', [meta.id, -1]);
    expect(fs.readFileSync(entry, 'utf8')).toBe('<h1>first</h1>');
    expect(fs.existsSync(marker)).toBe(false);

    fs.writeFileSync(path.join(source, ARTIFACT_ENTRY), '<h1>second</h1>');
    fs.unlinkSync(path.join(source, 'css', 'page.css'));
    const next = service.save({ id: meta.id, source });
    await invoke('artifacts:preview', meta.id);
    expect(remoteCall).toHaveBeenLastCalledWith('artifacts:site', [meta.id, meta.version]);
    expect(fs.readFileSync(entry, 'utf8')).toBe('<h1>second</h1>');
    expect(fs.existsSync(path.join(site, 'css', 'page.css'))).toBe(false);
    expect(fs.readFileSync(path.join(cache, '.version'), 'utf8')).toBe(String(next.version));
  });

  it('reports a missing remote artifact without creating a preview window or cache', async () => {
    const windowCount = BrowserWindow.getAllWindows().length;
    await expect(invoke('artifacts:preview', 'missing')).rejects.toThrow(tr('remote.artifact.none'));
    expect(remoteCall).toHaveBeenLastCalledWith('artifacts:site', ['missing', -1]);
    expect(BrowserWindow.getAllWindows()).toHaveLength(windowCount);
    expect(fs.existsSync(path.join(appRemoteArtifactsDir(dataDir), 'host', 'missing'))).toBe(false);
  });
});
