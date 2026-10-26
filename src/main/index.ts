// Main process: windows, settings, projects and the IPC surface. Every pi
// session lives in the agent host (a utilityProcess); session calls are
// forwarded to it unchanged and its events are relayed to the windows.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, Notification, shell } from 'electron';
import {
  HOST_CHANNELS, MAIN_CHANNELS, SUGGESTION_DEFAULT_CONTEXT,
  type ApiArgs, type ApiResult, type BootPayload, type HostEvent, type Project, type PushChannel, type PushEvents,
  type Settings, type SettingsPayload,
} from '@shared/protocol';
import { childEnv } from '../agent/env';
import {
  appDataDir, appDemoDir, appExtensionsDir, defaultWorktreeDir, expandHome, piAgentDir, worktreeDir,
} from '../agent/app-paths';
import { resolveInside } from '../agent/files';
import { localPath } from '../agent/local-path';
import { Store } from '../agent/store';
import { AgentClient } from './agent-client';
import { migrateLegacyKeys } from './agent-auth';
import { clipboardAttachments, type ClipboardItemLike } from './clipboard';
import { openIn } from './open-in';

const here = path.dirname(fileURLToPath(import.meta.url));
const PRELOAD = path.join(here, '../preload/index.js');
const RENDERER = path.join(here, '../renderer');
const DEV_URL = process.env.ELECTRON_RENDERER_URL;

app.setName('Pi Desktop');
// Windows only shows (and groups) toasts for a registered app id.
if (process.platform === 'win32') app.setAppUserModelId('dev.pi-desktop.app');
// The offline demo (scripted model + sample workspaces) is a dev / test aid: packaged builds never enable it.
const DEMO_ALLOWED = !app.isPackaged;
const DEMO = DEMO_ALLOWED && process.argv.includes('--demo');
const isMac = process.platform === 'darwin';
let win: BrowserWindow | null = null;
let settingsWin: BrowserWindow | null = null;
let store: Store;
let agent: AgentClient;

// ------------------------------------------------------------ projects and folders

const exists = (p: Project) => fs.existsSync(p.path);
function projects() {
  return store.get<Project[]>('projects', []).filter(exists);
}
function addProject(dir: string) {
  const list = store.get<Project[]>('projects', []).filter((p) => p.path !== dir);
  const project = { path: dir, name: path.basename(dir), addedAt: Date.now() };
  store.set('projects', [project, ...list]);
  return project;
}
/** Work folders the user has worked in, most recent first. */
function workFolders() {
  return store.get<Project[]>('workFolders', []).filter(exists);
}
function addWorkFolder(dir: string) {
  const list = store.get<Project[]>('workFolders', []).filter((p) => p.path !== dir);
  const folder = { path: dir, name: path.basename(dir), addedAt: Date.now() };
  store.set('workFolders', [folder, ...list].slice(0, 12));
  return folder;
}
const demoSource = (name: string) => path.join(app.getAppPath(), 'demo', name);
/** Pi Desktop's own data folder; Electron's profile stays at the platform default. */
const dataDir = () => appDataDir();
function ensureDemoWork() {
  const dest = path.join(appDemoDir(dataDir()), 'work-workspace');
  if (!fs.existsSync(dest)) fs.cpSync(demoSource('work-workspace'), dest, { recursive: true });
  return addWorkFolder(dest);
}
/** Copy the bundled demo project into the app data folder and make it a git repo. */
function ensureDemoProject() {
  const dest = path.join(appDemoDir(dataDir()), 'todo-app');
  if (!fs.existsSync(dest)) {
    fs.cpSync(demoSource('todo-app'), dest, { recursive: true });
    try {
      const g = (...a: string[]) => execFileSync('git', a, { cwd: dest, env: childEnv(), stdio: 'ignore' });
      g('init', '-q', '-b', 'main');
      g('add', '-A');
      g('-c', 'user.name=Pi Desktop', '-c', 'user.email=demo@pi.desktop', 'commit', '-qm', 'Initial commit');
    } catch {} // git is optional: diffs simply stay empty without it
  }
  return addProject(dest);
}

// ------------------------------------------------------------ settings

