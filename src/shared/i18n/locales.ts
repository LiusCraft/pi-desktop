/** The languages the app ships; add one here and every message entry must then provide it. */
export const LOCALES = ['en', 'zh'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
/** What the Settings page stores: a language, or "system" to follow the OS. */
export type LanguageSetting = 'system' | Locale;
/** Names are written in their own language, so a user can find theirs whatever the UI currently says. */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', zh: '简体中文' };

/** Map an OS/browser language tag ("zh-CN", "en_US") to a shipped locale. */
export function matchLocale(tag: string | undefined | null): Locale {
  const lang = String(tag ?? '')
    .toLowerCase()
    .split(/[-_]/)[0];
  return (LOCALES as readonly string[]).includes(lang) ? (lang as Locale) : DEFAULT_LOCALE;
}

export function resolveLocale(
  setting: LanguageSetting | null | undefined,
  systemTag: string | undefined | null,
): Locale {
  return setting && setting !== 'system' ? setting : matchLocale(systemTag);
}
