const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, safeStorage, Notification, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Store, KEY_ENV, envForKeys } = require('./store');
const { SessionHub } = require('./sessions');
const git = require('./git');
const attachments = require('./attachments');
const { readSessionFile } = require('./files');

app.setName('Pi Desktop');
const DEMO = process.argv.includes('--demo');
const isMac = process.platform === 'darwin';
let win = null;
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

const send = (channel, payload) => win?.webContents.send(channel, payload);

// ------------------------------------------------------------ IPC
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => fn(...args));
}

function registerIpc() {
  handle('app:info', () => ({
    platform: process.platform,
    version: app.getVersion(),
    demo: DEMO,
    userData: app.getPath('userData'),
    keyProviders: Object.keys(KEY_ENV),
  }));
  handle('app:theme', (theme) => {
    if (!isMac && win) win.setTitleBarOverlay(overlayColors(theme === 'dark'));
  });
  handle('app:notify', ({ title, body }) => {
    if (Notification.isSupported() && !win?.isFocused()) new Notification({ title, body }).show();
  });
  handle('app:openExternal', (url) => /^https?:/.test(url) && shell.openExternal(url));

  handle('projects:list', () => projects());
  handle('projects:add', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : addProject(r.filePaths[0]);
  });
  handle('projects:demo', () => ensureDemoProject());
  handle('projects:info', async (dir) => ({ root: await git.repoRoot(dir), branch: await git.currentBranch(dir) }));

  handle('cowork:folders', () => coworkFolders());
  handle('cowork:addFolder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : addCoworkFolder(r.filePaths[0]);
  });
  handle('cowork:useFolder', (dir) => (fs.existsSync(dir) ? addCoworkFolder(dir) : null));
  handle('dialog:pickFiles', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
    return r.canceled ? [] : r.filePaths;
  });

  handle('attachments:import', (sources) => attachments.importAttachments(sources));
  handle('attachments:pick', () => attachments.pickAttachments(dialog, win));
  handle('attachments:clipboard', () => attachments.clipboardAttachments(clipboard));

  handle('sessions:list', () => hub.list());
  handle('sessions:create', (opts) => hub.create(opts));
  handle('sessions:open', (id) => hub.open(id));
  handle('sessions:prompt', (id, payload, behavior) => hub.prompt(id, payload, behavior));
  handle('sessions:rpc', (id, command) => hub.rpc(id, command));
  handle('sessions:ui', (id, requestId, payload) => hub.uiResponse(id, requestId, payload));
  handle('sessions:mode', (id, mode) => hub.setMode(id, mode));
  handle('sessions:style', (id, style) => hub.setOutputStyle(id, style));
  handle('sessions:update', (id, patch) => hub.update(id, patch));
  handle('sessions:archive', (id) => hub.archive(id));
  handle('sessions:changes', (id) => hub.changes(id));
  handle('sessions:pr', (id) => hub.prStatus(id));
  handle('sessions:files', (id) => git.listFiles(hub.meta(id).cwd));
  handle('sessions:readFile', (id, rel) => readSessionFile(hub.meta(id).cwd, rel));
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
