// The host-side PR watcher: what counts as news, and what must not raise a second turn.
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { BACKOFF_MS, FAST_MS, PrWatcher, SLOW_MS } from '../src/agent/pr-watch';
import type { PrNote } from '../src/shared/pr-event';
import type { PrStatus } from '../src/shared/protocol';
import type { PrSnapshot } from '../src/agent/git';
import { setActiveLocale } from '../src/shared/i18n/runtime';

// These assertions read the host's Chinese messages.
setActiveLocale('zh');

const status = (p: Partial<PrStatus> = {}): PrStatus => ({
  num: 4, url: 'https://github.com/owner/repo/pull/4', state: 'open', draft: false,
  ci: 'pass', checks: [], comments: 0, mergeable: 'unknown', review: 'approved', head: 'abc',
  ...p,
});

const note = (id: string, author = 'alice', body = 'please fix'): PrNote => ({ id, author, body });

const snap = (p: Partial<PrStatus> = {}, notes: PrNote[] = []): PrSnapshot => ({ status: status(p), notes });

const failing = { ci: 'fail' as const, checks: [{ n: 'build (ubuntu)', st: 'fail' as const, url: 'https://example.com/log' }] };
const auto = { autoFixCi: true };
const withMerge = { autoFixCi: true, autoMerge: true };

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

  it('carries open comments into the fix turn instead of raising a second one', () => {
    const w = new PrWatcher();
    w.observe(snap({}, [note('c1')]), auto);
    const r = w.observe(snap(failing, [note('c1'), note('c2', 'bob')]), auto);
    assert.equal(r.pending?.event.kind, 'ci-fail');
    assert.match(r.pending!.event.summary, /条新评论/);
    assert.deepEqual(r.pending?.event.notes?.map((n) => n.id), ['c2']);
    w.accept(r.pending!);
    assert.equal(w.observe(snap(failing, [note('c1'), note('c2', 'bob')]), { ...auto, done: { fix: '4:abc' } }).pending, null);
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

describe('PR watcher, comments', () => {
  it('treats what is already on the PR as history and new comments as news', () => {
    const w = new PrWatcher();
    assert.equal(w.observe(snap({}, [note('c1')]), auto).pending, null);
    const r = w.observe(snap({}, [note('c1'), note('c2', 'bob', 'this loop is wrong')]), auto);
    assert.equal(r.pending?.event.kind, 'notes');
    assert.equal(r.pending?.event.summary, '1 条新评论 · @bob');
    assert.deepEqual(r.pending?.event.notes?.map((n) => n.id), ['c2']);
    // Accepted: the same comment never raises another turn.
    w.accept(r.pending!);
    assert.equal(w.observe(snap({}, [note('c1'), note('c2', 'bob')]), auto).pending, null);
  });

  it('ignores its own replies and bots, so a fix turn cannot trigger itself', () => {
    const w = new PrWatcher();
    w.observe(snap(), auto);
    const r = w.observe(snap({}, [{ ...note('c9'), self: true }, note('c10', 'dependabot[bot]'), note('c11', 'ci[bot]')]), auto);
    assert.equal(r.pending, null);
  });

  it('does not act on comments while auto-fix is off', () => {
    const w = new PrWatcher();
    w.observe(snap(), {});
    assert.equal(w.observe(snap({}, [note('c2')]), {}).pending, null);
  });
});

describe('PR watcher, merging and the loop', () => {
  it('asks for a merge once when the PR becomes ready', () => {
    const w = new PrWatcher();
    w.observe(snap({ ci: 'pending' }), withMerge);
    assert.equal(w.observe(snap({ ci: 'pending' }), withMerge).pending, null);
    const ready = w.observe(snap({ ci: 'pass', mergeable: 'clean' }), withMerge);
    assert.equal(ready.pending?.event.kind, 'merge');
    assert.deepEqual(ready.pending?.mark, { merge: 4 });
    // Recorded on the session: no second request for the same PR.
    assert.equal(w.observe(snap({ ci: 'pass', mergeable: 'clean' }), { ...withMerge, done: { merge: 4 } }).pending, null);
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
