// Live working-tree state behind the composer's branch bar, against a real repository.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { baseRemote, branches, defaultBranch, remoteBranch, workState } from '../src/agent/git';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-git-state-'));
const repo = path.join(tmp, 'repo');
const noRemote = path.join(tmp, 'no-remote');
const remote = path.join(tmp, 'remote.git');
const saved = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_SYSTEM };

/** Commits need an identity; no developer config is allowed to leak in. */
const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args],
    {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
const write = (rel: string, text: string) => fs.writeFileSync(path.join(repo, rel), text);

describe('working-tree state', () => {
  beforeAll(() => {
    fs.writeFileSync(path.join(tmp, 'gitconfig'), '');
    process.env.GIT_CONFIG_GLOBAL = path.join(tmp, 'gitconfig');
    process.env.GIT_CONFIG_SYSTEM = path.join(tmp, 'gitconfig');
    fs.mkdirSync(repo);
    git(tmp, 'init', '--bare', remote);
    git(repo, 'init', '-b', 'main');
    write('tracked.txt', 'one\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'initial');
    git(repo, 'remote', 'add', 'origin', remote);
    git(repo, 'push', '-u', 'origin', 'main');
    fs.mkdirSync(noRemote);
    git(noRemote, 'init', '-b', 'main');
    fs.writeFileSync(path.join(noRemote, 'tracked.txt'), 'one\n');
    git(noRemote, 'add', '.');
    git(noRemote, 'commit', '-m', 'initial');
  });
  afterAll(() => {
    process.env.GIT_CONFIG_GLOBAL = saved.global;
    process.env.GIT_CONFIG_SYSTEM = saved.system;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('reports a pushed, clean tree as in sync', async () => {
    assert.deepEqual(await workState(repo), {
      dirty: [],
      ahead: 0,
      behind: 0,
      baseBehind: 0,
      base: null,
      upstream: 'origin/main',
      hasRemote: true,
    });
  });

  it('uses the remote default branch and keeps local and remote refs visible', async () => {
    assert.equal(await defaultBranch(repo), 'origin/main');
    assert.deepEqual(
      (await branches(repo)).filter((ref) => ref === 'main' || ref === 'origin/main'),
      ['main', 'origin/main'],
    );
  });

  it('follows the branch remote instead of assuming the name origin', async () => {
    git(repo, 'remote', 'rename', 'origin', 'upstream');
    try {
      assert.equal(await baseRemote(repo), 'upstream');
      assert.equal(await defaultBranch(repo), 'upstream/main');
      assert.equal(await remoteBranch(repo, 'main'), 'upstream/main');
    } finally {
      git(repo, 'remote', 'rename', 'upstream', 'origin');
    }
  });

  it('reports when a repository has no configured remote', async () => {
    const state = await workState(noRemote);
    assert.equal(state.hasRemote, false);
    assert.equal(state.upstream, null);
  });

  it('lists modified and untracked paths, including names with spaces', async () => {
    write('tracked.txt', 'two\n');
    write('new file.txt', 'hello\n');
    const state = await workState(repo);
    assert.deepEqual(state.dirty.sort(), ['new file.txt', 'tracked.txt']);
    assert.equal(state.ahead, 0);
  });

  it('counts committed work as unpushed instead of keeping it dirty', async () => {
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'change');
    assert.deepEqual((await workState(repo)).dirty, []);
    assert.equal((await workState(repo)).ahead, 1);
  });

  it('drops back to in sync once the commits are pushed', async () => {
    git(repo, 'push');
    assert.equal((await workState(repo)).ahead, 0);
  });

  it('counts commits the base branch has that the branch lacks', async () => {
    git(repo, 'checkout', '-b', 'topic');
    git(repo, 'checkout', 'main');
    write('tracked.txt', 'moved on\n');
    git(repo, 'commit', '-am', 'main moves');
    git(repo, 'push', 'origin', 'main');
    git(repo, 'checkout', 'topic');
    const state = await workState(repo, 'main');
    assert.equal(state.baseBehind, 1);
    assert.equal(state.base, 'origin/main');
    assert.equal((await workState(repo, 'gone')).baseBehind, 0);
  });

  it('reports no upstream for a branch that was never pushed', async () => {
    git(repo, 'checkout', '-b', 'feature');
    const state = await workState(repo);
    assert.equal(state.upstream, null);
    assert.equal(state.ahead, 0);
  });
});