// Preferences live in one place so every window reads the same values.
// `theme: null` means "not chosen yet": follow the system.
const DEFAULT_SETTINGS: Settings = {
  theme: null, notify: true, renderMermaid: true, suggestions: true,
  suggestionModel: 'session', suggestionModelId: null, suggestionContext: SUGGESTION_DEFAULT_CONTEXT, suggestionFullContext: false,
  defaultMode: 'code', sidebarCollapsed: false, worktreeDir: null, pet: true, petSkin: 'clawd',
};

function settingsValue(): Settings {
  return { ...DEFAULT_SETTINGS, ...store.get<Partial<Settings>>('settings', {}) };
}
function settingsPayload(): SettingsPayload {
  const s = settingsValue();
  const resolvedTheme = s.theme === 'light' || s.theme === 'dark' ? s.theme : nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  return { ...s, resolvedTheme };
}
function broadcast<K extends PushChannel>(channel: K, payload: PushEvents[K]) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
}
/** A worktree root must be one absolute local folder; null/empty restores the default. */
function normalizeWorktreeDir(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  const abs = localPath(expandHome(raw));
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}
function saveSettings(patch: Partial<Settings>) {
  const clean: Partial<Settings> = { ...patch };
  if ('worktreeDir' in patch) clean.worktreeDir = normalizeWorktreeDir(patch.worktreeDir);
  const next = { ...settingsValue(), ...clean };
  store.set('settings', next);
  // Native chrome (title bar, menus, dialogs) follows the app's appearance.
  nativeTheme.themeSource = next.theme === 'light' || next.theme === 'dark' ? next.theme : 'system';
  applyThemeToWindows();
  const payload = settingsPayload();
  broadcast('settings:changed', payload);
  return payload;
}

// ------------------------------------------------------------ windows

const BG = { light: '#faf9f5', dark: '#262624' };
const SIDEBAR_BG = { light: '#f5f4ed', dark: '#1f1e1d' };
function overlay(dark: boolean) {
  return dark ? { color: SIDEBAR_BG.dark, symbolColor: '#c3c1bb', height: 44 } : { color: SIDEBAR_BG.light, symbolColor: '#55534d', height: 44 };
}
const isDark = () => settingsPayload().resolvedTheme === 'dark';

function load(w: BrowserWindow, page: 'index' | 'settings' | 'diagram', hash?: string) {
  if (DEV_URL) void w.loadURL(`${DEV_URL}/${page}.html${hash ? `#${hash}` : ''}`);
  else void w.loadFile(path.join(RENDERER, `${page}.html`), hash ? { hash } : undefined);
}
function harden(w: BrowserWindow) {
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => {
    if (!DEV_URL || !url.startsWith(DEV_URL)) e.preventDefault();
  });
}

function createWindow() {
  const dark = isDark();
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 720,
    minHeight: 480,
    title: 'Pi Desktop',
    backgroundColor: dark ? BG.dark : BG.light,
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 18, y: 16 } } : { titleBarOverlay: overlay(dark) }),
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  load(win, 'index');
  harden(win);
  win.on('closed', () => (win = null));
}

function createSettingsWindow(section?: string) {
  const dark = isDark();
  settingsWin = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 720,
    minHeight: 520,
    title: 'Settings',
    backgroundColor: dark ? BG.dark : BG.light,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 16, y: 18 } } : { titleBarOverlay: overlay(dark) }),
    show: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  load(settingsWin, 'settings', section);
  settingsWin.once('ready-to-show', () => settingsWin?.show());
  harden(settingsWin);
  settingsWin.on('closed', () => {
    settingsWin = null;
    // A browser/device login outlives the window otherwise; the flow needs an answer that can no longer arrive.
    void agent?.call('host:cancelLogins').catch(() => {});
  });
}

/** Show the existing settings window instead of stacking duplicates. */
function openSettings(section?: string) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (section) settingsWin.webContents.send('settings:section', section);
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  createSettingsWindow(section);
}

/** SVGs waiting for (or shown in) a diagram window, keyed by the token in its URL. */
const diagrams = new Map<string, string>();

