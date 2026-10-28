import { useEffect } from 'react';
import type { SettingsPayload } from '@shared/protocol';
import { bridge } from './api';

/** A font setting as a CSS family list: a single name is quoted, a list the user wrote is kept as is. */
export const fontFamilyCss = (font: string) => (/[,"']/.test(font) ? font : `"${font}"`);

/** The custom font (if any) leading `fallback`, a CSS font list. */
export const fontStack = (font: string | null | undefined, fallback: string) => (font?.trim() ? `${fontFamilyCss(font.trim())}, ${fallback}` : fallback);

function applyFont(name: string, font: string | null | undefined, system: string) {
  const style = document.documentElement.style;
  if (font?.trim()) style.setProperty(name, fontStack(font, `var(${system})`));
  else style.removeProperty(name);
}

/** Settings own the theme; the main process resolves "system" for us. */
export function applyTheme(settings: Partial<SettingsPayload> | undefined) {
  applyFont('--app-font-sans', settings?.uiFont, '--system-font-sans');
  applyFont('--app-font-mono', settings?.codeFont, '--system-font-mono');
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
