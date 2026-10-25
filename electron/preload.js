// Narrow, explicit bridge between the renderer and the main process.
const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = new Set([
  'app:info', 'app:theme', 'app:notify', 'app:openExternal',
  'projects:list', 'projects:add', 'projects:demo', 'projects:info',
  'sessions:list', 'sessions:create', 'sessions:open', 'sessions:prompt', 'sessions:rpc', 'sessions:ui',
  'sessions:mode', 'sessions:style', 'sessions:update', 'sessions:archive', 'sessions:changes', 'sessions:pr', 'sessions:files',
  'sessions:importable', 'sessions:import', 'sessions:openIn', 'sessions:readFile',
  'models:list', 'models:levels', 'keys:list', 'keys:set',
  'cowork:folders', 'cowork:addFolder', 'cowork:useFolder', 'dialog:pickFiles', 'sessions:openPath',
]);
const EVENTS = new Set(['pi:event', 'pi:exit', 'pi:status']);

contextBridge.exposeInMainWorld('piDesktop', {
  platform: process.platform,
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