/** A diagram opens in a window of its own, so it can be moved aside, resized and zoomed freely. */
function openDiagram(svg: string) {
  if (typeof svg !== 'string' || !svg.includes('<svg')) return;
  const token = randomUUID();
  diagrams.set(token, svg);
  const w = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 480,
    minHeight: 360,
    title: '图表',
    backgroundColor: isDark() ? BG.dark : BG.light,
    autoHideMenuBar: true,
    show: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  load(w, 'diagram', token);
  w.once('ready-to-show', () => w.show());
  harden(w);
  w.on('closed', () => diagrams.delete(token));
}

function applyThemeToWindows() {
  const dark = isDark();
  for (const w of [win, settingsWin]) {
    if (!w || w.isDestroyed()) continue;
    if (!isMac) w.setTitleBarOverlay(overlay(dark));
    w.setBackgroundColor(dark ? BG.dark : BG.light);
  }
}

// ------------------------------------------------------------ IPC

/** Folders the app may open or reveal: its own data, pi's config, projects and Work folders. */
function knownRoot(target: string) {
  const abs = path.resolve(String(target || ''));
  const dir = dataDir();
  const roots = [
    dir, appExtensionsDir(dir), piAgentDir(),
    worktreeDir(dir, settingsValue().worktreeDir), defaultWorktreeDir(dir),
    ...projects().map((p) => p.path), ...workFolders().map((p) => p.path),
  ];
  if (!roots.some((r) => abs === path.resolve(r) || abs.startsWith(path.resolve(r) + path.sep))) throw new Error('Path outside the app folders');
  return abs;
}
async function pickFolder() {
  const r = win ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] }) : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
}
const importAttachments = (sources: unknown[]) => agent.call<ApiResult<'attachments:import'>>('host:importAttachments', sources);
const sessionCwd = async (id: string) => (await agent.call<{ cwd: string }>('host:meta', id)).cwd;

type MainHandlers = { [K in (typeof MAIN_CHANNELS)[number]]: (...args: ApiArgs<K>) => ApiResult<K> | Promise<ApiResult<K>> };

/** Notifications must stay referenced until dismissed, or their click handlers are collected. */
const live = new Set<Notification>();
function showMainWindow() {
  if (!win || win.isDestroyed()) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

const handlers: MainHandlers = {
  'app:info': () => ({
    platform: process.platform,
    version: app.getVersion(),
    demo: DEMO,
    dataDir: dataDir(),
    agentDir: piAgentDir(),
    extensionsDir: appExtensionsDir(dataDir()),
    defaultWorktreeDir: defaultWorktreeDir(dataDir()),
    versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
  }),
  'app:notify': ({ title, body, sessionId }) => {
    if (settingsValue().notify === false) return;
    if (!Notification.isSupported() || (win && !win.isDestroyed() && win.isFocused())) return;
    const n = new Notification({ title, body });
    live.add(n);
    n.on('close', () => live.delete(n));
    n.on('click', () => {
      showMainWindow();
      if (sessionId) win?.webContents.send('session:focus', sessionId);
    });
    n.show();
  },
  'app:openExternal': (url) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
  },
  'app:pickFolder': () => pickFolder(),
  // Reveal or open a folder the app already knows about; anything else is refused.
  'app:revealPath': (target, reveal) => {
    const abs = knownRoot(target);
    if (reveal || !fs.statSync(abs).isDirectory()) shell.showItemInFolder(abs);
    else void shell.openPath(abs);
  },

  'settings:open': (section) => openSettings(section),
  'settings:get': () => settingsPayload(),
  'settings:set': (patch) => saveSettings(patch || {}),
  'settings:close': () => settingsWin?.close(),
  'diagram:open': (svg) => openDiagram(svg),
  'diagram:get': (token) => diagrams.get(token) ?? null,

  'projects:list': () => projects(),
  'projects:add': async () => {
    const dir = await pickFolder();
    return dir ? addProject(dir) : null;
  },
  'projects:remove': (dir) => {
    store.set('projects', store.get<Project[]>('projects', []).filter((p) => p.path !== dir));
    return projects();
  },
  'work:folders': () => workFolders(),
  'work:addFolder': async () => {
    const dir = await pickFolder();
    return dir ? addWorkFolder(dir) : null;
  },
  'work:useFolder': (dir) => (fs.existsSync(dir) ? addWorkFolder(dir) : null),
  'work:removeFolder': (dir) => {
    store.set('workFolders', store.get<Project[]>('workFolders', []).filter((p) => p.path !== dir));
    return workFolders();
  },

  'attachments:import': (sources) => importAttachments(sources),
  'attachments:pick': async () => {
    const options = { title: 'Add attachments', properties: ['openFile', 'multiSelections'] as const };
    const r = win ? await dialog.showOpenDialog(win, { ...options, properties: [...options.properties] }) : await dialog.showOpenDialog({ ...options, properties: [...options.properties] });
    return r.canceled ? { attachments: [], errors: [] } : importAttachments(r.filePaths.map((p) => ({ path: p })));
  },
  // SAFETY: Electron's async clipboard.read is available at runtime but absent from its bundled type declarations.
  'attachments:clipboard': () =>
    clipboardAttachments(() => (clipboard as unknown as { read(): Promise<ClipboardItemLike[]> }).read(), importAttachments),

  'sessions:openIn': async (id, target, rel) => {
    const cwd = await sessionCwd(id);
    const resource = rel ? resolveInside(cwd, rel) : cwd;
    const directory = fs.statSync(resource).isDirectory() ? resource : path.dirname(resource);
    return openIn(target, directory, resource);
  },
  // Open or reveal a file the agent produced, constrained to the session folder.
  'sessions:openPath': async (id, rel, reveal) => {
    const abs = resolveInside(await sessionCwd(id), rel || '.');
    if (reveal) shell.showItemInFolder(abs);
    else {
      const error = await shell.openPath(abs);
      if (error) throw new Error(error);
    }
  },
};

