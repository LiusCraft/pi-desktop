const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, safeStorage, Notification } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Store, KEY_ENV, envForKeys } = require('./store');
const { SessionHub } = require('./sessions');
const git = require('./git');

app.setName('Pi Desktop');
const DEMO = process.argv.includes('--demo');
const isMac = process.platform === 'darwin';
let win = null;
let settingsWin = null;
let store, hub;

// ------------------------------------------------------------ API keys (encrypted at rest when the OS supports it)
function readKeys() {
  const raw = store.get('keys', {});
  const out = {};
  for (const [provider, v] of Object.entries(raw)) {
    try {
      out[provider] = v.enc && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(v.value, 'base64')) : v.value;
    } catch {}
  }
  return out;
}
function writeKey(provider, key) {
  const raw = store.get('keys', {});
  if (!key) delete raw[provider];
  else if (safeStorage.isEncryptionAvailable()) raw[provider] = { enc: true, value: safeStorage.encryptString(key).toString('base64') };
  else raw[provider] = { enc: false, value: key };
  store.set('keys', raw);
}
function piEnv() {
  return envForKeys(readKeys());
}

// ------------------------------------------------------------ projects
function projects() {
  return store.get('projects', []).filter((p) => fs.existsSync(p.path));
}
function addProject(dir) {
  const list = store.get('projects', []).filter((p) => p.path !== dir);
  const project = { path: dir, name: path.basename(dir), addedAt: Date.now() };
  store.set('projects', [project, ...list]);
  return project;
}

// Cowork folders the user has worked in, most recent first.
function coworkFolders() {
  return store.get('coworkFolders', []).filter((p) => fs.existsSync(p.path));
}
function addCoworkFolder(dir) {
  const list = store.get('coworkFolders', []).filter((p) => p.path !== dir);
  const folder = { path: dir, name: path.basename(dir), addedAt: Date.now() };
  store.set('coworkFolders', [folder, ...list].slice(0, 12));
  return folder;
}
function ensureDemoCowork() {
  const dest = path.join(app.getPath('userData'), 'demo', 'cowork-workspace');
  if (!fs.existsSync(dest)) fs.cpSync(path.join(__dirname, '..', 'demo', 'cowork-workspace'), dest, { recursive: true });
  return addCoworkFolder(dest);
}

// Copy the bundled demo project into userData and make it a git repo.
function ensureDemoProject() {
  const dest = path.join(app.getPath('userData'), 'demo', 'todo-app');
  if (!fs.existsSync(dest)) {
    const src = path.join(__dirname, '..', 'demo', 'todo-app').replace('app.asar', 'app.asar.unpacked');
    fs.cpSync(src, dest, { recursive: true });
    try {
      const g = (...a) => execFileSync('git', a, { cwd: dest, stdio: 'ignore' });
      g('init', '-q', '-b', 'main');
      g('add', '-A');
      g('-c', 'user.name=Pi Desktop', '-c', 'user.email=demo@pi.desktop', 'commit', '-qm', 'Initial commit');
    } catch {} // git is optional: diffs simply stay empty without it
  }
  return addProject(dest);
}

// ------------------------------------------------------------ settings
// Preferences live in one place so every window reads the same values.
// `theme: null` means "not chosen yet": the renderer keeps its local value.
const DEFAULT_SETTINGS = { theme: null, notify: true, defaultMode: 'code', sidebarCollapsed: false };

function settingsValue() {
  return { ...DEFAULT_SETTINGS, ...store.get('settings', {}) };
}
function settingsPayload() {
  const s = settingsValue();
  const explicit = s.theme === 'light' || s.theme === 'dark';
  let resolvedTheme = 'light';
  if (explicit) resolvedTheme = s.theme;
  else if (nativeTheme.shouldUseDarkColors) resolvedTheme = 'dark';
  return { ...s, resolvedTheme, secureKeys: safeStorage.isEncryptionAvailable() };
}
function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
}
function saveSettings(patch) {
  const next = { ...settingsValue(), ...patch };
  store.set('settings', next);
  // Native chrome (title bar, menus, dialogs) follows the app's appearance.
  nativeTheme.themeSource = ['light', 'dark'].includes(next.theme) ? next.theme : 'system';
  applyThemeToWindows();
  const payload = settingsPayload();
  broadcast('settings:changed', payload);
  return payload;
}

