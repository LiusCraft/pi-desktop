// Narrow, explicit bridge between the renderer and the main process: only the
// channels in the shared protocol, never ipcRenderer or Node APIs themselves.
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { API_CHANNELS, PUSH_CHANNELS, type ApiChannel, type BootPayload, type PushChannel } from '@shared/protocol';
import type { DesktopBridge } from './api';

const invokable = new Set<string>(API_CHANNELS);
const pushable = new Set<string>(PUSH_CHANNELS);

// Settings the window needs before its first paint. Synchronous on purpose: it
// runs once during preload, so the theme and layout never flash a wrong value.
let boot: Partial<BootPayload> = {};
try {
  boot = ipcRenderer.sendSync('app:boot') || {};
} catch {}

const bridge: DesktopBridge = {
  platform: process.platform,
  boot,
  getPathForFile(file) {
    // Only Electron can recover a dropped File's native path. Never expose
    // webUtils itself or arbitrary filesystem operations to the renderer.
    return webUtils.getPathForFile(file);
  },
  invoke(channel: ApiChannel, ...args: unknown[]) {
    if (!invokable.has(channel)) throw new Error(`Blocked IPC channel: ${channel}`);
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel: PushChannel, cb: (payload: any) => void) {
    if (!pushable.has(channel)) throw new Error(`Blocked IPC channel: ${channel}`);
    const listener = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
} as DesktopBridge;

contextBridge.exposeInMainWorld('piDesktop', bridge);