function registerIpc() {
  // Read synchronously by the preload: every window boots with the right theme,
  // sidebar state and default mode instead of flashing a fallback first.
  ipcMain.on('app:boot', (e) => {
    e.returnValue = {
      settings: settingsPayload(),
      info: { platform: process.platform, version: app.getVersion(), demo: DEMO, agentDir: piAgentDir() },
    } satisfies BootPayload;
  });
  for (const channel of MAIN_CHANNELS) {
    const fn = handlers[channel] as (...args: unknown[]) => unknown;
    ipcMain.handle(channel, (_e, ...args) => fn(...args));
  }
  for (const channel of HOST_CHANNELS) {
    ipcMain.handle(channel, (_e, ...args) => agent.call(channel, ...args));
  }
}

// ------------------------------------------------------------ app

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', showMainWindow);

void app.whenReady().then(async () => {
  store = new Store(dataDir());
  migrateLegacyKeys(store);
  // Own folders only; Electron's Chromium profile is left to its platform default.
  fs.mkdirSync(appExtensionsDir(dataDir()), { recursive: true });
  try {
    fs.mkdirSync(worktreeDir(dataDir(), settingsValue().worktreeDir), { recursive: true });
  } catch (err) {
    // An unmounted custom worktree volume must not keep the app from starting.
    console.error('[main] cannot create the worktree folder:', err);
  }
  nativeTheme.themeSource = ['light', 'dark'].includes(String(settingsValue().theme)) ? (settingsValue().theme as 'light' | 'dark') : 'system';
  agent = new AgentClient(
    path.join(here, 'agent.mjs'),
    () => ({ dataDir: dataDir(), agentDir: piAgentDir(), demo: DEMO_ALLOWED }),
    (event: HostEvent) => broadcast('host:event', event),
  );
  void agent.start().catch((err) => console.error('[main] agent host failed to start:', err));
  if (DEMO || (DEMO_ALLOWED && !projects().length)) ensureDemoProject();
  if (DEMO || (DEMO_ALLOWED && !workFolders().length)) ensureDemoWork();
  registerIpc();
  nativeTheme.on('updated', () => {
    // Following the system: repaint both windows and tell the renderers.
    if (settingsValue().theme === 'light' || settingsValue().theme === 'dark') return;
    applyThemeToWindows();
    broadcast('settings:changed', settingsPayload());
  });
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

let quitting = false;
app.on('before-quit', async (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  await agent?.stop().catch(() => {});
  app.quit();
});
app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

