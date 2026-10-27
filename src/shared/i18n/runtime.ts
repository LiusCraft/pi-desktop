import { translate, type MessageKey, type MessageParams } from './index';
import { DEFAULT_LOCALE, type Locale } from './locales';

// Code shared by several processes (schedule text, validation errors) has no component to ask, so each
// process keeps the language it runs in here: the renderer follows the settings, the agent host is told by main.
let active: Locale = DEFAULT_LOCALE;

export const setActiveLocale = (locale: Locale) => {
  active = locale;
};
export const activeLocale = () => active;
export const tr = (key: MessageKey, params?: MessageParams) => translate(active, key, params);
