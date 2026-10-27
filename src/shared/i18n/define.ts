import { LOCALES, type Locale } from './locales';

/** One message in every shipped language; the compiler rejects an entry that misses one. */
export type Entry = Record<Locale, string>;
export const defineMessages = <const T extends Record<string, Entry>>(messages: T): T => messages;
export { LOCALES };
