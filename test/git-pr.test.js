const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
let responses, calls;
mock.method(childProcess, 'execFile', (cmd, args, options, cb) => {
  calls.push({ cmd, args, cwd: options.cwd });
  const response = responses.shift();
  cb(response instanceof Error ? response : null, response instanceof Error ? '' : JSON.stringify(response), '');
});
const { prStatus } = require('../electron/git');

describe('GitHub PR status', () => {
  it('maps PR identity, draft state, comments and pending CI', async () => {
    calls = [];
    responses = [{ number: 1, url: 'https://github.com/example/repo/pull/1', state: 'OPEN', isDraft: true,
      statusCheckRollup: [{ name: 'build', status: 'IN_PROGRESS', conclusion: '' }, { context: 'lint', state: 'SUCCESS' }],
      comments: [{}], reviews: [{ body: 'review' }, { body: '' }],
    }];
    const pr = await prStatus('project');
    assert.equal(pr.num, 1);
    assert.equal(pr.state, 'open');
    assert.equal(pr.draft, true);
    assert.equal(pr.comments, 2);
    assert.equal(pr.ci, 'pending');
    assert.deepEqual(pr.checks.map((c) => c.st), ['pending', 'pass']);
    assert.equal(calls[0].cwd, 'project');
  });
  it('falls back to PR identity when CI/review fields are inaccessible', async () => {
    calls = [];
    responses = [new Error('Resource not accessible'), { number: 2, url: 'https://github.com/example/repo/pull/2', state: 'MERGED', isDraft: false }];
    const pr = await prStatus('project');
    assert.equal(pr.num, 2);
    assert.equal(pr.state, 'merged');
    assert.equal(pr.ci, 'none');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].args.at(-1), 'number,url,state,isDraft');
  });
  it('returns null when no PR is available', async () => {
    calls = [];
    responses = [new Error('No PR'), new Error('No PR')];
    assert.equal(await prStatus('project'), null);
  });
});