// ------------------------------------------------------------ window
function overlayColors(dark) {
  return dark ? { color: '#1f1f1e', symbolColor: '#c3c1bb', height: 44 } : { color: '#f7f6f2', symbolColor: '#55534d', height: 44 };
}

function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 720,
    minHeight: 480,
    title: 'Pi Desktop',
    backgroundColor: dark ? '#1f1f1e' : '#f7f6f2',
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 18, y: 17 } } : { titleBarOverlay: overlayColors(dark) }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('closed', () => (win = null));
}

function createSettingsWindow(section) {
  const dark = settingsPayload().resolvedTheme === 'dark';
  settingsWin = new BrowserWindow({
    width: 800,
    height: 640,
    minWidth: 660,
    minHeight: 460,
    title: 'Settings',
    backgroundColor: dark ? '#1d1d1c' : '#f7f6f2',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 16, y: 18 } } : { titleBarOverlay: overlayColors(dark) }),
    show: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  settingsWin.loadFile(path.join(__dirname, '..', 'renderer', 'settings.html'), section ? { hash: section } : undefined);
  settingsWin.once('ready-to-show', () => settingsWin?.show());
  settingsWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  settingsWin.webContents.on('will-navigate', (e) => e.preventDefault());
  settingsWin.on('closed', () => (settingsWin = null));
}

// Show the existing settings window instead of stacking duplicates.
function openSettings(section) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (section) settingsWin.webContents.send('settings:section', section);
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show();
    settingsWin.focus();
    return true;
  }
  createSettingsWindow(section);
  return true;
}

function applyThemeToWindows() {
  const dark = settingsPayload().resolvedTheme === 'dark';
  if (!isMac) {
    win?.setTitleBarOverlay(overlayColors(dark));
    settingsWin?.setTitleBarOverlay(overlayColors(dark));
  }
  win?.setBackgroundColor(dark ? '#1f1f1e' : '#f7f6f2');
  settingsWin?.setBackgroundColor(dark ? '#1d1d1c' : '#f7f6f2');
}

const send = (channel, payload) => win?.webContents.send(channel, payload);

// ------------------------------------------------------------ IPC
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => fn(...args));
}

