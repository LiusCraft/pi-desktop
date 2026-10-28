import { useEffect } from 'react';
import type { SettingsPayload } from '@shared/protocol';
import { bridge } from './api';

/** Settings own the theme; the main process resolves "system" for us. */
export function applyTheme(settings: Partial<SettingsPayload> | undefined) {
  const dark = (settings?.resolvedTheme ?? 'light') === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.dataset.palette = settings?.palette ?? 'default';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

// First paint already uses the boot settings (read synchronously by the preload).
applyTheme(bridge?.boot?.settings);

export function useTheme() {
  useEffect(() => bridge.on('settings:changed', applyTheme), []);
}

export const resolvedTheme = () => (document.documentElement.classList.contains('dark') ? 'dark' : 'light');
