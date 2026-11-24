// @vitest-environment jsdom
import { invoke } from './renderer-dom';
import { expect, it, vi } from 'vitest';
import { DEFAULT_PR_BAR } from '../src/shared/pr-bar-settings';
import type { SessionMeta } from '../src/shared/protocol';

const { watchCodeSession } = await import('../src/renderer/src/store/refresh');
const { getApp, setApp } = await import('../src/renderer/src/store/app');
const { emptySession } = await import('../src/renderer/src/store/transcript');

it('refreshes local diffs while PR tracking is off and leaves periodic PR status reads to the agent', () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  invoke.mockImplementation(async (channel) => (channel === 'sessions:changes' ? { files: [], state: null } : null));
  const initial = getApp();
  const id = 'pr-refresh';
  const session = emptySession({ id, kind: 'code' } as SessionMeta);
  session.panels.diff = true;
  const stop = watchCodeSession();
  try {
    setApp((s) => {
      s.settings = { prBar: { ...DEFAULT_PR_BAR, enabled: false } };
      s.sessions[id] = session;
      s.current = id;
    });
    expect(invoke).toHaveBeenCalledWith('sessions:changes', id);
    expect(invoke).not.toHaveBeenCalledWith('sessions:pr', id);
    invoke.mockClear();

    setApp((s) => void (s.settings.prBar = DEFAULT_PR_BAR));
    expect(invoke).toHaveBeenCalledWith('sessions:pr', id);
    invoke.mockClear();
    vi.advanceTimersByTime(60_000);
    expect(invoke).toHaveBeenCalledWith('sessions:changes', id);
    expect(invoke).not.toHaveBeenCalledWith('sessions:pr', id);
  } finally {
    stop();
    setApp((s) => {
      s.current = initial.current;
      s.sessions = initial.sessions;
      s.settings = initial.settings;
    });
    vi.useRealTimers();
  }
});
