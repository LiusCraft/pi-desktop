// Main process: windows, settings, projects and the IPC surface. Every pi
// session lives in the agent host (a utilityProcess); session calls are
// forwarded to it unchanged and its events are relayed to the windows.
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MenuItemConstructorOptions } from 'electron';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, net, Notification, screen, shell } from 'electron';
import {
  HOST_CHANNELS, MAIN_CHANNELS,
  type ApiArgs, type ApiResult, type AttachmentSource, type BootPayload, type HostEvent, type Project, type PushChannel, type PushEvents,
  type Settings, type SettingsPayload, type WorktreeInfo,
} from '@shared/protocol';
import { DEFAULT_PET_ID } from '@shared/pets';
import { DEFAULT_SETTINGS } from '@shared/settings';
import { ARTIFACT_ENTRY, ARTIFACT_ID_PATTERN, ARTIFACT_SITE_DIR, ARTIFACT_THUMBNAIL, artifactThumbnailName } from '@shared/artifacts';
import {
  isRemotePort, isTerminalMethod, isTransferMethod, normalizeRemoteUrl, REMOTE_DEFAULT_PORT, REMOTE_PORT_RANGE, REMOTE_TERMINAL_METHODS, REMOTE_WORKSPACE_METHODS,
  type RemoteActive, type RemoteArtifactSite, type RemoteTerminalMethod, type RemoteConnection, type RemoteConnectionDraft, type RemoteConnectionInfo, type RemoteServeSettings, type RemoteServeState, type RemoteWorkspaceMethod,
} from '@shared/remote';
import { childEnv } from '../agent/env';
import { listPets, removePet, savePet } from '../agent/pets';
import { ArtifactService } from '../agent/artifacts';
import { ObjectStorage } from '../agent/storage';
import {
  appDataDir, appDemoDir, appExtensionsDir, appPetsDir, appArtifactsDir, appRemoteArtifactsDir, defaultWorktreeDir, expandHome, piAgentDir, worktreeDir,
} from '../agent/app-paths';
import { resolveInside } from '../agent/files';
import { localPath } from '../agent/local-path';
import { RemoteClient, pingRemote } from '../agent/remote/client';
import { Tunnel } from '../agent/remote/tunnel';
import { newRemoteToken, remoteUrls, RemoteServer } from '../agent/remote/server';
import { browse, existingFolder, ProjectBook, workspaceCall } from '../agent/remote/workspace';
import { resolveLocale } from '@shared/i18n';
import { setActiveLocale, tr } from '@shared/i18n/runtime';
import { Store } from '../agent/store';
import { AgentClient } from './agent-client';
import { migrateLegacyKeys } from './agent-auth';
import { clipboardAttachments, type ClipboardItemLike } from './clipboard';
import { openIn, openTargets } from './open-in';
import { uploadAttachments } from './remote-upload';
import { Terminals, terminalShells } from './terminal';
import { checkForUpdate, downloadInstaller } from './updater';
import { UPDATE_CHECK_INTERVAL_MS, UPDATE_FIRST_CHECK_MS } from '@shared/update';

const here = path.dirname(fileURLToPath(import.meta.url));
const PRELOAD = path.join(here, '../preload/index.js');
const RENDERER = path.join(here, '../renderer');
const DEV_URL = process.env.ELECTRON_RENDERER_URL;
// A packaged app takes its window icon from the executable; an unpackaged one would show Electron's.
const WINDOW_ICON = app.isPackaged ? undefined : path.join(here, '../../build/icon-win.png');

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
/** The worktree the user just picked, until they say whether it is a session or a project of its own. */
let pendingWorktree: WorktreeInfo | null = null;

// ------------------------------------------------------------ projects and folders