function registerIpc() {
  // Read synchronously by the preload: every window boots with the right theme,
  // sidebar state and default mode instead of flashing a fallback first.
  ipcMain.on('app:boot', (e) => {
    e.returnValue = {
      settings: settingsPayload(),
      info: { platform: process.platform, version: app.getVersion(), demo: DEMO, keyProviders: Object.keys(KEY_ENV) },
    };
  });

  handle('app:info', () => ({
    platform: process.platform,
    version: app.getVersion(),
    demo: DEMO,
    userData: app.getPath('userData'),
    keyProviders: Object.keys(KEY_ENV),
    versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
  }));
  handle('app:theme', (theme) => {
    if (!isMac && win) win.setTitleBarOverlay(overlayColors(theme === 'dark'));
  });
  handle('app:notify', ({ title, body }) => {
    if (settingsValue().notify === false) return;
    if (Notification.isSupported() && !win?.isFocused()) new Notification({ title, body }).show();
  });
  handle('app:openExternal', (url) => /^https?:/.test(url) && shell.openExternal(url));
  // Reveal or open a folder the app already knows about; anything else is refused.
  handle('app:revealPath', (target, reveal) => {
    const abs = path.resolve(String(target || ''));
    const roots = [app.getPath('userData'), ...projects().map((p) => p.path), ...coworkFolders().map((p) => p.path)];
    if (!roots.some((r) => abs === path.resolve(r) || abs.startsWith(path.resolve(r) + path.sep))) throw new Error('Path outside the app folders');
    if (reveal) return shell.showItemInFolder(abs);
    return fs.statSync(abs).isDirectory() ? shell.openPath(abs) : shell.showItemInFolder(abs);
  });

  handle('settings:open', (section) => openSettings(section));
  handle('settings:get', () => settingsPayload());
  handle('settings:set', (patch) => saveSettings(patch || {}));
  handle('settings:close', () => settingsWin?.close());

  handle('projects:list', () => projects());
  handle('projects:add', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : addProject(r.filePaths[0]);
  });
  handle('projects:demo', () => ensureDemoProject());
  handle('projects:info', async (dir) => ({ root: await git.repoRoot(dir), branch: await git.currentBranch(dir) }));
  handle('projects:remove', (dir) => {
    store.set('projects', store.get('projects', []).filter((p) => p.path !== dir));
    return projects();
  });

  handle('cowork:folders', () => coworkFolders());
  handle('cowork:addFolder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : addCoworkFolder(r.filePaths[0]);
  });
  handle('cowork:useFolder', (dir) => (fs.existsSync(dir) ? addCoworkFolder(dir) : null));
  handle('cowork:removeFolder', (dir) => {
    store.set('coworkFolders', store.get('coworkFolders', []).filter((p) => p.path !== dir));
    return coworkFolders();
  });
  handle('dialog:pickFiles', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
    return r.canceled ? [] : r.filePaths;
  });

  handle('sessions:list', () => hub.list());
  handle('sessions:create', (opts) => hub.create(opts));
  handle('sessions:open', (id) => hub.open(id));
  handle('sessions:prompt', (id, message, behavior) => hub.prompt(id, message, behavior));
  handle('sessions:rpc', (id, command) => hub.rpc(id, command));
  handle('sessions:ui', (id, requestId, payload) => hub.uiResponse(id, requestId, payload));
  handle('sessions:mode', (id, mode) => hub.setMode(id, mode));
  handle('sessions:style', (id, style) => hub.setOutputStyle(id, style));
  handle('sessions:update', (id, patch) => hub.update(id, patch));
  handle('sessions:archive', (id) => hub.archive(id));
  handle('sessions:changes', (id) => hub.changes(id));
  handle('sessions:pr', (id) => hub.prStatus(id));
  handle('sessions:files', (id) => git.listFiles(hub.meta(id).cwd));
  handle('sessions:readFile', (id, rel) => {
    const root = path.resolve(hub.meta(id).cwd);
    const abs = path.resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('Path outside the session');
    const buf = fs.readFileSync(abs);
    return buf.length > 1024 * 1024 || buf.includes(0) ? null : buf.toString('utf8');
  });
  handle('sessions:importable', (dir) => hub.importable(dir));
  handle('sessions:import', (file) => hub.importSession(file));
  handle('sessions:openIn', (id, target) => git.openIn(target, hub.meta(id).cwd, shell));
  // Open or reveal a file the agent produced, constrained to the session folder.
  handle('sessions:openPath', (id, rel, reveal) => {
    const root = path.resolve(hub.meta(id).cwd);
    const abs = path.resolve(root, rel || '.');
    if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('Path outside the session');
    if (reveal) return shell.showItemInFolder(abs);
    return shell.openPath(abs);
  });

  handle('models:list', () => hub.models());
  handle('models:levels', (model) => hub.thinkingLevels(model));

  handle('keys:list', () => Object.keys(readKeys()));
  handle('keys:status', () => {
    const saved = readKeys();
    return Object.fromEntries(Object.entries(KEY_ENV).map(([provider, env]) => [provider, {
      env,
      saved: Boolean(saved[provider]),
      envSet: Boolean(process.env[env]),
    }]));
  });
  handle('keys:set', async (provider, key) => {
    writeKey(provider, key);
    await hub.restartProbe(); // new key → new model list
    return Object.keys(readKeys());
  });
}

// ------------------------------------------------------------ app
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  hub = new SessionHub({ store, userData: app.getPath('userData'), getEnv: piEnv });
  hub.on('event', (p) => send('pi:event', p));
  hub.on('exit', (p) => send('pi:exit', p));
  hub.on('status', (p) => send('pi:status', p));
  if (DEMO || !projects().length) ensureDemoProject();
  if (DEMO || !coworkFolders().length) ensureDemoCowork();
  registerIpc();
  nativeTheme.on('updated', () => {
    // Following the system: repaint both windows and tell the renderers.
    if (['light', 'dark'].includes(settingsValue().theme)) return;
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
  await hub?.stopAll().catch(() => {});
  app.quit();
});
app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
