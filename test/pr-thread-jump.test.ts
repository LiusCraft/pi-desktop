import { describe, expect, it } from 'vitest';
import type { PrThread } from '../src/shared/protocol';
import { firstThread, placeThreads } from '../src/renderer/src/lib/diff';

const thread = (id: string, path: string, line: number | null, side: 'old' | 'new' = 'new'): PrThread => ({
  id,
  path,
  line,
  side,
  outdated: false,
  resolved: false,
  comments: [],
});

describe('firstThread (the comment chip lands here)', () => {
  const files = [{ path: 'a.ts' }, { path: 'b.ts' }];
  it('follows the panel order of files, then line', () => {
    expect(firstThread(files, [thread('1', 'b.ts', 1), thread('2', 'a.ts', 9), thread('3', 'a.ts', 4)])?.id).toBe('3');
  });
  it('ignores threads on files outside the diff', () => {
    expect(firstThread(files, [thread('1', 'z.ts', 1), thread('2', 'b.ts', 5)])?.id).toBe('2');
    expect(firstThread(files, [thread('1', 'z.ts', 1)])).toBeUndefined();
  });
});

describe('placeThreads', () => {
  const rows = [
    { t: ' ', o: 1, n: 1 },
    { t: '-', o: 2 },
    { t: '+', n: 2 },
  ];
  it('matches new-side threads to context and added rows, old-side to removed rows', () => {
    const { placed, lost } = placeThreads(rows, [thread('n', 'f', 2), thread('o', 'f', 2, 'old'), thread('c', 'f', 1)]);
    expect(placed.get(2)?.map((t) => t.id)).toEqual(['n']);
    expect(placed.get(1)?.map((t) => t.id)).toEqual(['o']);
    expect(placed.get(0)?.map((t) => t.id)).toEqual(['c']);
    expect(lost).toEqual([]);
  });
  it('reports threads whose line is gone', () => {
    expect(placeThreads(rows, [thread('x', 'f', 99), thread('y', 'f', null)]).lost.map((t) => t.id)).toEqual([
      'x',
      'y',
    ]);
  });
});
