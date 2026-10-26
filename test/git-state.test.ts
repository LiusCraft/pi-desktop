// Live working-tree state behind the composer's branch bar, against a real repository.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { workState } from '../src/agent/git';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-git-state-'));
const repo = path.join(tmp, 'repo');
const remote = path.join(tmp, 'remote.git');
const saved = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_SYSTEM };

/** Commits need an identity; no developer config is allowed to leak in. */
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
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
  });
  afterAll(() => {
    process.env.GIT_CONFIG_GLOBAL = saved.global;
    process.env.GIT_CONFIG_SYSTEM = saved.system;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('reports a pushed, clean tree as in sync', async () => {
    assert.deepEqual(await workState(repo), { dirty: [], ahead: 0, upstream: 'origin/main' });
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

  it('reports no upstream for a branch that was never pushed', async () => {
    git(repo, 'checkout', '-b', 'feature');
    const state = await workState(repo);
    assert.equal(state.upstream, null);
    assert.equal(state.ahead, 0);
  });
});
