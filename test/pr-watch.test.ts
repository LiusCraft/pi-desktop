// The host-side PR watcher: what counts as news, and what must not raise a second turn.
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { BACKOFF_MS, FAST_MS, PrWatcher, SLOW_MS } from '../src/agent/pr-watch';
import type { PrNote } from '../src/shared/pr-event';
import type { PrStatus } from '../src/shared/protocol';
import type { PrSnapshot } from '../src/agent/git';
import { setActiveLocale } from '../src/shared/i18n/runtime';
import { normalizePrBar } from '../src/shared/pr-bar-settings';

// These assertions read the host's Chinese messages.
setActiveLocale('zh');

const status = (p: Partial<PrStatus> = {}): PrStatus => ({
  num: 4,
  url: 'https://github.com/owner/repo/pull/4',
  state: 'open',
  draft: false,
  ci: 'pass',
  checks: [],
  comments: 0,
  mergeable: 'unknown',
  review: 'approved',
  head: 'abc',
  ...p,
});

const note = (id: string, author = 'alice', body = 'please fix'): PrNote => ({ id, author, body });

const snap = (p: Partial<PrStatus> = {}, notes: PrNote[] = []): PrSnapshot => ({ status: status(p), notes });

const failing = {
  ci: 'fail' as const,
  checks: [{ n: 'build (ubuntu)', st: 'fail' as const, url: 'https://example.com/log' }],
};
const auto = { autoFixCi: true };
const withMerge = { autoFixCi: true, autoMerge: true };

describe('PR Bar settings', () => {
  it('enforces CI, conflict, review comment and merge permissions independently', () => {
    const watcher = new PrWatcher();
    const observe = (settings: Parameters<typeof normalizePrBar>[0], state: Partial<PrStatus>, notes: PrNote[] = []) =>
      watcher.observe(snap(state, notes), { ...withMerge, settings: normalizePrBar(settings) });
    observe({ autoMerge: false }, {});
    const failure = { ...failing, mergeable: 'conflicting' as const };
    const ciOnly = observe({ resolveConflicts: false, addressComments: false }, failure, [note('new')]);
    assert.deepEqual(ciOnly.pending?.mark, { fix: '4:abc' });
    assert.equal(ciOnly.pending?.event.notes, undefined);
    assert.match(ciOnly.pending!.event.instruction, /不处理评审意见/);
    assert.deepEqual(observe({ fixCi: false }, failure).pending?.mark, { conflict: '4:abc' });
    assert.equal(
      observe({ fixCi: false, resolveConflicts: false }, failure, [note('new')]).pending?.event.kind,
      'notes',
    );
    assert.equal(observe({ autoMerge: false }, { mergeable: 'clean' }).pending, null);
    assert.equal(observe({ enabled: false }, failure).pending, null);
  });

  it('bounds refresh intervals and uses them during checks and failures', () => {
    const settings = normalizePrBar({ fastSeconds: 40, slowSeconds: 1, idleSeconds: 9999, backoffSeconds: 120 });
    assert.equal(settings.slowSeconds, 40);
    assert.equal(settings.idleSeconds, 3600);
    const watcher = new PrWatcher();
    assert.equal(watcher.observe(snap({ ci: 'pending' }), { settings }).after, 40_000);
    assert.equal(watcher.observe(null, { settings }).after, 40_000);
    watcher.observe(null, { settings });
    assert.equal(watcher.observe(null, { settings }).after, 120_000);
  });
});