let book: ProjectBook;
const projects = () => book.projects();
const addProject = (dir: string) => book.addProject(dir);
/** Work folders the user has worked in, most recent first. */
const workFolders = () => book.workFolders();
const addWorkFolder = (dir: string) => book.addWorkFolder(dir);
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
function settingsValue(): Settings {
  return { ...DEFAULT_SETTINGS, ...store.get<Partial<Settings>>('settings', {}) };
}
/** The language the app runs in: the setting, or the OS language when it follows the system. */
function currentLocale() {
  return resolveLocale(settingsValue().language, app.getLocale());
}
function settingsPayload(): SettingsPayload {
  const s = settingsValue();
  const resolvedTheme = s.theme === 'light' || s.theme === 'dark' ? s.theme : nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  return { ...s, resolvedTheme, locale: currentLocale(), pets: listPets(appPetsDir(dataDir())) };
}
function broadcast<K extends PushChannel>(channel: K, payload: PushEvents[K]) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
}
const terminals = new Terminals({
  data: (id, data) => broadcast('terminal:data', { id, data }),
  exit: (id, code) => broadcast('terminal:exit', { id, code }),
});
/** A worktree root must be one absolute local folder; null/empty restores the default. */
function normalizeWorktreeDir(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  const abs = localPath(expandHome(raw));
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}
/** Tell every window the set of custom pets changed (the Settings page, the model's tools and hand edits all land here). */
function petsChanged() {
  const payload = settingsPayload();
  broadcast('settings:changed', payload);
  return payload;
}
const PET_WATCH_DEBOUNCE_MS = 200;
const SETTINGS_WATCH_DEBOUNCE_MS = 200;
/** The model's tools write pet files from the agent host; this is how the windows hear about them. */
function watchPets() {
  const dir = appPetsDir(dataDir());
  try {
    fs.mkdirSync(dir, { recursive: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    fs.watch(dir, () => {
      clearTimeout(timer);
      timer = setTimeout(petsChanged, PET_WATCH_DEBOUNCE_MS);
    }).on('error', () => {});
  } catch (err) {
    console.error('[main] cannot watch the pets folder:', err);
  }
}
function saveSettings(patch: Partial<Settings>) {
  const clean: Partial<Settings> = { ...patch };
  if ('worktreeDir' in patch) clean.worktreeDir = normalizeWorktreeDir(patch.worktreeDir);
  store.set('settings', { ...settingsValue(), ...clean });
  return applySettings();
}
/** Make the stored settings take effect and tell every window; also runs when the agent host edits them for the model. */
function applySettings() {
  const next = settingsValue();
  const locale = currentLocale();
  setActiveLocale(locale);
  if (agent) void agent.call('host:locale', locale).catch(() => {});
  // Native chrome (title bar, menus, dialogs) follows the app's appearance.
  nativeTheme.themeSource = next.theme === 'light' || next.theme === 'dark' ? next.theme : 'system';
  applyThemeToWindows();
  const payload = settingsPayload();
  broadcast('settings:changed', payload);
  return payload;
}
const SETTINGS_FILE = 'settings.json';
function watchSettings() {
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The folder, not the file: the store replaces the file on every write, which ends a file watch.
    fs.watch(dataDir(), (_event, name) => {
      if (name !== SETTINGS_FILE) return;
      clearTimeout(timer);
      timer = setTimeout(applySettings, SETTINGS_WATCH_DEBOUNCE_MS);
    }).on('error', () => {});
  } catch (err) {
    console.error('[main] cannot watch the settings file:', err);
  }
}

// ------------------------------------------------------------ windows

const BG = { light: '#faf9f5', dark: '#262624' };
/** The caption buttons sit over the page header, so they take the page background, not the sidebar's. */
function overlay(dark: boolean) {
  return dark ? { color: BG.dark, symbolColor: '#c3c1bb', height: 44 } : { color: BG.light, symbolColor: '#55534d', height: 44 };
}
const isDark = () => settingsPayload().resolvedTheme === 'dark';

function load(w: BrowserWindow, page: 'index' | 'settings' | 'diagram' | 'side', hash?: string) {
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
  // Electron shows no right-click menu of its own. Pages that draw one (the sidebar, the file tree) stop the event first.
  w.webContents.on('context-menu', (_e, p) => {
    const flags = p.editFlags;
    const copy = { role: 'copy', label: tr('main.copy') } as const;
    const template: MenuItemConstructorOptions[] = p.isEditable
      ? [
        { role: 'cut', label: tr('main.cut'), enabled: flags.canCut },
        { ...copy, enabled: flags.canCopy },
        { role: 'paste', label: tr('main.paste'), enabled: flags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', label: tr('main.selectAll'), enabled: flags.canSelectAll },
      ]
      : p.selectionText.trim() ? [copy] : [];
    if (template.length) Menu.buildFromTemplate(template).popup({ window: w });
  });
}

interface WindowState { x: number; y: number; width: number; height: number; maximized: boolean }

/** The last size and position, if that spot is still on a connected display. */
function savedWindowState(): WindowState | null {
  const s = store.get<WindowState | null>('windowState', null);
  if (!s || ![s.x, s.y, s.width, s.height].every(Number.isFinite)) return null;
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return s.x < a.x + a.width - 80 && s.x + s.width > a.x + 80 && s.y >= a.y - 20 && s.y < a.y + a.height - 80;
  });
  return visible ? s : null;
}
function trackWindowState(w: BrowserWindow) {
  let timer: NodeJS.Timeout | undefined;
  const save = () => {
    if (w.isDestroyed() || w.isMinimized() || w.isFullScreen()) return;
    const maximized = w.isMaximized();
    // While maximized, keep the normal bounds so un-maximizing returns to them.
    const prev = store.get<WindowState | null>('windowState', null);
    const b = maximized && prev ? prev : w.getBounds();
    store.set('windowState', { x: b.x, y: b.y, width: b.width, height: b.height, maximized });
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 400);
  };
  w.on('resize', later);
  w.on('move', later);
  w.on('maximize', later);
  w.on('unmaximize', later);
  w.on('close', () => {
    clearTimeout(timer);
    save();
  });
}

