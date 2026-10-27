import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { searchSessionFiles } from '../src/agent/files';
import { findInText, SEARCH_MAX_MATCHES, SEARCH_SNIPPET_CHARS } from '../src/shared/text-search';

describe('findInText', () => {
  const text = 'alpha\n  Beta line\nGAMMA\r\nbeta again beta';

  it('finds the first hit on every matching line, ignoring case by default', () => {
    expect(findInText(text, 'beta', false)).toEqual([
      { line: 2, text: 'Beta line', start: 0, end: 4 },
      { line: 4, text: 'beta again beta', start: 0, end: 4 },
    ]);
    expect(findInText(text, 'gamma', false).map((m) => m.line)).toEqual([3]);
  });

  it('can match case exactly and finds nothing for an empty query', () => {
    expect(findInText(text, 'beta', true).map((m) => m.line)).toEqual([4]);
    expect(findInText(text, '', false)).toEqual([]);
  });

  it('keeps a hit in view when its line is long', () => {
    const [hit] = findInText(`${'x'.repeat(500)}needle${'y'.repeat(500)}`, 'needle', true);
    expect(hit.text.length).toBeLessThanOrEqual(SEARCH_SNIPPET_CHARS);
    expect(hit.text.slice(hit.start, hit.end)).toBe('needle');
  });

  it('stops at the limit', () => {
    expect(findInText('a\n'.repeat(10), 'a', true, 3)).toHaveLength(3);
  });
});

describe('searchSessionFiles', () => {
  let root: string;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-search-'));
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'const needle = 1;\nconst other = 2;\n');
    fs.writeFileSync(path.join(root, 'b.txt'), 'nothing here\nNeedle again\n');
    fs.writeFileSync(path.join(root, 'bin.dat'), Buffer.from([0, 1, 2, 110, 101, 101, 100, 108, 101]));
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('lists the lines per file, skipping binaries and files that are gone', async () => {
    const result = await searchSessionFiles(root, ['src/a.ts', 'b.txt', 'bin.dat', 'gone.ts'], 'needle', false);
    expect(result.truncated).toBe(false);
    expect(result.matches.map((m) => `${m.path}:${m.line}`)).toEqual(['src/a.ts:1', 'b.txt:2']);
    expect((await searchSessionFiles(root, ['src/a.ts', 'b.txt'], 'needle', true)).matches.map((m) => m.path)).toEqual(['src/a.ts']);
  });

  it('reports a search that hit the limit as truncated', async () => {
    fs.writeFileSync(path.join(root, 'many.txt'), 'hit\n'.repeat(SEARCH_MAX_MATCHES + 20));
    const result = await searchSessionFiles(root, ['many.txt'], 'hit', true);
    expect(result.matches).toHaveLength(SEARCH_MAX_MATCHES);
    expect(result.truncated).toBe(true);
  });
});
