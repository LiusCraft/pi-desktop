// PR / CI status through the GitHub CLI, with `gh` faked.
import assert from 'node:assert/strict';
import { beforeEach, describe, it, vi } from 'vitest';

const calls: { cmd: string; args: string[]; cwd: string }[] = [];
let responses: unknown[] = [];
vi.mock('node:child_process', async (orig) => ({
  ...(await orig<typeof import('node:child_process')>()),
  execFile: (cmd: string, args: string[], options: { cwd: string }, cb: (err: Error | null, out: string, errOut: string) => void) => {
    calls.push({ cmd, args, cwd: options.cwd });
    const response = responses.shift();
    cb(response instanceof Error ? response : null, response instanceof Error ? '' : JSON.stringify(response), '');
  },
}));
const { prStatus } = await import('../src/agent/git');

describe('GitHub PR status', () => {
  beforeEach(() => {
    calls.length = 0;
    responses = [];
  });
  it('maps PR identity, the card fields, draft state, comments and pending CI', async () => {
    responses = [{
      number: 1, url: 'https://github.com/example/repo/pull/1', state: 'OPEN', isDraft: true,
      title: 'feat: add tool previews', author: { login: 'LiusCraft' }, additions: 2504, deletions: 132, changedFiles: 21,
      mergeable: 'CONFLICTING', reviewDecision: 'CHANGES_REQUESTED', headRefOid: 'abc123', updatedAt: '2026-01-02T03:04:05Z',
      statusCheckRollup: [{ name: 'build', status: 'IN_PROGRESS', conclusion: '' }, { context: 'lint', state: 'SUCCESS' }],
      comments: [{}], reviews: [{ body: 'review' }, { body: '' }],
    }];
    const pr = (await prStatus('project'))!;
    assert.equal(pr.num, 1);
    assert.equal(pr.state, 'open');
    assert.equal(pr.draft, true);
    assert.equal(pr.comments, 2);
    assert.equal(pr.ci, 'pending');
    assert.deepEqual(pr.checks.map((c) => c.st), ['pending', 'pass']);
    assert.equal(pr.title, 'feat: add tool previews');
    assert.equal(pr.author, 'LiusCraft');
    assert.deepEqual([pr.additions, pr.deletions, pr.files], [2504, 132, 21]);
    assert.equal(pr.mergeable, 'conflicting');
    assert.equal(pr.review, 'changes');
    assert.equal(pr.head, 'abc123');
    assert.equal(pr.updatedAt, Date.parse('2026-01-02T03:04:05Z'));
    assert.equal(calls[0].cwd, 'project');
  });
  it('reports clean and unknown mergeability', async () => {
    responses = [{ number: 3, url: 'u', state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE' }];
    assert.equal((await prStatus('project'))!.mergeable, 'clean');
    calls.length = 0;
    responses = [{ number: 3, url: 'u', state: 'OPEN', isDraft: false, mergeable: 'UNKNOWN' }];
    assert.equal((await prStatus('project'))!.mergeable, 'unknown');
  });
  it('drops the card fields when gh rejects them, keeping identity and CI', async () => {
    responses = [
      new Error('Unknown JSON field: changedFiles'),
      { number: 2, url: 'https://github.com/example/repo/pull/2', state: 'MERGED', isDraft: false, title: 'merged work', author: { login: 'me' } },
    ];
    const pr = (await prStatus('project'))!;
    assert.equal(pr.num, 2);
    assert.equal(pr.state, 'merged');
    assert.equal(pr.ci, 'none');
    assert.equal(pr.title, 'merged work');
    assert.equal(pr.author, 'me');
    assert.equal(pr.mergeable, undefined);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].args.at(-1), 'number,url,state,isDraft,statusCheckRollup,comments,reviews,title,author');
  });
  it('falls back to PR identity when CI/review fields are inaccessible', async () => {
    responses = [new Error('Resource not accessible'), new Error('Resource not accessible'), { number: 2, url: 'https://github.com/example/repo/pull/2', state: 'MERGED', isDraft: false }];
    const pr = (await prStatus('project'))!;
    assert.equal(pr.num, 2);
    assert.equal(pr.state, 'merged');
    assert.equal(pr.ci, 'none');
    assert.equal(pr.title, undefined);
    assert.equal(calls.length, 3);
    assert.equal(calls[2].args.at(-1), 'number,url,state,isDraft');
  });
  it('returns null when no PR is available', async () => {
    responses = [new Error('No PR'), new Error('No PR'), new Error('No PR')];
    assert.equal(await prStatus('project'), null);
  });
});