function createWindow() {
  const dark = isDark();
  const saved = savedWindowState();
  win = new BrowserWindow({
    icon: WINDOW_ICON,
    width: saved?.width ?? 1440,
    height: saved?.height ?? 920,
    ...(saved ? { x: saved.x, y: saved.y } : {}),
    minWidth: 720,
    minHeight: 480,
    title: 'Pi Desktop',
    backgroundColor: dark ? BG.dark : BG.light,
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 18, y: 16 } } : { titleBarOverlay: overlay(dark) }),
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  if (saved?.maximized) win.maximize();
  trackWindowState(win);
  load(win, 'index');
  harden(win);
  win.on('closed', () => {
    win = null;
    // Secondary windows (settings, pet, popouts) are meaningless without the main window.
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.close();
  });
}

function createSettingsWindow(section?: string) {
  const dark = isDark();
  settingsWin = new BrowserWindow({
    icon: WINDOW_ICON,
    width: 960,
    height: 720,
    minWidth: 720,
    minHeight: 520,
    title: tr('settings.title'),
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
    icon: WINDOW_ICON,
    width: 1100,
    height: 760,
    minWidth: 480,
    minHeight: 360,
    title: tr('app.diagram'),
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

/** Artifact previews, by artifact id: one window each, reloaded when the artifact is opened again. */
const artifactWindows = new Map<string, BrowserWindow>();

/**
 * An artifact is arbitrary HTML the model wrote, so it opens in a plain sandboxed window: no preload (nothing of
 * this app is reachable from it), no Node, and it may only show its own files. Links to the web open in the browser.
 */
async function openArtifact(id: string) {
  if (!ARTIFACT_ID_PATTERN.test(id)) return;
  const { root } = await artifactFolder(id);
  const dir = path.join(root, ARTIFACT_SITE_DIR);
  const entry = path.join(dir, ARTIFACT_ENTRY);
  if (!fs.existsSync(entry)) throw new Error(tr('remote.artifact.none'));
  const existing = artifactWindows.get(root);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    void existing.loadFile(entry);
    return;
  }
  const w = new BrowserWindow({
    icon: WINDOW_ICON,
    width: 1100,
    height: 780,
    minWidth: 360,
    minHeight: 280,
    title: tr('app.artifact'),
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, partition: 'artifact-preview' },
  });
  const inside = (url: string) => {
    try {
      const target = fileURLToPath(url);
      return target === dir || target.startsWith(dir + path.sep);
    } catch {
      return false;
    }
  };
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => {
    if (inside(url)) return;
    e.preventDefault();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });
  w.webContents.session.setPermissionRequestHandler((_wc, _permission, deny) => deny(false));
  w.webContents.on('page-title-updated', (_e, title) => {
    if (title.trim()) w.setTitle(title);
  });
  void w.loadFile(entry);
  w.once('ready-to-show', () => w.show());
  w.on('closed', () => artifactWindows.delete(root));
  artifactWindows.set(root, w);
}

/**
 * Where an artifact's files are on this machine, and which version they are. A remote host's artifact is
 * fetched into a folder of its own first, so the preview window and the thumbnail work the same for both.
 */
async function artifactFolder(id: string): Promise<{ root: string; version: number }> {
  if (!activeRemote) {
    const meta = new ArtifactService(dataDir(), new ObjectStorage(dataDir())).find(id);
    return { root: path.join(appArtifactsDir(dataDir()), id), version: meta?.version ?? 0 };
  }
  const root = path.join(appRemoteArtifactsDir(dataDir()), activeRemote.info.id, id);
  const versionFile = path.join(root, '.version');
  let have = -1;
  try {
    have = Number(fs.readFileSync(versionFile, 'utf8'));
  } catch {
    // Never fetched.
  }
  if (!fs.existsSync(path.join(root, ARTIFACT_SITE_DIR, ARTIFACT_ENTRY))) have = -1;
  const site = await activeRemote.client.call<RemoteArtifactSite | null>('artifacts:site', id, have);
  if (!site) throw new Error(tr('remote.artifact.none'));
  if (site.files) {
    const dir = path.join(root, ARTIFACT_SITE_DIR);
    fs.rmSync(dir, { recursive: true, force: true });
    for (const file of site.files) {
      const target = resolveInside(dir, file.rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, Buffer.from(file.data, 'base64'));
    }
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(versionFile, String(site.version));
  }
  return { root, version: site.version };
}

