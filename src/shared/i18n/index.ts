import { DEFAULT_LOCALE, type Locale } from './locales';
import { MESSAGES, type MessageKey } from './messages';

export * from './locales';
export type { MessageKey };
export type MessageParams = Record<string, string | number>;

/** Look a message up and fill its `{name}` placeholders; a language missing the entry falls back to English. */
export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const entry = MESSAGES[key];
  const text = entry[locale] ?? entry[DEFAULT_LOCALE];
  return params ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m)) : text;
}
