import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindRemotes, clonePrProject, findPrProject, githubRepo, parsePrUrl, resolvePr } from '../src/agent/from-pr';
import * as git from '../src/agent/git';
import { tr } from '@shared/i18n/runtime';

const id = parsePrUrl('https://github.com/ACME/app/pull/42?view=1');
const source = { ...id, baseBranch: 'main', headBranch: 'fix/42', headRepo: 'alice/app' };
afterEach(() => vi.restoreAllMocks());

describe('GitHub PR import', () => {
  it('canonicalizes identities but does not accept lookalike hosts or filesystem paths', () => {
    expect(id).toEqual({ baseRepo: 'acme/app', num: 42, url: 'https://github.com/acme/app/pull/42' });
    for (const url of [
      'http://github.com/a/b/pull/1',
      'https://github.com.evil/a/b/pull/1',
      'https://github.com/a/../pull/1',
      'https://github.com/a/b/pull/no',
    ])
      expect(() => parsePrUrl(url)).toThrow(tr('prstart.invalid'));
    expect(githubRepo('git@github.com:Alice/App.git')).toBe('alice/app');
    expect(githubRepo('ssh://git@github.com/Alice/App.git')).toBe('alice/app');
    expect(githubRepo('https://github.com.evil/alice/app')).toBeNull();
  });
  it('rejects closed PRs and missing source forks before cloning', async () => {
    const gh = vi.spyOn(git, 'gh').mockResolvedValue(JSON.stringify({ state: 'closed' }));
    await expect(resolvePr(id)).rejects.toThrow(tr('prstart.closed'));
    gh.mockResolvedValue(JSON.stringify({ state: 'open', head: { repo: null } }));
    await expect(resolvePr(id)).rejects.toThrow(tr('prstart.noHead'));
    expect(gh).toHaveBeenCalledWith(expect.any(String), ['api', '--hostname', 'github.com', 'repos/acme/app/pulls/42']);
  });
  it('matches repository identity, protects occupied destinations and does not reuse a mismatched push URL', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-pr-match-'));
    try {
      const dest = path.join(parent, 'app');
      fs.mkdirSync(dest);
      await git.git(dest, 'init', '-q');
      await git.git(dest, 'remote', 'add', 'origin', 'https://github.com/different/app.git');
      expect(await findPrProject([dest], source)).toBeNull();
      await expect(clonePrProject(parent, source)).rejects.toThrow(tr('prstart.occupied', { path: dest }));
      await git.git(dest, 'remote', 'set-url', 'origin', 'git@github.com:ACME/app.git');
      await git.git(dest, 'remote', 'add', 'fork', 'git@github.com:alice/app.git');
      await git.git(dest, 'remote', 'set-url', '--push', 'fork', 'https://github.com/different/app.git');
      expect(path.resolve((await findPrProject([dest], source))!)).toBe(path.resolve(await fs.promises.realpath(dest)));
      vi.spyOn(git, 'gh').mockResolvedValue('https');
      const b = await bindRemotes(dest, source);
      expect(b.baseRemote).toBe('origin');
      expect(b.headRemote).not.toBe('fork');
      expect((await git.git(dest, 'remote', 'get-url', '--push', b.headRemote))?.trim()).toBe(
        'https://github.com/alice/app.git',
      );
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  }, 30000);
});
