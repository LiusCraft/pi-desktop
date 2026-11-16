// What the PR bar reads out of a GitHub pull request: badge, size, CI line, and when automation may act.
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { fmtLines, prBadge, prCiLine, prFixKey, prReady, prRepo, prSize } from '../src/shared/pr-status';

const pr = (p: Record<string, unknown> = {}) =>
  ({ num: 4, state: 'open', draft: false, ci: 'pass', mergeable: 'clean', ...p }) as never;

describe('PR bar badge', () => {
  it('calls out a merge conflict before anything else', () => {
    assert.deepEqual(prBadge(pr({ mergeable: 'conflicting', ci: 'fail' })), {
      label: 'Merge conflicts',
      tone: 'conflict',
    });
  });

  it('reports CI before the plain open state', () => {
    assert.deepEqual(prBadge(pr({ ci: 'fail' })), { label: 'Checks failing', tone: 'fail' });
    assert.deepEqual(prBadge(pr({ ci: 'pending' })), { label: 'Checks running', tone: 'running' });
    assert.deepEqual(prBadge(pr({ ci: 'pass' })), { label: 'Ready to merge', tone: 'ready' });
    assert.deepEqual(prBadge(pr({ ci: 'none' })), { label: 'Open', tone: 'open' });
  });

  it('lets draft, merged and closed speak for themselves', () => {
    assert.equal(prBadge(pr({ draft: true })).label, 'Draft');
    assert.equal(prBadge(pr({ state: 'merged', ci: 'pass' })).tone, 'merged');
    assert.equal(prBadge(pr({ state: 'closed' })).tone, 'closed');
  });

  it('reports a change request as the remaining blocker', () => {
    assert.deepEqual(prBadge(pr({ review: 'changes' })), { label: 'Changes requested', tone: 'review' });
    assert.equal(prBadge(pr({ review: 'approved' })).label, 'Ready to merge');
  });
});

describe('PR size', () => {
  it('reports lines and files GitHub counted', () => {
    assert.deepEqual(prSize({ additions: 2504, deletions: 132, files: 21 }), { add: 2504, del: 132, files: 21 });
  });

  it('treats a missing field as zero but reports nothing when both counts are absent', () => {
    assert.deepEqual(prSize({ additions: 7 }), { add: 7, del: 0, files: null });
    assert.equal(prSize({}), null);
  });

  it('keeps large counts readable', () => {
    assert.equal(fmtLines(2504), '2,504');
  });
});

describe('PR repository label', () => {
  it('takes owner and repo from the GitHub URL', () => {
    assert.equal(prRepo('https://github.com/LiusCraft/pi-desktop/pull/4', 'local'), 'LiusCraft/pi-desktop');
  });

  it('falls back to the folder name for anything else (enterprise, a bad URL)', () => {
    assert.equal(prRepo('https://ghe.example.com/team/app/pull/9', 'local'), 'local');
    assert.equal(prRepo('', 'local'), 'local');
  });
});

describe('CI line', () => {
  it('says when there is nothing to report', () => {
    assert.equal(prCiLine({ ci: 'none', checks: [] }), 'No checks reported yet.');
  });

  it('counts the failing checks rather than all of them', () => {
    const checks = [
      { n: 'a', st: 'fail' as const },
      { n: 'b', st: 'pass' as const },
      { n: 'c', st: 'pass' as const },
    ];
    assert.equal(prCiLine({ ci: 'fail', checks }), '1 of 3 checks failing');
  });

  it('describes running and passing runs', () => {
    assert.equal(
      prCiLine({
        ci: 'pending',
        checks: [
          { n: 'a', st: 'pending' },
          { n: 'b', st: 'pass' },
        ],
      }),
      '1 check running…',
    );
    assert.equal(prCiLine({ ci: 'pass', checks: [{ n: 'a', st: 'pass' }] }), 'All 1 check passed');
  });
});

describe('CI automation gates', () => {
  it('merges only a clean, green, still-open PR', () => {
    assert.equal(prReady(pr()), true);
    assert.equal(prReady(pr({ ci: 'fail' })), false);
    assert.equal(prReady(pr({ ci: 'pending' })), false);
    assert.equal(prReady(pr({ mergeable: 'conflicting' })), false);
    assert.equal(prReady(pr({ mergeable: 'unknown' })), false);
    assert.equal(prReady(pr({ draft: true })), false);
    assert.equal(prReady(pr({ state: 'merged' })), false);
    assert.equal(prReady(pr({ review: 'changes' })), false);
  });

  it('keys a fix to the failing commit, so the same run is fixed once', () => {
    assert.equal(prFixKey(pr({ ci: 'fail', head: 'abc' })), '4:abc');
    assert.equal(prFixKey(pr({ ci: 'pass', head: 'abc' })), null);
    assert.equal(prFixKey(pr({ ci: 'fail' })), null);
  });
});
