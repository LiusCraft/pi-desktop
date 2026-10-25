// Narrow, explicit bridge between the renderer and the main process.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const INVOKE = new Set([
  'app:info', 'app:theme', 'app:notify', 'app:openExternal', 'app:revealPath',
  'projects:list', 'projects:add', 'projects:demo', 'projects:info', 'projects:remove',
  'sessions:list', 'sessions:create', 'sessions:open', 'sessions:prompt', 'sessions:rpc', 'sessions:ui',
  'sessions:mode', 'sessions:style', 'sessions:update', 'sessions:archive', 'sessions:changes', 'sessions:pr', 'sessions:files',
  'sessions:importable', 'sessions:import', 'sessions:openIn', 'sessions:readFile',
  'models:list', 'models:levels', 'keys:list', 'keys:set', 'keys:status',
  'attachments:import', 'attachments:pick', 'attachments:clipboard',
  'cowork:folders', 'cowork:addFolder', 'cowork:useFolder', 'cowork:removeFolder', 'dialog:pickFiles', 'sessions:openPath',
  'settings:open', 'settings:get', 'settings:set', 'settings:close',
]);
const EVENTS = new Set(['pi:event', 'pi:exit', 'pi:status', 'settings:changed', 'settings:section']);

// Settings the window needs before its first paint. Synchronous on purpose: it
// runs once during preload, so the theme and layout never flash a wrong value.
let boot = {};
try {
  boot = ipcRenderer.sendSync('app:boot') || {};
} catch {}

contextBridge.exposeInMainWorld('piDesktop', {
  platform: process.platform,
  boot,
  getPathForFile(file) {
    // Only Electron can recover a dropped File's native path. Never expose
    // webUtils itself or arbitrary filesystem operations to the renderer.
    return webUtils.getPathForFile(file);
  },
  invoke(channel, ...args) {
    if (!INVOKE.has(channel)) throw new Error(`Blocked IPC channel: ${channel}`);
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel, cb) {
    if (!EVENTS.has(channel)) throw new Error(`Blocked IPC channel: ${channel}`);
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
