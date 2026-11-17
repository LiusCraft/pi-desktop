import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { branchBases, changeContent, compare } from '../src/agent/git';

let dir: string;
let initial: string;
const git = (...args: string[]) =>
  execFileSync(
    'git',
    ['-c', 'user.name=Diff Test', '-c', 'user.email=diff@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
const write = (file: string, text: string) => fs.writeFileSync(path.join(dir, file), text);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-diff-comparison-'));
  git('init', '-b', 'main');
  git('config', 'core.autocrlf', 'false');
  write('tracked.txt', 'base\nshared\n');
  write('deleted.txt', 'delete me\n');
  git('add', '.');
  git('commit', '-m', 'Initial');
  initial = git('rev-parse', 'HEAD');
  git('checkout', '-b', 'topic');
  write('tracked.txt', 'committed\nshared\n');
  write('committed.txt', 'committed file\n');
  git('add', '.');
  git('commit', '-m', 'Topic work');
  write('tracked.txt', 'working\nshared\n');
  fs.unlinkSync(path.join(dir, 'deleted.txt'));
  write('untracked name.txt', 'untracked\n');
  write('staged.txt', 'staged\n');
  git('add', 'staged.txt');
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

describe('Diff comparison bases', () => {
  it('compares branch work and uncommitted work without checking out or writing refs', async () => {
    const head = git('rev-parse', 'HEAD');
    const status = git('status', '--porcelain');
    const result = await compare(dir, initial, { kind: 'branch', ref: 'main' });
    expect(result.base).toBe(initial);
    expect(result.files.map((f) => f.path)).toEqual([
      'committed.txt',
      'deleted.txt',
      'staged.txt',
      'tracked.txt',
      'untracked name.txt',
    ]);
    expect(result.commits.map((c) => c.subject)).toEqual(['Topic work']);
    expect(git('rev-parse', 'HEAD')).toBe(head);
    expect(git('branch', '--show-current')).toBe('topic');
    expect(git('status', '--porcelain')).toBe(status);
  });

  it('Last commit uses HEAD, including staged, unstaged, deleted and untracked files but no committed work', async () => {
    const result = await compare(dir, initial, { kind: 'lastCommit' });
    expect(result.base).toBe(git('rev-parse', 'HEAD'));
    expect(result.files.map((f) => f.path)).toEqual(['deleted.txt', 'staged.txt', 'tracked.txt', 'untracked name.txt']);
    expect(result.commits).toEqual([]);
    expect(await changeContent(dir, result.base, 'tracked.txt', null)).toEqual({
      before: 'committed\nshared\n',
      after: 'working\nshared\n',
      binary: false,
    });
  });

  it('pins lazy content reads to the listing even when its branch ref moves', async () => {
    const result = await compare(dir, initial, { kind: 'branch', ref: 'main' });
    git('update-ref', 'refs/heads/main', 'HEAD');
    expect(await changeContent(dir, result.base, 'tracked.txt', null)).toMatchObject({
      before: 'base\nshared\n',
      after: 'working\nshared\n',
    });
    const newer = await compare(dir, initial, { kind: 'branch', ref: 'main' });
    expect(newer.base).not.toBe(result.base);
    expect(newer.files.find((f) => f.path === 'tracked.txt')?.rev).not.toBe(
      result.files.find((f) => f.path === 'tracked.txt')?.rev,
    );
  });

  it('rejects deleted branch bases instead of silently showing another comparison', async () => {
    await expect(compare(dir, initial, { kind: 'branch', ref: 'gone' })).rejects.toThrow('Unknown branch gone');
  });

  it('does not fall back to the session base for an unrelated branch', async () => {
    const unrelated = git('commit-tree', git('rev-parse', 'HEAD^{tree}'), '-m', 'Unrelated root');
    git('update-ref', 'refs/heads/unrelated', unrelated);
    await expect(compare(dir, initial, { kind: 'branch', ref: 'unrelated' })).rejects.toThrow('No common ancestor');
  });

  it('lists local and remote branch metadata, excluding the remote HEAD alias', async () => {
    git('update-ref', 'refs/remotes/upstream/main', initial);
    git('symbolic-ref', 'refs/remotes/upstream/HEAD', 'refs/remotes/upstream/main');
    const bases = await branchBases(dir);
    expect(bases.map((b) => b.name).sort()).toEqual(['main', 'topic', 'upstream/main']);
    expect(bases.find((b) => b.name === 'upstream/main')).toMatchObject({
      hash: initial,
      subject: 'Initial',
      author: 'Diff Test',
    });
    expect(initial.startsWith(bases.find((b) => b.name === 'upstream/main')!.short)).toBe(true);
    expect(Number.isFinite(Date.parse(bases[0].date))).toBe(true);
  });
});
