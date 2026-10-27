// PR / CI status through the GitHub and GitLab CLIs, with `gh` and `glab` faked.
import assert from 'node:assert/strict';
import { beforeEach, describe, it, vi } from 'vitest';

const calls: { cmd: string; args: string[]; cwd: string }[] = [];
let responses: unknown[] = [];
let remote = 'https://github.com/example/repo.git';
vi.mock('node:child_process', async (orig) => ({
  ...(await orig<typeof import('node:child_process')>()),
  execFile: (cmd: string, args: string[], options: { cwd: string }, cb: (err: Error | null, out: string, errOut: string) => void) => {
    calls.push({ cmd, args, cwd: options.cwd });
    if (cmd === 'git') return cb(null, remote, '');
    const response = responses.shift();
    cb(response instanceof Error ? response : null, response instanceof Error ? '' : JSON.stringify(response), '');
  },
}));
const { prStatus, readPr } = await import('../src/agent/git');

describe('GitHub PR status', () => {
  beforeEach(() => {
    calls.length = 0;
    responses = [];
    remote = 'https://github.com/example/repo.git';
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
    assert.equal(pr.forge, 'github');
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
    assert.equal(calls.filter((c) => c.cmd === 'gh').length, 2);
    assert.equal(calls[2].args.at(-1), 'number,url,state,isDraft,statusCheckRollup,comments,reviews,title,author');
  });
  it('falls back to PR identity when CI/review fields are inaccessible', async () => {
    responses = [new Error('Resource not accessible'), new Error('Resource not accessible'), { number: 2, url: 'https://github.com/example/repo/pull/2', state: 'MERGED', isDraft: false }];
    const pr = (await prStatus('project'))!;
    assert.equal(pr.num, 2);
    assert.equal(pr.state, 'merged');
    assert.equal(pr.ci, 'none');
    assert.equal(pr.title, undefined);
    assert.equal(calls.filter((c) => c.cmd === 'gh').length, 3);
    assert.equal(calls[3].args.at(-1), 'number,url,state,isDraft');
  });
  it('returns null when no PR is available', async () => {
    responses = [new Error('No PR'), new Error('No PR'), new Error('No PR')];
    assert.equal(await prStatus('project'), null);
  });
});

describe('GitLab merge request status', () => {
  beforeEach(() => {
    calls.length = 0;
    responses = [];
    remote = 'git@gitlab.com:group/sub/repo.git';
  });
  const mr = {
    iid: 7, web_url: 'https://gitlab.com/group/sub/repo/-/merge_requests/7', state: 'opened', draft: false, project_id: 42,
    title: 'fix: retry', author: { username: 'me' }, changes_count: '3', has_conflicts: false, detailed_merge_status: 'ci_still_running',
    sha: 'abc', updated_at: '2026-01-02T03:04:05Z', head_pipeline: { id: 9, status: 'running' },
  };
  it('maps the merge request, its jobs and who wrote the notes', async () => {
    responses = [
      mr,
      [{ name: 'build', status: 'running', web_url: 'j1' }, { name: 'lint', status: 'success' }, { name: 'flaky', status: 'failed', allow_failure: true }],
      [{ id: 1, body: 'looks off', author: { username: 'bob' } }, { id: 2, body: 'merged main', system: true, author: { username: 'bob' } }, { id: 3, body: 'done', author: { username: 'me' } }],
      { username: 'me' },
    ];
    const snap = (await readPr('project'))!;
    assert.deepEqual(calls.filter((c) => c.cmd === 'glab').map((c) => c.args[0]), ['mr', 'api', 'api', 'api']);
    assert.equal(snap.status.forge, 'gitlab');
    assert.equal(snap.status.num, 7);
    assert.equal(snap.status.state, 'open');
    assert.equal(snap.status.ci, 'pending');
    assert.deepEqual(snap.status.checks.map((c) => c.st), ['pending', 'pass', 'pass']);
    assert.equal(snap.status.mergeable, 'clean');
    assert.equal(snap.status.files, 3);
    assert.equal(snap.status.head, 'abc');
    assert.equal(snap.status.comments, 2);
    assert.deepEqual(snap.notes.map((n) => [n.id, n.author, n.self]), [['n1', 'bob', false], ['n3', 'me', true]]);
  });
  it('reports conflicts, unresolved threads and failed jobs', async () => {
    responses = [
      { ...mr, has_conflicts: true, detailed_merge_status: 'discussions_not_resolved', state: 'merged' },
      [{ name: 'test', status: 'failed' }],
      [],
    ];
    const { status } = (await readPr('project'))!;
    assert.equal(status.state, 'merged');
    assert.equal(status.mergeable, 'conflicting');
    assert.equal(status.review, 'changes');
    assert.equal(status.ci, 'fail');
  });
  it('falls back to the pipeline when its jobs are unreadable, and never asks gh', async () => {
    responses = [mr, new Error('403'), new Error('403')];
    const { status } = (await readPr('project'))!;
    assert.deepEqual(status.checks.map((c) => c.n), ['pipeline']);
    assert.equal(calls.some((c) => c.cmd === 'gh'), false);
  });
  it('tries gh then glab when the host name does not say', async () => {
    remote = 'https://git.example.com/team/repo.git';
    responses = [new Error('not a github repo'), new Error('not a github repo'), new Error('not a github repo'), mr, [], []];
    const { status } = (await readPr('project'))!;
    assert.equal(status.forge, 'gitlab');
    assert.equal(calls.some((c) => c.cmd === 'gh'), true);
  });
});