/** One screenshot at a time: each one is a whole hidden page, and a grid of cards asks for many at once. */
let thumbnailQueue: Promise<unknown> = Promise.resolve();
const thumbnailRuns = new Map<string, Promise<string | null>>();

/** The artifact's page rendered offscreen once per version and kept as a small JPEG next to it. */
async function artifactThumbnail(id: string): Promise<string | null> {
  if (!ARTIFACT_ID_PATTERN.test(id)) return null;
  try {
    const { root, version } = await artifactFolder(id);
    return version ? await renderThumbnail(root, version) : null;
  } catch {
    return null;
  }
}

function renderThumbnail(root: string, version: number): Promise<string | null> {
  const file = path.join(root, artifactThumbnailName(version));
  const asUrl = (buf: Buffer) => `data:image/jpeg;base64,${buf.toString('base64')}`;
  try {
    return Promise.resolve(asUrl(fs.readFileSync(file)));
  } catch {
    // Not captured yet.
  }
  const key = `${root}:${version}`;
  const running = thumbnailRuns.get(key);
  if (running) return running;
  const run = thumbnailQueue.then(async () => {
    const entry = path.join(root, ARTIFACT_SITE_DIR, ARTIFACT_ENTRY);
    const { width, height, scaledWidth, quality, settleMs, timeoutMs } = ARTIFACT_THUMBNAIL;
    const w = new BrowserWindow({
      icon: WINDOW_ICON,
      width, height, show: false, backgroundColor: '#ffffff',
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, partition: 'artifact-preview', backgroundThrottling: false },
    });
    try {
      w.webContents.setAudioMuted(true);
      w.webContents.session.setPermissionRequestHandler((_wc, _permission, deny) => deny(false));
      w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      await Promise.race([
        w.loadFile(entry).then(() => new Promise((r) => setTimeout(r, settleMs))),
        new Promise((_, reject) => setTimeout(() => reject(new Error('thumbnail timed out')), timeoutMs)),
      ]);
      const image = (await w.webContents.capturePage()).resize({ width: scaledWidth, quality: 'good' });
      const jpeg = image.toJPEG(quality);
      // Older versions' shots are of no use any more.
      for (const old of fs.readdirSync(path.dirname(file))) if (/^thumbnail-\d+\.jpg$/.test(old)) fs.rmSync(path.join(path.dirname(file), old), { force: true });
      fs.writeFileSync(file, jpeg);
      return asUrl(jpeg);
    } catch (err) {
      console.error('[main] artifact thumbnail failed:', err);
      return null;
    } finally {
      if (!w.isDestroyed()) w.destroy();
      thumbnailRuns.delete(key);
    }
  });
  thumbnailQueue = run;
  thumbnailRuns.set(key, run);
  return run;
}

/** Side chats (/btw) that were popped out of their session, by session id. */
const sideWindows = new Map<string, BrowserWindow>();
const dockingSide = new Set<string>();
const sideState = (sessionId: string, w: BrowserWindow | undefined) => ({ sessionId, pinned: !!w && !w.isDestroyed() && w.isAlwaysOnTop(), open: !!w && !w.isDestroyed() });

