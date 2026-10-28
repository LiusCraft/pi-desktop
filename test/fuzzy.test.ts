import { describe, expect, it } from 'vitest';
import { fuzzyEntry, fuzzyRank, fuzzyScore } from '../src/renderer/src/lib/fuzzy';

const score = (query: string, text: string) => fuzzyScore(query, text.toLowerCase());

describe('fuzzyScore', () => {
  it('ranks a prefix above a word start, and a word start above a plain substring', () => {
    const prefix = score('log', 'login.ts');
    const word = score('log', 'src/Login.tsx');
    const inner = score('log', 'catalog.ts');
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(inner);
    expect(inner).toBeGreaterThan(0);
  });

  it('matches scattered letters in order and rejects anything out of order', () => {
    expect(score('sxs', 'src/x/Summary.tsx')).toBeGreaterThan(0);
    expect(score('xss', 'summary.tsx')).toBe(0);
    expect(score('zzz', 'login.ts')).toBe(0);
  });

  it('prefers shorter paths when the match is identical', () => {
    expect(score('a.ts', 'a.ts')).toBeGreaterThan(score('a.ts', 'deep/nested/dir/a.ts'));
  });

  it('is case-insensitive for path and title searches', () => {
    expect(score('login', 'Fix-Login-Bug')).toBeGreaterThan(0);
  });
});

describe('fuzzyRank', () => {
  const entries = ['src/components/Login.tsx', 'src/store/logout.ts', 'docs/login.md', 'src/app.ts'].map((p) => fuzzyEntry(p, p));

  it('keeps the best matches and drops the rest', () => {
    const ranked = fuzzyRank(entries, 'logout', 3);
    expect(ranked.map((m) => m.item)).toEqual(['src/store/logout.ts']);
  });

  it('returns the caller order for an empty query and respects the limit', () => {
    expect(fuzzyRank(entries, '', 2).map((m) => m.item)).toEqual(['src/components/Login.tsx', 'src/store/logout.ts']);
    expect(fuzzyRank(entries, 'src', 1)).toHaveLength(1);
  });

  it('stays usable with thousands of entries', () => {
    const many = Array.from({ length: 5000 }, (_, i) => fuzzyEntry(`src/module-${i}/file-${i}.tsx`, `src/module-${i}/file-${i}.tsx`));
    const started = performance.now();
    const ranked = fuzzyRank(many, 'module-4999', 20);
    expect(performance.now() - started).toBeLessThan(200);
    expect(ranked.length).toBeGreaterThan(0);
  });
});
