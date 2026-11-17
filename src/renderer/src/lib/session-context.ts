import type { ContextBreakdown } from '@shared/protocol';
import { subscribeResource } from '@/store/resources';
import { call } from './api';

/** Read the open context view on mount and reload; discard stale or unmounted responses. */
export function watchSessionContext(sid: string, update: (data: ContextBreakdown | null) => void): () => void {
  let live = true;
  let latest = 0;
  const load = () => {
    const request = ++latest;
    void call('sessions:context', sid).then(
      (data) => {
        if (live && request === latest) update(data);
      },
      () => {
        if (live && request === latest) update(null);
      },
    );
  };
  const off = subscribeResource('sessionResources', load);
  load();
  return () => {
    live = false;
    off();
  };
}
