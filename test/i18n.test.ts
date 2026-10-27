import { describe, expect, it } from 'vitest';
import { LOCALES, matchLocale, resolveLocale, translate } from '../src/shared/i18n';
import { MESSAGES } from '../src/shared/i18n/messages';

describe('i18n', () => {
  it('maps OS language tags to a shipped locale and falls back to English', () => {
    expect(matchLocale('zh-CN')).toBe('zh');
    expect(matchLocale('en_US')).toBe('en');
    expect(matchLocale('fr-FR')).toBe('en');
    expect(matchLocale(undefined)).toBe('en');
  });

  it('lets an explicit language win over the system one', () => {
    expect(resolveLocale('en', 'zh-CN')).toBe('en');
    expect(resolveLocale('system', 'zh-CN')).toBe('zh');
    expect(resolveLocale(null, 'de')).toBe('en');
  });

  it('fills placeholders and leaves unknown ones in place', () => {
    expect(translate('en', 'sidebar.newSessionIn', { name: 'app' })).toBe('New session in app');
    expect(translate('zh', 'sidebar.newSessionIn', { name: 'app' })).toBe('在 app 中新建会话');
    expect(translate('en', 'sidebar.newSessionIn')).toBe('New session in {name}');
  });

  it('has every message in every language with the same placeholders', () => {
    const holders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const [key, entry] of Object.entries(MESSAGES)) {
      for (const locale of LOCALES) {
        expect(entry[locale]?.trim(), `${key} (${locale})`).toBeTruthy();
        expect(holders(entry[locale]), `${key} (${locale}) placeholders`).toBe(holders(entry.en));
      }
    }
  });
});
