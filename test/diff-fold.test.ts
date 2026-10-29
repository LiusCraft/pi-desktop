// Which diffs are too big to render on open, and counting changed lines without re-diffing.
import { describe, expect, it } from 'vitest';
import { diffStats } from '../src/shared/tool-previews';
import { changeStats, FOLD_BYTES, FOLD_LINES, isLargeDiff } from '../src/renderer/src/lib/diff';

const change = (over: Partial<Parameters<typeof isLargeDiff>[0]> = {}) => ({
  add: 3,
  del: 1,
  before: 'a\nb',
  after: 'a\nc',
  ...over,
});

describe('isLargeDiff', () => {
  it('leaves an ordinary edit open', () => {
    expect(isLargeDiff(change())).toBe(false);
  });

  it('folds a diff with many changed lines', () => {
    expect(isLargeDiff(change({ add: FOLD_LINES, del: 0 }))).toBe(true);
    expect(isLargeDiff(change({ add: FOLD_LINES - 2, del: 1 }))).toBe(false);
  });

  it('folds a big file even when only one line changed', () => {
    const text = 'x'.repeat(FOLD_BYTES / 2);
    expect(isLargeDiff(change({ before: text, after: text }))).toBe(true);
  });

  it('copes with a file that has no old or new side', () => {
    expect(isLargeDiff({ add: 1, del: 0, before: null, after: 'a' })).toBe(false);
  });
});

describe('changeStats', () => {
  it('counts the same lines as a full diff', () => {
    const before = 'one\ntwo\nthree\nfour\nfive\n';
    const after = 'one\nTWO\nthree\nfour\nFIVE\nsix\n';
    expect(changeStats('a.ts', before, after)).toEqual(diffStats(before, after));
  });

  it('answers from the cache for unchanged content', () => {
    const before = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    const after = `${before}\nextra`;
    const first = changeStats('b.ts', before, after);
    expect(changeStats('b.ts', before, after)).toBe(first);
  });

  it('notices when the content changes again', () => {
    const before = 'a\nb';
    expect(changeStats('c.ts', before, 'a\nb\nc')).toEqual({ add: 1, del: 0 });
    expect(changeStats('c.ts', before, 'a\nb\nc\nd')).toEqual({ add: 2, del: 0 });
  });

  it('treats a deleted file as removals', () => {
    expect(changeStats('d.ts', 'a\nb\nc', null)).toEqual({ add: 0, del: 3 });
  });
});
