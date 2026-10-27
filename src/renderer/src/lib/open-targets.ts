import { useEffect, useSyncExternalStore } from 'react';
import type { OpenTarget, OpenTargetEntry } from '@shared/protocol';
import { call, isMac } from '@/lib/api';
import { t } from '@/lib/i18n';

export interface OpenTargetInfo { label: string; badge: string; color: string }

export const OPEN_TARGET_INFO: Record<OpenTarget, OpenTargetInfo> = {
  vscode: { label: 'VS Code', badge: 'VS', color: '#2f80ed' },
  'vscode-insiders': { label: 'VS Code Insiders', badge: 'VI', color: '#1f9d55' },
  cursor: { label: 'Cursor', badge: 'Cu', color: '#3a3a3a' },
  windsurf: { label: 'Windsurf', badge: 'Ws', color: '#0b8f8c' },
  trae: { label: 'Trae', badge: 'Tr', color: '#d6336c' },
  antigravity: { label: 'Antigravity', badge: 'Ag', color: '#4285f4' },
  vscodium: { label: 'VSCodium', badge: 'Vc', color: '#2f8f9d' },
  zed: { label: 'Zed', badge: 'Z', color: '#084ccf' },
  sublime: { label: 'Sublime Text', badge: 'St', color: '#e8890c' },
  idea: { label: 'IntelliJ IDEA', badge: 'IJ', color: '#fe315d' },
  webstorm: { label: 'WebStorm', badge: 'WS', color: '#0ba5c9' },
  pycharm: { label: 'PyCharm', badge: 'PC', color: '#21a366' },
  goland: { label: 'GoLand', badge: 'GO', color: '#079bd9' },
  rustrover: { label: 'RustRover', badge: 'RR', color: '#ff7a00' },
  clion: { label: 'CLion', badge: 'CL', color: '#1fa37a' },
  phpstorm: { label: 'PhpStorm', badge: 'PS', color: '#b345f1' },
  terminal: { get label() { return t('open.terminal'); }, badge: '>_', color: '#444' },
  folder: { get label() { return t(isMac ? 'open.finder' : 'open.explorer'); }, badge: 'F', color: '#e3a21a' },
};

const REFRESH_AFTER = 30_000;
let targets: OpenTargetEntry[] = [{ id: 'terminal' }, { id: 'folder' }];
let loadedAt = 0;
const listeners = new Set<() => void>();

/** Ask main which editors are installed; throttled, since every file row and menu calls it. */
export function refreshOpenTargets() {
  if (Date.now() - loadedAt < REFRESH_AFTER) return;
  loadedAt = Date.now();
  call('app:openTargets').then((next) => {
    targets = next;
    listeners.forEach((l) => l());
  }).catch(() => { loadedAt = 0; });
}

export function useOpenTargets(): OpenTargetEntry[] {
  useEffect(refreshOpenTargets, []);
  return useSyncExternalStore((l) => { listeners.add(l); return () => void listeners.delete(l); }, () => targets);
}
