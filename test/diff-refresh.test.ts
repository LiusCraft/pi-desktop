import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionMeta } from '../src/shared/protocol';

let fail = false;
const listing = {
  repo: true,
  files: [],
  state: { dirty: [], ahead: 0, behind: 0, baseBehind: 0, base: null, upstream: null },
};
Object.assign(globalThis, {
  window: {
    piDesktop: {
      platform: 'linux',
      boot: { settings: {}, info: {} },
      invoke: () => (fail ? Promise.reject(new Error('offline')) : Promise.resolve(listing)),
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  },
});

const { loadChanges } = await import('../src/renderer/src/store/actions');
const { emptySession } = await import('../src/renderer/src/store/transcript');
const { getApp, setApp } = await import('../src/renderer/src/store/app');
const meta = { id: 'diff', kind: 'code', cwd: '/p', projectPath: '/p', baseBranch: 'main' } as SessionMeta;

beforeEach(() => {
  fail = false;
  setApp((state) => {
    state.sessions = { [meta.id]: emptySession(meta) };
    state.sessions[meta.id].diffBranch = 'another-base';
    state.sessions[meta.id].diffScope = 'lastCommit';
  });
});

describe('Diff refresh invalidation', () => {
  it('refreshes alternative comparisons even when the default session diff is unchanged', async () => {
    const files = getApp().sessions[meta.id].changes;
    await loadChanges(meta.id);
    await loadChanges(meta.id);
    const session = getApp().sessions[meta.id];
    expect(session.changes).toBe(files);
    expect(session.changesVersion).toBe(2);
    expect(session.diffScope).toBe('lastCommit');
    expect(session.diffBranch).toBe('another-base');
    expect(session.meta.baseBranch).toBe('main');
  });

  it('does not publish a successful refresh when the host read fails', async () => {
    fail = true;
    await loadChanges(meta.id);
    expect(getApp().sessions[meta.id].changesVersion).toBe(0);
  });
});
