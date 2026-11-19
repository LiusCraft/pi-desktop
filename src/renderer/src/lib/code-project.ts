import { call } from './api';
import { fname } from './format';
import { t } from './i18n';

const pending = new Map<string, Promise<void>>();

/** Ask on the interactive client only. Cancelling leaves the Code operation intact. */
export function resolveCodeProject(code: string, pick: (title: string) => Promise<string | null>) {
  const active = pending.get(code);
  if (active) return active;
  const resolving = (async () => {
    if ((await call('work:resolveCode', code)) !== 'ask') return;
    const dir = await pick(t('projects.chooseDirectory', { name: fname(code) || code }));
    if (dir) await call('work:resolveCode', code, dir);
  })().finally(() => pending.delete(code));
  pending.set(code, resolving);
  return resolving;
}
