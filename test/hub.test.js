// SessionHub: worktree creation, prompting, git-based changes, resume from the session file.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Store } = require('../electron/store');
const { SessionHub } = require('../electron/sessions');
const { importAttachments } = require('../electron/attachments');
const { decodeUserContent } = require('../renderer/attachments');

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

  let meta, toolBeforeRestart, imagePayload;
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
    const history = await hub.open(meta.id);
    toolBeforeRestart = history.messages.find((m) => m.role === 'toolResult' && m.toolName === 'edit' && m.details?.diff);
    assert.match(toolBeforeRestart?.details?.diff || '', /getMonth/);
    toolBeforeRestart = JSON.parse(JSON.stringify(toolBeforeRestart));
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

  it('uses the first prompt as the title until the model names the session', async () => {
    const m = await hub.create({ projectPath: project, worktree: false, model: 'demo/demo-coder' });
    assert.equal(m.title, 'New session');
    assert.equal(m.autoName, true);
    const done = waitSettled(hub, m.id);
    await hub.prompt(m.id, '@src/utils/date.js 写一首关于秋天的诗');
    assert.equal(hub.meta(m.id).title, '写一首关于秋天的诗');
    assert.equal(hub.meta(m.id).nameAttempted, true);
    await done;
    // The offline demo model cannot name sessions, so the placeholder stays.
    assert.equal(hub.meta(m.id).title, '写一首关于秋天的诗');
  });

  it('manual rename wins and disables auto naming', async () => {
    const m = await hub.create({ projectPath: project, worktree: false, model: 'demo/demo-coder' });
    await hub.update(m.id, { title: 'My own title' });
    const done = waitSettled(hub, m.id);
    await hub.prompt(m.id, '写一首关于秋天的诗');
    const meta = hub.meta(m.id);
    assert.equal(meta.title, 'My own title');
    assert.equal(meta.autoName, false);
    assert.equal(meta.titleLocked, true);
    await done;
  });

  it('persists a real image payload and mixed file reference using an idle follow-up', async () => {
    const image = path.join(tmp, 'pixel.png');
    const note = path.join(tmp, 'note.txt');
    fs.writeFileSync(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
    fs.writeFileSync(note, 'Reference document');
    const result = await importAttachments([{ path: image }, { path: note }]);
    assert.deepEqual(result.errors, []);
    imagePayload = { text: 'Look at this picture', attachments: result.attachments, clientId: 'hub-image-turn' };
    const done = waitSettled(hub, meta.id);
    await hub.prompt(meta.id, imagePayload, 'followUp');
    await done;
    const history = await hub.open(meta.id);
    const turn = history.messages.filter((m) => m.role === 'user').map((m) => decodeUserContent(m.content)).find((m) => m.clientId === imagePayload.clientId);
    assert.ok(turn, 'structured user turn persisted');
    assert.equal(turn.text, imagePayload.text);
    assert.deepEqual(turn.attachments, imagePayload.attachments);
  });

  it('rejects an in-flight attachment prompt if pi exits during validation without restarting it', async (t) => {
    const file = imagePayload.attachments.find((a) => a.kind === 'file').path;
    const originalStat = fs.promises.stat.bind(fs.promises);
    let releaseStat, validationStarted;
    const entered = new Promise((resolve) => { validationStarted = resolve; });
    const gate = new Promise((resolve) => { releaseStat = resolve; });
    const mock = t.mock.method(fs.promises, 'stat', async (p, ...args) => {
      if (p === file) { validationStarted(); await gate; }
      return originalStat(p, ...args);
    });
    const pi = hub.procs.get(meta.id);
    const before = hub.processVersions.get(meta.id) || 0;
    const rejected = assert.rejects(hub.prompt(meta.id, { ...imagePayload, clientId: 'cancelled-before-admission' }), /pi exited while preparing/);
    try {
      await entered;
      await pi.stop();
      assert.equal(hub.procs.has(meta.id), false);
      assert.equal(hub.processVersions.get(meta.id), before + 1);
    } finally { releaseStat(); mock.mock.restore(); }
    await rejected;
    assert.equal(hub.procs.has(meta.id), false, 'late validation must not start a replacement process');
  });

  it('resumes history after a restart', async () => {
    await hub.stopAll();
    hub = new SessionHub({ store: new Store(userData), userData, getEnv });
    const opened = await hub.open(meta.id);
    const roles = opened.messages.map((m) => m.role);
    assert.ok(roles.includes('user') && roles.includes('assistant') && roles.includes('toolResult'));
    const restoredTool = opened.messages.find((m) => m.role === 'toolResult' && m.toolCallId === toolBeforeRestart.toolCallId);
    assert.deepEqual(restoredTool, toolBeforeRestart, 'tool content and diff details survive restart');
    const restoredTurn = opened.messages.filter((m) => m.role === 'user').map((m) => decodeUserContent(m.content)).find((m) => m.clientId === imagePayload.clientId);
    assert.ok(restoredTurn, 'native image user turn survives restart');
    assert.equal(restoredTurn.text, imagePayload.text);
    assert.deepEqual(restoredTurn.attachments, imagePayload.attachments);
  });
});