/** A side chat opens beside the app as its own window; the window shows the same host-held thread as the embedded panel. */
function openSide(sessionId: string) {
  if (!/^[\w-]+$/.test(sessionId)) return;
  const existing = sideWindows.get(sessionId);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return;
  }
  const w = new BrowserWindow({
    icon: WINDOW_ICON,
    width: 440,
    height: 600,
    minWidth: 320,
    minHeight: 320,
    title: tr('side.title'),
    backgroundColor: isDark() ? BG.dark : BG.light,
    autoHideMenuBar: true,
    show: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  sideWindows.set(sessionId, w);
  load(w, 'side', sessionId);
  w.once('ready-to-show', () => w.show());
  harden(w);
  w.on('closed', () => {
    sideWindows.delete(sessionId);
    broadcast('side:window', { sessionId, pinned: false, open: false, docked: dockingSide.delete(sessionId) });
  });
  broadcast('side:window', sideState(sessionId, w));
}

function applyThemeToWindows() {
  const dark = isDark();
  for (const w of [win, settingsWin, ...sideWindows.values()]) {
    if (!w || w.isDestroyed()) continue;
    if (!isMac && (w === win || w === settingsWin)) w.setTitleBarOverlay(overlay(dark));
    w.setBackgroundColor(dark ? BG.dark : BG.light);
  }
}

// ------------------------------------------------------------ remote access

const REMOTE_CONNECTIONS_KEY = 'remoteConnections';
const REMOTE_SERVE_KEY = 'remoteServe';

/** The remote host every window is currently showing; null while they show this machine. */
interface ActiveRemote {
  client: RemoteClient;
  info: RemoteActive;
}
let activeRemote: ActiveRemote | null = null;

const connections = () => store.get<RemoteConnection[]>(REMOTE_CONNECTIONS_KEY, []);
const connectionInfos = (): RemoteConnectionInfo[] => connections().map(({ token, ...rest }) => ({ ...rest, hasToken: !!token }));

/** Windows drop everything they show of the old host and boot again against the new one. */
function resetWindows() {
  terminals.closeAll();
  for (const w of sideWindows.values()) if (!w.isDestroyed()) w.close();
  for (const w of [win, settingsWin]) if (w && !w.isDestroyed()) w.webContents.reload();
}
function closeRemote() {
  activeRemote?.client.close();
  activeRemote = null;
}
async function connectRemote(id: string): Promise<RemoteActive> {
  const conn = connections().find((c) => c.id === id);
  if (!conn) throw new Error('This connection no longer exists.');
  const ping = await pingRemote(conn.url);
  const client: RemoteClient = new RemoteClient({
    url: conn.url,
    token: conn.token,
    onEvent: (event) => {
      if (activeRemote?.client !== client) return;
      // The remote's terminal output reaches the panels the way a local terminal's does.
      if (event.type === 'terminal_data') broadcast('terminal:data', { id: event.id, data: event.data });
      else if (event.type === 'terminal_exit') broadcast('terminal:exit', { id: event.id, code: event.code });
      else broadcast('host:event', event);
    },
    onState: (state) => {
      if (activeRemote?.client !== client) return;
      activeRemote.info.state = state;
      broadcast('host:event', { type: 'remote_link', state });
    },
  });
  await client.start();
  closeRemote();
  activeRemote = { client, info: { id: conn.id, name: conn.name, kind: ping.kind, host: ping.host, state: 'connected' } };
  resetWindows();
  return activeRemote.info;
}
function disconnectRemote() {
  if (!activeRemote) return;
  closeRemote();
  resetWindows();
}
function saveConnection(draft: RemoteConnectionDraft): RemoteConnectionInfo[] {
  const list = connections();
  const existing = draft.id ? list.find((c) => c.id === draft.id) : undefined;
  const token = draft.token?.trim() || existing?.token || '';
  if (!token) throw new Error('Enter the access token shown by the remote.');
  const url = normalizeRemoteUrl(draft.url);
  const entry: RemoteConnection = { id: existing?.id ?? randomUUID(), name: draft.name.trim() || new URL(url).host, url, token };
  store.set(REMOTE_CONNECTIONS_KEY, existing ? list.map((c) => (c.id === entry.id ? entry : c)) : [...list, entry]);
  return connectionInfos();
}
function removeConnection(id: string): RemoteConnectionInfo[] {
  if (activeRemote?.info.id === id) disconnectRemote();
  store.set(REMOTE_CONNECTIONS_KEY, connections().filter((c) => c.id !== id));
  return connectionInfos();
}

// What this machine offers to others.

let remoteServer: RemoteServer | null = null;
let remoteListening = false;
let remoteServeError: string | undefined;
const remoteTunnel = new Tunnel(childEnv());

function serveSettings(): RemoteServeSettings {
  const saved = store.get<Partial<RemoteServeSettings>>(REMOTE_SERVE_KEY, {});
  const settings: RemoteServeSettings = {
    enabled: saved.enabled === true,
    port: saved.port ?? REMOTE_DEFAULT_PORT,
    lan: saved.lan === true,
    tunnel: saved.tunnel === true,
    // The first read mints the token, so it is already there when the owner turns sharing on.
    token: saved.token || newRemoteToken(),
  };
  if (!saved.token) store.set(REMOTE_SERVE_KEY, settings);
  return settings;
}
function serveState(): RemoteServeState {
  const settings = serveSettings();
  const pluginDir = path.join(app.getAppPath(), 'plugin', 'pi-remote');
  return {
    ...settings,
    listening: remoteListening,
    error: remoteServeError,
    urls: [...(remoteTunnel.current.url ? [remoteTunnel.current.url] : []), ...remoteUrls(settings.port, settings.lan)],
    tunnelState: remoteTunnel.current.state,
    tunnelUrl: remoteTunnel.current.url,
    tunnelError: remoteTunnel.current.error,
    clients: remoteServer?.clients ?? 0,
    pluginDir: fs.existsSync(path.join(pluginDir, 'index.js')) ? pluginDir : null,
  };
}
/** Terminal tabs of remote clients: kept apart from this machine's own, and their output goes to the clients' event stream. */
const remoteTerminals = new Terminals({
  data: (id, data) => remoteServer?.publish({ type: 'terminal_data', id, data }),
  exit: (id, code) => remoteServer?.publish({ type: 'terminal_exit', id, code }),
});
async function remoteTerminalCall(method: RemoteTerminalMethod, args: unknown[]): Promise<unknown> {
  switch (method) {
    case 'terminal:list': return remoteTerminals.list(String(args[0]));
    case 'terminal:create': return remoteTerminals.create(String(args[0]), await sessionCwd(String(args[0])), settingsValue().terminalShell);
    case 'terminal:attach': return remoteTerminals.attach(String(args[0]));
    case 'terminal:text': return remoteTerminals.text(String(args[0]), Number(args[1]));
    case 'terminal:write': return remoteTerminals.write(String(args[0]), String(args[1]));
    case 'terminal:resize': return remoteTerminals.resize(String(args[0]), Number(args[1]), Number(args[2]));
    case 'terminal:close': return remoteTerminals.close(String(args[0]));
  }
}
/** What other machines may ask of this one: the agent host and the project lists. */
const serveBackend = {
  kind: 'desktop' as const,
  call: async (method: string, args: unknown[]) => {
    if (isTerminalMethod(method)) return remoteTerminalCall(method, args);
    if (isTransferMethod(method)) return agent.call('host:transfer', method, args);
    if ((REMOTE_WORKSPACE_METHODS as readonly string[]).includes(method)) return workspaceCall(book, method as RemoteWorkspaceMethod, args);
    if (method === 'sessions:remove') remoteTerminals.closeSession(String(args[0]));
    return agent.call(method as Parameters<AgentClient['call']>[0], ...args);
  },
};
async function applyServe(): Promise<RemoteServeState> {
  remoteTunnel.stop();
  await remoteServer?.stop();
  remoteTerminals.closeAll();
  remoteServer = null;
  remoteListening = false;
  remoteServeError = undefined;
  const settings = serveSettings();
  if (settings.enabled) {
    const server = new RemoteServer({ backend: serveBackend, token: settings.token, port: settings.port, lan: settings.lan });
    remoteServer = server;
    try {
      await server.start();
      remoteListening = true;
      // The tunnel takes a few seconds to come up; the settings page polls for its address.
      if (settings.tunnel) void remoteTunnel.start(server.port);
    } catch (err) {
      remoteServer = null;
      remoteServeError = (err as NodeJS.ErrnoException).code === 'EADDRINUSE' ? `Port ${settings.port} is already in use.` : (err as Error).message;
    }
  }
  return serveState();
}
async function setServe(patch: Partial<RemoteServeSettings>) {
  const next = { ...serveSettings(), ...patch };
  if (!isRemotePort(next.port)) {
    throw new Error(`The port must be between ${REMOTE_PORT_RANGE.min} and ${REMOTE_PORT_RANGE.max}.`);
  }
  store.set(REMOTE_SERVE_KEY, next);
  return applyServe();
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
const importAttachments = (sources: AttachmentSource[]) =>
  activeRemote ? uploadAttachments(activeRemote.client, sources) : agent.call<ApiResult<'attachments:import'>>('host:importAttachments', sources);
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

/** Quietly look for a newer release and offer it unless the user turned this off or dismissed that very version. */
async function autoCheckUpdate() {
  const { autoUpdateCheck, ignoredUpdate } = settingsValue();
  if (!autoUpdateCheck) return;
  try {
    const { available } = await checkForUpdate(app.getVersion(), net.fetch);
    if (available && available.version !== ignoredUpdate) broadcast('update:found', available);
  } catch (err) {
    // Offline or rate-limited: try again at the next round.
    console.error('[main] update check failed:', err);
  }
}
function scheduleUpdateChecks() {
  if (!app.isPackaged) return;
  setTimeout(() => void autoCheckUpdate(), UPDATE_FIRST_CHECK_MS).unref();
  setInterval(() => void autoCheckUpdate(), UPDATE_CHECK_INTERVAL_MS).unref();
}

let installing = false;
/** Fetch the newest installer and hand over to it: Windows runs the setup and quits, macOS opens the dmg. */
async function installUpdate() {
  if (installing) return;
  installing = true;
  try {
    const { available } = await checkForUpdate(app.getVersion(), net.fetch);
    if (!available) throw new Error(tr('update.upToDate'));
    if (!available.asset) throw new Error(tr('update.noInstaller'));
    const file = await downloadInstaller(available.asset, path.join(app.getPath('temp'), 'pi-desktop-update'), net.fetch, (p) => broadcast('update:progress', p));
    broadcast('update:progress', { stage: 'launching', received: 0, total: 0 });
    if (process.platform === 'win32') {
      spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
      app.quit();
    } else {
      const error = await shell.openPath(file);
      if (error) throw new Error(error);
    }
  } finally {
    installing = false;
  }
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
  'update:check': () => checkForUpdate(app.getVersion(), net.fetch),
  'update:install': () => installUpdate(),
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
  'pets:save': (pet) => {
    savePet(appPetsDir(dataDir()), pet);
    return petsChanged();
  },
  'pets:remove': (id) => {
    removePet(appPetsDir(dataDir()), String(id));
    // A deleted skin that was in use falls back to the default one.
    if (settingsValue().petSkin === id) store.set('settings', { ...settingsValue(), petSkin: DEFAULT_PET_ID });
    return petsChanged();
  },
  'settings:close': () => settingsWin?.close(),
  'diagram:open': (svg) => openDiagram(svg),
  'side:pop': (sessionId) => openSide(String(sessionId)),
  'side:pin': (sessionId, pinned) => {
    const w = sideWindows.get(sessionId);
    if (!w || w.isDestroyed()) return;
    // 'floating' keeps it above full-screen apps on macOS too.
    w.setAlwaysOnTop(!!pinned, 'floating');
    broadcast('side:window', sideState(sessionId, w));
  },
  'side:dock': (sessionId) => {
    const w = sideWindows.get(sessionId);
    if (!w || w.isDestroyed()) return;
    dockingSide.add(sessionId);
    w.close();
  },
  'side:windows': () => [...sideWindows].filter(([, w]) => !w.isDestroyed()).map(([id, w]) => ({ sessionId: id, pinned: w.isAlwaysOnTop() })),
  'diagram:get': (token) => diagrams.get(token) ?? null,
  'artifacts:preview': (id) => openArtifact(String(id)),
  'artifacts:thumbnail': (id) => artifactThumbnail(String(id)),

  'projects:list': () => projects(),
  'projects:add': async () => {
    const dir = await pickFolder();
    if (!dir) return null;
    pendingWorktree = null;
    // A worktree of another repository is not added blindly: the user decides what it means.
    const info = await agent.call<WorktreeInfo | null>('host:worktree', dir).catch(() => null);
    if (info && fs.existsSync(info.mainRoot)) {
      pendingWorktree = info;
      return { kind: 'worktree', info, known: store.get<Project[]>('projects', []).some((p) => p.path === info.mainRoot) };
    }
    return { kind: 'added', project: addProject(dir) };
  },
  'projects:adoptWorktree': (choice) => {
    const info = pendingWorktree;
    pendingWorktree = null;
    if (!info) return null;
    return choice === 'session' ? { project: addProject(info.mainRoot), adopt: info } : { project: addProject(info.path), adopt: null };
  },
  'projects:remove': (dir) => {
    store.set('projects', store.get<Project[]>('projects', []).filter((p) => p.path !== dir));
    return projects();
  },
  'projects:addPath': (dir) => addProject(existingFolder(dir)),
  'work:addPath': (dir) => addWorkFolder(existingFolder(dir)),
  'remote:browse': (dir) => browse(dir),
  'remote:list': () => ({ connections: connectionInfos(), active: activeRemote?.info ?? null }),
  'remote:save': (draft) => saveConnection(draft),
  'remote:remove': (id) => removeConnection(id),
  'remote:connect': (id) => connectRemote(id),
  'remote:disconnect': () => disconnectRemote(),
  'remote:serveGet': () => serveState(),
  'remote:serveSet': (patch) => setServe(patch || {}),
  'remote:serveRotate': () => setServe({ token: newRemoteToken() }),
  'work:folders': () => workFolders(),
  'work:addFolder': async () => {
    const dir = await pickFolder();
    return dir ? addWorkFolder(dir) : null;
  },
  'work:useFolder': (dir) => (fs.existsSync(dir) ? addWorkFolder(dir) : null),
  'work:removeFolder': (dir) => book.removeWorkFolder(dir),
  'work:update': (dir, patch) => book.updateWorkFolder(dir, patch),

  'attachments:import': (sources) => importAttachments(sources),
  'attachments:pick': async () => {
    const options = { title: tr('composer.addFiles'), properties: ['openFile', 'multiSelections'] as const };
    const r = win ? await dialog.showOpenDialog(win, { ...options, properties: [...options.properties] }) : await dialog.showOpenDialog({ ...options, properties: [...options.properties] });
    return r.canceled ? { attachments: [], errors: [] } : importAttachments(r.filePaths.map((p) => ({ path: p })));
  },
  // SAFETY: Electron's async clipboard.read is available at runtime but absent from its bundled type declarations.
  'attachments:clipboard': () =>
    clipboardAttachments(() => (clipboard as unknown as { read(): Promise<ClipboardItemLike[]> }).read(), importAttachments),

  'app:openTargets': () => openTargets(),
  'terminal:shells': () => terminalShells(),
  'terminal:list': (sessionId) => terminals.list(sessionId),
  'terminal:create': async (sessionId) => terminals.create(sessionId, await sessionCwd(sessionId), settingsValue().terminalShell),
  'terminal:attach': (id) => terminals.attach(id),
  'terminal:text': (id, lines) => terminals.text(id, lines),
  'terminal:write': (id, data) => terminals.write(id, data),
  'terminal:resize': (id, cols, rows) => terminals.resize(id, cols, rows),
  'terminal:close': (id) => terminals.close(id),
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

/** Main-handled calls a remote host answers itself. */
const REMOTE_ROUTED = new Set<string>([...REMOTE_WORKSPACE_METHODS, ...REMOTE_TERMINAL_METHODS]);
/** Calls that act on this machine's own files and windows, and so have no remote counterpart. */
const LOCAL_ONLY = new Set<string>(['projects:add', 'projects:adoptWorktree', 'work:addFolder', 'sessions:openIn', 'sessions:openPath', 'update:install']);

function registerIpc() {
  // Read synchronously by the preload: every window boots with the right theme,
  // sidebar state and default mode instead of flashing a fallback first.
  ipcMain.on('app:boot', (e) => {
    e.returnValue = {
      settings: settingsPayload(),
      info: { platform: process.platform, version: app.getVersion(), demo: DEMO, agentDir: piAgentDir() },
      remote: activeRemote?.info ?? null,
    } satisfies BootPayload;
  });
  for (const channel of MAIN_CHANNELS) {
    const fn = handlers[channel] as (...args: unknown[]) => unknown;
    ipcMain.handle(channel, (_e, ...args) => {
      if (activeRemote) {
        // The remote owns the folder lists; what needs this machine's own shell or file manager has no meaning there.
        if (REMOTE_ROUTED.has(channel)) return activeRemote.client.call(channel, ...args);
        if (LOCAL_ONLY.has(channel)) throw new Error('Not available while driving a remote host.');
      }
      return fn(...args);
    });
  }
  for (const channel of HOST_CHANNELS) {
    ipcMain.handle(channel, (_e, ...args) => {
      if (activeRemote) return activeRemote.client.call(channel, ...args);
      // Shells go first: one sitting in the session's worktree would keep it from being deleted.
      if (channel === 'sessions:remove') {
        terminals.closeSession(String(args[0]));
        remoteTerminals.closeSession(String(args[0]));
      }
      return agent.call(channel, ...args);
    });
  }
}

// ------------------------------------------------------------ app

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', showMainWindow);

void app.whenReady().then(async () => {
  store = new Store(dataDir());
  setActiveLocale(currentLocale());
  book = new ProjectBook(store);
  migrateLegacyKeys(store);
  // Own folders only; Electron's Chromium profile is left to its platform default.
  fs.mkdirSync(appExtensionsDir(dataDir()), { recursive: true });
  watchPets();
  watchSettings();
  try {
    fs.mkdirSync(worktreeDir(dataDir(), settingsValue().worktreeDir), { recursive: true });
  } catch (err) {
    // An unmounted custom worktree volume must not keep the app from starting.
    console.error('[main] cannot create the worktree folder:', err);
  }
  nativeTheme.themeSource = ['light', 'dark'].includes(String(settingsValue().theme)) ? (settingsValue().theme as 'light' | 'dark') : 'system';
  agent = new AgentClient(
    path.join(here, 'agent.mjs'),
    () => ({ dataDir: dataDir(), agentDir: piAgentDir(), demo: DEMO_ALLOWED, locale: currentLocale() }),
    (event: HostEvent) => {
      // While a remote host is shown, this machine's own sessions stay out of the windows (but still reach the clients it serves).
      if (!activeRemote) broadcast('host:event', event);
      remoteServer?.publish(event);
    },
  );
  void agent.start().catch((err) => console.error('[main] agent host failed to start:', err));
  if (DEMO || (DEMO_ALLOWED && !projects().length)) ensureDemoProject();
  if (DEMO || (DEMO_ALLOWED && !workFolders().length)) ensureDemoWork();
  registerIpc();
  void applyServe();
  nativeTheme.on('updated', () => {
    // Following the system: repaint both windows and tell the renderers.
    if (settingsValue().theme === 'light' || settingsValue().theme === 'dark') return;
    applyThemeToWindows();
    broadcast('settings:changed', settingsPayload());
  });
  createWindow();
  scheduleUpdateChecks();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

let quitting = false;
app.on('before-quit', async (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  terminals.closeAll();
  closeRemote();
  remoteTunnel.stop();
  await remoteServer?.stop().catch(() => {});
  await agent?.stop().catch(() => {});
  app.quit();
});
app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

