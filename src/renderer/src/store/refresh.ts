import { call } from '@/lib/api';
import { currentSession, useApp } from './app';
import { loadChanges, loadPrThreads } from './actions';

/** Looks triggered by focus or polling skip a session refreshed this recently. */
const MIN_GAP_MS = 10_000;
/** While the diff is on screen, comments and PR state are re-read this often. */
const DIFF_POLL_MS = 60_000;

const lastLook = new Map<string, number>();

/** Re-read the code session's diff, PR and review comments in the background; stale data stays on screen meanwhile. */
function refresh(force = false) {
  if (document.visibilityState !== 'visible') return;
  const s = currentSession();
  if (!s || s.meta.kind !== 'code') return;
  const id = s.meta.id;
  const now = Date.now();
  if (!force && now - (lastLook.get(id) ?? 0) < MIN_GAP_MS) return;
  lastLook.set(id, now);
  void loadChanges(id);
  if (s.pr) {
    // The PR status call publishes a `pr` event that updates the bar; threads are read alongside it.
    call('sessions:pr', id).catch(() => {});
    void loadPrThreads(id);
  }
}

/** Refresh on the moments the data is likely stale: coming back to the window, switching session, opening the diff, and a slow poll while the diff is open. */
export function watchCodeSession(): () => void {
  const onVisible = () => refresh();
  window.addEventListener('focus', onVisible);
  document.addEventListener('visibilitychange', onVisible);

  let shown = '';
  const off = useApp.subscribe((st) => {
    const s = st.current ? st.sessions[st.current] : undefined;
    const key = s ? `${s.meta.id}:${s.panels.diff}` : '';
    if (key === shown) return;
    shown = key;
    if (key) refresh(true);
  });
  const poll = setInterval(() => {
    if (currentSession()?.panels.diff) refresh();
  }, DIFF_POLL_MS);

  return () => {
    window.removeEventListener('focus', onVisible);
    document.removeEventListener('visibilitychange', onVisible);
    off();
    clearInterval(poll);
  };
}
