// Which git action the branch bar offers by default, and which ones it can run.
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { gitActions, type BranchWork } from '../src/renderer/src/components/composer/pr-actions';
import { setActiveLocale } from '../src/shared/i18n/runtime';

const state = (p: Partial<{ dirty: string[]; ahead: number; behind: number; baseBehind: number; base: string | null; upstream: string | null }> = {}) =>
  ({ dirty: [], ahead: 0, behind: 0, baseBehind: 0, base: 'main', upstream: 'origin/feature', ...p });
const work = (p: Partial<BranchWork> = {}): BranchWork => ({
  branch: 'feature', baseBranch: 'main', st: state(), pr: null, strategy: 'merge', ...p,
});
const action = (w: BranchWork, act: 'pr' | 'commit' | 'push' | 'sync') => gitActions(w).actions.find((a) => a.act === act)!;

describe('branch bar actions', () => {
  it('offers to merge a base branch that moved on, or rebase when chosen, without making it the default', () => {
    const w = work({ st: state({ baseBehind: 3 }) });
    assert.equal(action(w, 'sync').enabled, true);
    assert.match(action(w, 'sync').prompt, /git merge main/);
    assert.match(action(work({ st: state({ baseBehind: 3 }), strategy: 'rebase' }), 'sync').prompt, /git rebase main/);
    assert.notEqual(gitActions(w).primary, 'sync');
    assert.equal(action(work(), 'sync').enabled, false);
  });

  it('has no sync action on the base branch itself', () => {
    assert.equal(gitActions(work({ branch: 'main' })).actions.some((a) => a.act === 'sync'), false);
  });

  it('submits the PR by default on a branch of its own', () => {
    const { primary } = gitActions(work({ st: state({ dirty: ['src/a.ts'] }) }));
    assert.equal(primary, 'pr');
    assert.equal(action(work(), 'pr').label, 'Create PR');
  });

  it('offers create-PR even when the branch is clean, so already-pushed work can be proposed', () => {
    assert.equal(action(work(), 'pr').enabled, true);
    assert.equal(action(work(), 'commit').enabled, false);
    assert.equal(action(work(), 'push').enabled, false);
  });

  it('defaults to a direct git step on the base branch instead of branching off it', () => {
    const dirtyOnMain = work({ branch: 'main', st: state({ dirty: ['a.ts'] }) });
    assert.equal(gitActions(dirtyOnMain).primary, 'commit');
    const pushedMain = work({ branch: 'main', st: state({ ahead: 2, upstream: 'origin/main' }) });
    assert.equal(gitActions(pushedMain).primary, 'push');
    assert.equal(action(pushedMain, 'pr').label, 'Create PR');
    assert.equal(action(pushedMain, 'pr').enabled, true);
  });

  it('updates the open PR when new commits are waiting', () => {
    const w = work({ st: state({ ahead: 2 }), pr: { num: 12, state: 'open' } });
    assert.equal(gitActions(w).primary, 'pr');
    assert.equal(action(w, 'pr').label, 'Update PR');
    assert.match(action(w, 'pr').prompt, /#12/);
    assert.equal(action(w, 'push').enabled, true);
  });

  it('reports status only when the open PR is already up to date', () => {
    const w = work({ pr: { num: 12, state: 'open' } });
    assert.equal(gitActions(w).primary, null);
    assert.equal(action(w, 'pr').enabled, false);
    assert.equal(action(w, 'commit').enabled, false);
    assert.equal(action(w, 'push').enabled, false);
  });

  it('opens a new PR once the old one is merged or closed', () => {
    const w = work({ st: state({ dirty: ['a.ts'] }), pr: { num: 7, state: 'merged' } });
    assert.equal(gitActions(w).primary, 'pr');
    assert.equal(action(w, 'pr').label, 'New PR');
    assert.match(action(w, 'pr').prompt, /#7/);
  });

  it('has nothing to offer when the branch is clean and pushed on the base branch', () => {
    assert.equal(gitActions(work({ branch: 'main' })).primary, null);
  });

  it('keeps the direct steps available even when the default is the PR', () => {
    const w = work({ st: state({ dirty: ['a.ts', 'b.ts'], ahead: 1, upstream: null }) });
    assert.equal(gitActions(w).primary, 'pr');
    assert.equal(action(w, 'commit').enabled, true);
    assert.match(action(w, 'commit').hint, /2/);
    assert.equal(action(w, 'push').enabled, true);
    assert.doesNotMatch(action(w, 'push').prompt, /gh pr create/);
    assert.match(action(w, 'pr').prompt, /gh pr create/);
  });

  it('does not ask for a commit when only committed work is waiting', () => {
    const clean = work({ st: state({ ahead: 1 }), pr: { num: 3, state: 'open' } });
    assert.doesNotMatch(action(clean, 'pr').prompt, /Commit all current changes/);
    const bumped = work({ st: state({ ahead: 1, dirty: ['a.ts'] }), pr: { num: 3, state: 'open' } });
    assert.match(action(bumped, 'pr').prompt, /Commit all current changes/);
  });

  it('moves the base branch’s commits onto a new branch instead of committing to it', () => {
    const w = work({ branch: 'main', st: state({ ahead: 2, upstream: 'origin/main' }) });
    assert.match(action(w, 'pr').prompt, /create a feature branch/);
    assert.doesNotMatch(action(w, 'pr').prompt, /do not commit to it directly/); // no local edits to carry over
  });
});

describe('branch bar prompts follow the UI language', () => {
  it('asks in Chinese when the app runs in Chinese', () => {
    setActiveLocale('zh');
    try {
      const w = work({ branch: 'main', st: state({ dirty: ['a.ts'] }) });
      assert.match(action(w, 'pr').prompt, /不要直接往它提交/);
      assert.equal(action(work(), 'pr').label, '创建 PR');
    } finally {
      setActiveLocale('en');
    }
  });
});