describe('PR watcher, CI', () => {
  it('raises a failing run once per commit', () => {
    const w = new PrWatcher();
    w.observe(snap(), auto);
    const first = w.observe(snap(failing), auto);
    assert.equal(first.pending?.event.kind, 'ci-fail');
    assert.deepEqual(first.pending?.mark, { fix: '4:abc' });
    assert.equal(first.pending?.event.failed?.[0].name, 'build (ubuntu)');
    assert.equal(first.after, FAST_MS);
    // The host records the key on the session; the same commit is then old news.
    w.accept(first.pending!);
    assert.equal(w.observe(snap(failing), { ...auto, done: { fix: '4:abc' } }).pending, null);
    // A new head means the old fix did not stick: fix it again.
    assert.equal(w.observe(snap({ ...failing, head: 'def' }), auto).pending?.mark?.fix, '4:def');
  });

  it('reports a failed run even when no individual check is named', () => {
    const { pending } = new PrWatcher().observe(snap({ ci: 'fail', checks: [] }), auto);
    assert.equal(pending?.event.kind, 'ci-fail');
    assert.equal(pending.event.summary, 'CI 失败');
    assert.equal(pending.event.failed, undefined);
  });

  it('carries open comments into the fix turn instead of raising a second one', () => {
    const w = new PrWatcher();
    w.observe(snap({}, [note('c1')]), auto);
    const r = w.observe(snap(failing, [note('c1'), note('c2', 'bob')]), auto);
    assert.equal(r.pending?.event.kind, 'ci-fail');
    assert.match(r.pending!.event.summary, /条新评论/);
    assert.deepEqual(
      r.pending?.event.notes?.map((n) => n.id),
      ['c2'],
    );
    w.accept(r.pending!);
    assert.equal(
      w.observe(snap(failing, [note('c1'), note('c2', 'bob')]), { ...auto, done: { fix: '4:abc' } }).pending,
      null,
    );
  });

  it('stays quiet when auto-fix is off, but still reports the status', () => {
    const w = new PrWatcher();
    w.observe(snap(), {});
    const r = w.observe(snap(failing), {});
    assert.equal(r.pending, null);
    assert.equal(r.status?.ci, 'fail');
  });

  it('does not repeat a failure the session already handled before a restart', () => {
    const w = new PrWatcher();
    w.observe(snap(), auto);
    const r = w.observe(snap(failing), { ...auto, done: { fix: '4:abc' } });
    assert.equal(r.pending, null);
  });
});

describe('PR watcher, conflicts', () => {
  const conflicting = { mergeable: 'conflicting' as const, base: 'release' };

  it('requests a repair even without CI, once per known PR head across restarts', () => {
    const w = new PrWatcher();
    const r = w.observe(snap({ ...conflicting, ci: 'none' }), auto).pending;
    assert.equal(r?.event.kind, 'conflict');
    assert.match(r.event.instruction, /release/);
    assert.deepEqual(r.mark, { conflict: '4:abc' });
    const restored = { ...auto, done: r.mark };
    const next = new PrWatcher();
    assert.equal(next.observe(snap(conflicting), restored).pending, null);
    assert.equal(next.observe(snap({ ...conflicting, head: 'def' }), restored).pending?.mark?.conflict, '4:def');
  });

  it('refers to the target branch without guessing its name when the forge omits it', () => {
    const { pending } = new PrWatcher().observe(snap({ mergeable: 'conflicting' }), auto);
    assert.equal(pending?.event.kind, 'conflict');
    assert.equal(pending.event.summary, '与 目标分支 存在合并冲突');
    assert.match(pending.event.instruction, /拉取 目标分支 的最新提交/);
  });

  it('never treats auto-merge alone, unknown status or a finished PR as a request to fix conflicts', () => {
    const w = new PrWatcher();
    assert.equal(w.observe(snap(conflicting), { autoMerge: true }).pending, null);
    for (const p of [
      { state: 'merged' },
      { state: 'closed' },
      { head: undefined },
      { mergeable: 'unknown' as const },
    ]) {
      assert.equal(w.observe(snap({ ...conflicting, ...p }), withMerge).pending, null);
    }
  });

  it('handles simultaneous failures and fresh comments in the conflict turn', () => {
    const w = new PrWatcher();
    w.observe(snap(), withMerge);
    const both = snap({ ...conflicting, ...failing }, [note('c1')]);
    const r = w.observe(both, withMerge).pending;
    assert.equal(r?.event.kind, 'conflict');
    assert.deepEqual(r.mark, { conflict: '4:abc', fix: '4:abc' });
    assert.deepEqual(r.event.failed, [{ name: 'build (ubuntu)', url: 'https://example.com/log' }]);
    assert.deepEqual(r.event.notes, both.notes);
    w.accept(r);
    assert.equal(w.observe(both, { ...withMerge, done: r.mark }).pending, null);
  });

  it('does not let an earlier repair suppress a different problem on the same head', () => {
    const both = snap({ ...conflicting, ...failing });
    const w = new PrWatcher();
    assert.equal(w.observe(both, { ...auto, done: { fix: '4:abc' } }).pending?.event.kind, 'conflict');
    assert.equal(w.observe(both, { ...auto, done: { conflict: '4:abc' } }).pending?.event.kind, 'ci-fail');
  });
});

