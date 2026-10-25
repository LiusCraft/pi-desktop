// SessionHub: worktree creation, prompting, git-based changes, resume from the session file.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Store } = require('../electron/store');
const { SessionHub } = require('../electron/sessions');

delete process.env.NODE_TEST_CONTEXT;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-hub-'));
const project = path.join(tmp, 'todo-app');
fs.cpSync(path.join(__dirname, '..', 'demo', 'todo-app'), project, { recursive: true });
const g = (...a) => execFileSync('git', a, { cwd: project, stdio: 'pipe' });
g('init', '-q', '-b', 'main');
g('add', '-A');
g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');

const waitSettled = (hub, id) => new Promise((resolve) => {
  const on = ({ sessionId, event }) => {
    if (sessionId === id && event.type === 'agent_settled') { hub.off('event', on); resolve(); }
  };
  hub.on('event', on);
});

describe('SessionHub', { timeout: 120000 }, () => {
  const userData = path.join(tmp, 'userData');
  // Child pi processes get a throwaway HOME so tests never touch ~/.pi.
  const getEnv = () => ({ HOME: path.join(tmp, 'home') });
  fs.mkdirSync(path.join(tmp, 'home'), { recursive: true });
  let hub = new SessionHub({ store: new Store(userData), userData, getEnv });
  after(async () => {
    await hub.stopAll();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  let meta;
  it('lists the offline demo model', async () => {
    const { models } = await hub.models();
    assert.ok(models.some((m) => m.provider === 'demo' && m.id === 'demo-coder'));
  });

  it('creates a session in an isolated worktree on a claude/* branch', async () => {
    meta = await hub.create({ projectPath: project, worktree: true, title: 'Fix dates', model: 'demo/demo-coder' });
    assert.match(meta.branch, /^claude\//);
    assert.notEqual(meta.cwd, project);
    assert.ok(fs.existsSync(path.join(meta.cwd, 'src/utils/date.js')));
  });

  it('runs a prompt and reports changes against the base commit', async () => {
    const opened = await hub.open(meta.id);
    assert.equal(opened.state.model.id, 'demo-coder');
    const done = waitSettled(hub, meta.id);
    await hub.prompt(meta.id, '日期显示少了一个月，帮我修一下');
    await done;
    const changes = await hub.changes(meta.id);
    assert.deepEqual(changes.map((c) => c.path), ['src/utils/date.js', 'tests/date.test.js']);
    assert.match(changes[0].after, /getMonth\(\) \+ 1/);
    assert.doesNotMatch(changes[0].before, /\+ 1/);
    assert.match(fs.readFileSync(path.join(project, 'src/utils/date.js'), 'utf8'), /d\.getMonth\(\);/, 'main checkout untouched');
    assert.ok(hub.meta(meta.id).sessionFile, 'session file recorded');
  });

  it('cowork: scratch workspace when no folder is chosen', async () => {
    const m = await hub.create({ kind: 'cowork', title: 'hello', model: 'demo/demo-coder' });
    assert.equal(m.kind, 'cowork');
    assert.ok(m.scratch && fs.existsSync(m.cwd) && m.cwd.startsWith(userData));
    assert.equal(m.worktree, false);
  });

  it('cowork: runs in the chosen folder and routes approvals through the hub', async () => {
    const folder = path.join(tmp, 'workspace');
    fs.cpSync(path.join(__dirname, '..', 'demo', 'cowork-workspace'), folder, { recursive: true });
    const m = await hub.create({ kind: 'cowork', projectPath: folder, title: 'inbox', model: 'demo/demo-coder' });
    assert.equal(m.cwd, folder);
    await hub.open(m.id);
    const asks = [];
    const onUi = ({ sessionId, event }) => {
      if (sessionId === m.id && event.type === 'extension_ui_request' && event.method === 'select') {
        asks.push(event.title);
        hub.uiResponse(m.id, event.id, { value: 'Allow' });
      }
    };
    hub.on('event', onUi);
    const done = waitSettled(hub, m.id);
    await hub.prompt(m.id, '帮我整理收件箱');
    await done;
    hub.off('event', onUi);
    assert.equal(asks.length, 1);
    assert.ok(fs.existsSync(path.join(folder, '收件箱整理.md')));
    assert.ok(fs.existsSync(path.join(folder, 'inbox/已归档/04-行业周刊.txt')));
  });

  it('resumes history after a restart', async () => {
    await hub.stopAll();
    hub = new SessionHub({ store: new Store(userData), userData, getEnv });
    const opened = await hub.open(meta.id);
    const roles = opened.messages.map((m) => m.role);
    assert.ok(roles.includes('user') && roles.includes('assistant') && roles.includes('toolResult'));
  });
});
