import { useCallback, useSyncExternalStore } from 'react';
import type { SettingsPayload } from '@shared/protocol';
import { DEFAULT_LOCALE, matchLocale, translate, type Locale, type MessageKey, type MessageParams } from '@shared/i18n';
import { activeLocale, setActiveLocale, tr } from '@shared/i18n/runtime';

// Read off `window` directly (not through `./api`) so pure helpers that translate can still load outside a window.
const bridge = typeof window === 'undefined' ? undefined : window.piDesktop;
const listeners = new Set<() => void>();

function setLocale(next: Locale) {
  if (next === activeLocale()) return;
  setActiveLocale(next);
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  for (const l of listeners) l();
}

// The main process resolves "system" to a concrete locale; windows boot with it and follow `settings:changed`.
setActiveLocale(
  bridge?.boot?.settings?.locale ?? matchLocale(typeof navigator === 'undefined' ? null : navigator.language),
);
if (typeof document !== 'undefined') document.documentElement.lang = activeLocale();
bridge?.on?.('settings:changed', (s: Partial<SettingsPayload>) => setLocale(s?.locale ?? DEFAULT_LOCALE));

export const getLocale = activeLocale;
/** Translate outside a component (event handlers, store actions); components use `useT` so they re-render on a language change. */
export const t = tr;

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale);
}
export function useT() {
  const locale = useLocale();
  return useCallback((key: MessageKey, params?: MessageParams) => translate(locale, key, params), [locale]);
}
