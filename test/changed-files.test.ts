import { describe, expect, it } from 'vitest';
import { changedFileSummaries } from '../src/renderer/src/lib/changed-files';

const change = (path: string, status: 'A' | 'M' | 'D') => ({
  path,
  status,
  binary: false,
  add: status === 'A' ? 8 : 3,
  del: status === 'M' ? 1 : 0,
  rev: `${path}:${status}`,
});

describe('changed file summaries', () => {
  it('sorts recent outputs first and joins the matching diff metadata', () => {
    const files = changedFileSummaries(
      [
        { path: 'src/new.ts', kind: 'write', t: 10 },
        { path: 'src/changed.ts', kind: 'write', t: 30 },
        { path: 'notes.md', kind: 'edit', t: 20 },
      ],
      [change('src/new.ts', 'A'), change('src/changed.ts', 'M')],
    );

    expect(files.map(({ path }) => path)).toEqual(['src/changed.ts', 'notes.md', 'src/new.ts']);
    expect(files[0]).toMatchObject({ created: false, change: { add: 3, del: 1 } });
    expect(files[1]).toMatchObject({ created: false, change: undefined });
    expect(files[2]).toMatchObject({ created: true, change: { status: 'A' } });
  });

  it('uses the output operation when git metadata is unavailable', () => {
    expect(
      changedFileSummaries(
        [
          { path: 'created.txt', kind: 'write', t: 1 },
          { path: 'edited.txt', kind: 'edit', t: 2 },
        ],
        [],
      ),
    ).toMatchObject([
      { path: 'edited.txt', created: false },
      { path: 'created.txt', created: true },
    ]);
  });

  it('returns an empty list when the session has no output files', () => {
    expect(changedFileSummaries([], [])).toEqual([]);
  });
});
