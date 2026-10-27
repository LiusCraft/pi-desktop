import { describe, expect, it } from 'vitest';
import { groupThreads } from '../src/agent/git';

const row = (id: number, extra: Record<string, unknown> = {}) => ({ id, path: 'a.ts', line: 3, side: 'RIGHT', author: 'bob', body: `c${id}`, url: `u${id}`, at: '2026-01-01T00:00:00Z', ...extra });

describe('groupThreads', () => {
  it('folds replies into their root and orders by file then line', () => {
    const t = groupThreads([row(1, { path: 'b.ts', line: 1 }), row(2, { line: 9 }), row(3, { reply: 2, author: 'amy' }), row(4, { line: 2 })]);
    expect(t.map((x) => x.id)).toEqual(['4', '2', '1']);
    expect(t[1].comments.map((c) => c.author)).toEqual(['bob', 'amy']);
  });
  it('keeps outdated threads at their original line and maps LEFT to the old side', () => {
    const [t] = groupThreads([row(1, { line: null, original_line: 7, outdated: true, side: 'LEFT' })]);
    expect(t).toMatchObject({ line: 7, side: 'old', outdated: true });
  });
});