describe('PR watcher, comments', () => {
  it('treats what is already on the PR as history and new comments as news', () => {
    const w = new PrWatcher();
    assert.equal(w.observe(snap({}, [note('c1')]), auto).pending, null);
    const r = w.observe(snap({}, [note('c1'), note('c2', 'bob', 'this loop is wrong')]), auto);
    assert.equal(r.pending?.event.kind, 'notes');
    assert.equal(r.pending?.event.summary, '1 条新评论 · @bob');
    assert.deepEqual(
      r.pending?.event.notes?.map((n) => n.id),
      ['c2'],
    );
    // Accepted: the same comment never raises another turn.
    w.accept(r.pending!);
    assert.equal(w.observe(snap({}, [note('c1'), note('c2', 'bob')]), auto).pending, null);
  });

  it('ignores its own replies and bots, so a fix turn cannot trigger itself', () => {
    const w = new PrWatcher();
    w.observe(snap(), auto);
    const r = w.observe(
      snap({}, [{ ...note('c9'), self: true }, note('c10', 'dependabot[bot]'), note('c11', 'ci[bot]')]),
      auto,
    );
    assert.equal(r.pending, null);
  });

  it('does not act on comments while auto-fix is off', () => {
    const w = new PrWatcher();
    w.observe(snap(), {});
    assert.equal(w.observe(snap({}, [note('c2')]), {}).pending, null);
  });
});

describe('PR watcher, merging and the loop', () => {
  it('asks for a merge once per head, only after that head passes CI', () => {
    const w = new PrWatcher();
    assert.equal(w.observe(snap({ ci: 'none', mergeable: 'clean' }), withMerge).pending, null);
    const queued = w.observe(snap({ ci: 'pending', mergeable: 'clean' }), withMerge);
    assert.equal(queued.pending, null);
    assert.equal(queued.after, FAST_MS);
    const green = snap({ ci: 'pass', mergeable: 'clean' });
    const first = w.observe(green, withMerge).pending;
    assert.equal(first?.event.kind, 'merge');
    assert.deepEqual(first.mark, { merge: '4:abc' });
    w.accept(first);
    const afterFirst = { ...withMerge, done: first.mark };
    assert.equal(w.observe(green, afterFirst).pending, null);

    // The merge turn pushed a new commit instead. Its pending checks must not consume its turn.
    const next = snap({ ...green.status, head: 'def' });
    assert.equal(w.observe(snap({ ...next.status, ci: 'pending' }), afterFirst).pending, null);
    const second = w.observe(next, afterFirst).pending;
    assert.equal(second?.event.kind, 'merge');
    assert.equal(second.event.head, 'def');
    assert.deepEqual(second.mark, { merge: '4:def' });
    w.accept(second);
    assert.equal(w.observe(next, { ...withMerge, done: second.mark }).pending, null);
  });

  it('does not merge without the merge switch or without a known head', () => {
    const w = new PrWatcher();
    assert.equal(w.observe(snap({ mergeable: 'clean' }), auto).pending, null);
    assert.equal(w.observe(snap({ mergeable: 'clean', head: undefined }), withMerge).pending, null);
  });

  it('does not merge over a change request', () => {
    const w = new PrWatcher();
    w.observe(snap({ mergeable: 'clean' }), { autoMerge: true });
    assert.equal(w.observe(snap({ mergeable: 'clean', review: 'changes' }), { autoMerge: true }).pending, null);
  });

  it('stops watching a merged PR and slows down when the checks are settled', () => {
    const w = new PrWatcher();
    assert.equal(w.observe(snap(), auto).after, SLOW_MS);
    assert.equal(w.observe(snap({ ci: 'pending' }), auto).after, FAST_MS);
    const merged = w.observe(snap({ state: 'merged' }), auto);
    assert.equal(merged.done, true);
    assert.equal(merged.pending, null);
  });

  it('backs off when gh fails, and keeps the last known status', () => {
    const w = new PrWatcher();
    const known = w.observe(snap(), {});
    assert.equal(known.status?.num, 4);
    assert.equal(w.observe(null, {}).after, SLOW_MS);
    assert.equal(w.observe(null, {}).after, SLOW_MS);
    const third = w.observe(null, {});
    assert.equal(third.after, BACKOFF_MS);
    assert.equal(third.status?.num, 4);
    // Recovery resets the backoff.
    assert.equal(w.observe(snap(), {}).after, SLOW_MS);
  });

  it('re-baselines after a reset', () => {
    const w = new PrWatcher();
    w.observe(snap({}, [note('c1')]), auto);
    w.reset();
    assert.equal(w.observe(snap({}, [note('c1'), note('c2')]), auto).pending, null);
  });
});
