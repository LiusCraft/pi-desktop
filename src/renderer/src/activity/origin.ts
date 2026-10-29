// What a request was for, as the usage view and the request list name it.
import { ORIGIN_OTHER, REQUEST_ORIGIN, SUBAGENT_KEY_PREFIX, type RequestRecord } from '@shared/request-log';
import type { MessageKey } from '@shared/i18n';
import { t } from '@/lib/i18n';

const ORIGIN_LABEL: Record<string, MessageKey> = {
  [REQUEST_ORIGIN.code]: 'privacy.origin.code',
  [REQUEST_ORIGIN.work]: 'privacy.origin.work',
  [REQUEST_ORIGIN.naming]: 'privacy.origin.naming',
  [REQUEST_ORIGIN.suggest]: 'privacy.origin.suggest',
  [REQUEST_ORIGIN.sideChat]: 'privacy.origin.sideChat',
  [REQUEST_ORIGIN.review]: 'privacy.origin.review',
  [REQUEST_ORIGIN.ideas]: 'privacy.origin.ideas',
  [ORIGIN_OTHER]: 'privacy.origin.other',
};

/** The usage view's series key for a request's origin: a subagent is `subagent:<name>`. */
export const originKey = (r: Pick<RequestRecord, 'origin' | 'subagent'>): string =>
  r.origin === REQUEST_ORIGIN.subagent && r.subagent ? SUBAGENT_KEY_PREFIX + r.subagent : (r.origin ?? ORIGIN_OTHER);

/** What a request was for, from its key. A subagent is its own name. */
export function purposeLabel(key: string): string {
  if (key.startsWith(SUBAGENT_KEY_PREFIX))
    return t('privacy.origin.subagent', { name: key.slice(SUBAGENT_KEY_PREFIX.length) });
  const label = ORIGIN_LABEL[key];
  return label ? t(label) : key;
}
