// Which code host a remote URL belongs to, and the prompts' CLI words.
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { forgeOfUrl, forgeWords } from '../src/shared/forge';
import { prRepo } from '../src/shared/pr-status';

describe('forge', () => {
  it('tells the host from https, ssh and scp-style remotes', () => {
    assert.equal(forgeOfUrl('https://github.com/a/b.git'), 'github');
    assert.equal(forgeOfUrl('git@github.com:a/b.git'), 'github');
    assert.equal(forgeOfUrl('ssh://git@gitlab.example.com:2222/g/p.git'), 'gitlab');
    assert.equal(forgeOfUrl('git@gitlab.com:g/s/p.git'), 'gitlab');
    assert.equal(forgeOfUrl('https://git.example.com/a/b.git'), null);
    assert.equal(forgeOfUrl(null), null);
  });
  it('words prompts for the right CLI, and names both when unsure', () => {
    assert.equal(forgeWords('github').create, 'gh pr create');
    assert.equal(forgeWords('gitlab').create, 'glab mr create');
    assert.equal(forgeWords('gitlab').noun, 'MR');
    assert.match(forgeWords(null).create, /gh pr create.*glab mr create/);
  });
  it('reads the repository path from a PR or merge request URL', () => {
    assert.equal(prRepo('https://github.com/a/b/pull/3', 'x'), 'a/b');
    assert.equal(prRepo('https://gitlab.com/g/s/p/-/merge_requests/3', 'x'), 'g/s/p');
    assert.equal(prRepo('u', 'x'), 'x');
  });
});
