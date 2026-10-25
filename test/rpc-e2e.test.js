// End-to-end: real `pi --mode rpc` + desktop-kit + offline demo model, run
// against a fresh copy of the demo project. No API key required.
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { PiRpc, EXTENSIONS_DIR } = require('../electron/pi-rpc');

// `node --test` sets this for children; it would make the demo project's own `npm test` skip.
delete process.env.NODE_TEST_CONTEXT;

const DEMO = path.join(__dirname, '..', 'demo', 'todo-app');
const EXTENSIONS = [path.join(EXTENSIONS_DIR, 'desktop-kit', 'index.ts'), path.join(EXTENSIONS_DIR, 'demo-model.ts')];

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-desktop-test-'));
  fs.cpSync(DEMO, dir, { recursive: true });
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  return dir;
}

// Drive one prompt to agent_settled. `onUi` answers extension UI dialogs.
async function runPrompt(pi, message, onUi = () => ({ cancelled: true })) {
  const events = [];
  const ui = [];
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for agent_settled')), 60000);
    const onEvent = (ev) => {
      events.push(ev);
      if (ev.type === 'extension_ui_request' && ['select', 'confirm', 'input', 'editor'].includes(ev.method)) {
        ui.push(ev);
        pi.uiResponse(ev.id, onUi(ev));
      }
      if (ev.type === 'agent_settled') {
        clearTimeout(timer);
        pi.off('event', onEvent);
        resolve();
      }
    };
    pi.on('event', onEvent);
    pi.send({ type: 'prompt', message }).then((r) => {
      if (r.disposition !== 'started') { clearTimeout(timer); pi.off('event', onEvent); resolve(); }
    }, reject);
  });
  const tools = events.filter((e) => e.type === 'tool_execution_end');
  const finalText = events
    .filter((e) => e.type === 'message_end' && e.message.role === 'assistant')
    .map((e) => e.message.content.filter((c) => c.type === 'text').map((c) => c.text).join(''))
    .filter(Boolean)
    .at(-1);
  return { events, ui, tools, finalText };
}

describe('pi rpc + desktop-kit + demo model', { timeout: 180000 }, () => {
  let dir, pi;
  beforeEach(async () => {
    dir = makeProject();
    pi = new PiRpc({ cwd: dir, extensions: EXTENSIONS, env: { HOME: dir }, args: ['--no-session', '--offline', '--tools', '+grep,+find,+ls', '--model', 'demo/demo-coder'] }).start();
    const state = await pi.send({ type: 'get_state' });
    assert.equal(state.model.provider, 'demo');
  });
  afterEach(async () => {
    await pi.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('auto mode: fixes the bug end to end without prompts', async () => {
    const r = await runPrompt(pi, '日期显示少了一个月，帮我修一下');
    assert.equal(r.ui.length, 0, 'auto mode should not ask for edits or npm test');
    const names = r.tools.map((t) => t.toolName);
    for (const t of ['todo_write', 'grep', 'read', 'bash', 'edit']) assert.ok(names.includes(t), `missing ${t}`);
    const firstTest = r.tools.find((t) => t.toolName === 'bash');
    assert.equal(firstTest.isError, true, `tests fail before the fix: ${JSON.stringify(firstTest).slice(0, 600)}`);
    assert.equal(r.tools.filter((t) => t.toolName === 'bash').at(-1).isError, false, 'tests pass after the fix');
    assert.match(fs.readFileSync(path.join(dir, 'src/utils/date.js'), 'utf8'), /getMonth\(\) \+ 1/);
    const edit = r.tools.find((t) => t.toolName === 'edit');
    assert.match(edit.result.details.diff, /padStart/);
    assert.match(r.finalText, /测试全部通过/);
  });

  it('ask mode: edit prompts carry the tool call id; deny stops the run', async () => {
    await pi.send({ type: 'prompt', message: '/desktop-mode default' });
    const r = await runPrompt(pi, '日期显示少了一个月，帮我修一下', (ev) =>
      ev.title.includes('Run npm test') ? { value: 'Allow' } : { value: 'Deny' });
    const perm = r.ui.filter((u) => u.title.startsWith('[[pi-desktop:perm:'));
    assert.ok(perm.some((u) => /Run npm test/.test(u.title)), 'npm test asks in default mode');
    const editAsk = perm.find((u) => /Edit src\/utils\/date.js/.test(u.title));
    assert.ok(editAsk, 'edit asks in default mode');
    const id = editAsk.title.match(/\[\[pi-desktop:perm:([^\]]+)\]\]/)[1];
    assert.ok(r.events.some((e) => e.type === 'tool_execution_start' && e.toolCallId === id), 'id matches a tool call');
    assert.deepEqual(editAsk.options, ['Allow', 'Always allow', 'Deny']);
    assert.match(r.finalText, /不执行/);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'src/utils/date.js'), 'utf8'), /\+ 1/);
  });

  it('plan mode: blocks edits until the plan is approved, then auto-accepts', async () => {
    await pi.send({ type: 'prompt', message: '/desktop-mode plan' });
    const r = await runPrompt(pi, '添加深色模式', (ev) =>
      ev.title.startsWith('[[pi-desktop:plan:') ? { value: 'Approve & auto-accept edits' } : { value: 'Allow' });
    const plan = r.ui.find((u) => u.title.startsWith('[[pi-desktop:plan:'));
    assert.ok(plan, 'plan approval requested');
    const modes = r.events.filter((e) => e.type === 'extension_ui_request' && e.method === 'setStatus' && e.statusKey === 'pi-desktop-mode');
    assert.equal(modes.at(-1).statusText, 'acceptEdits');
    assert.ok(fs.existsSync(path.join(dir, 'src/components/ThemeToggle.jsx')));
    const perms = r.ui.filter((u) => u.title.startsWith('[[pi-desktop:perm:')).map((u) => u.title);
    assert.ok(!perms.some((t) => /Create|Edit/.test(t)), 'no edit prompts after approval');
    assert.ok(perms.some((t) => /Run npm run build/.test(t)), 'commands still ask in acceptEdits');
    assert.match(r.finalText, /深色模式已加好/);
  });

  it('subagent: task tool runs a child pi and returns its report', async () => {
    const r = await runPrompt(pi, '解释一下项目结构');
    const task = r.tools.find((t) => t.toolName === 'task');
    assert.ok(task, 'task tool ran');
    assert.equal(task.isError, false, JSON.stringify(task.result).slice(0, 400));
    assert.match(task.result.details.text, /数据流/);
    assert.ok(task.result.details.stats.reads >= 2);
  });

  it('auto mode: risky commands still ask (git push)', async () => {
    const r = await runPrompt(pi, '提交并创建 PR', (ev) => ({ value: 'Allow' }));
    const asked = r.ui.filter((u) => u.title.startsWith('[[pi-desktop:perm:')).map((u) => u.title);
    assert.ok(asked.some((t) => /git push/.test(t)), 'push asks');
    assert.ok(!asked.some((t) => /git status/.test(t)), 'read-only git does not ask');
    assert.match(r.finalText, /推送失败/);
  });
});

describe('cowork profile', { timeout: 120000 }, () => {
  const WORKSPACE = path.join(__dirname, '..', 'demo', 'cowork-workspace');
  const PROMPT = path.join(EXTENSIONS_DIR, 'cowork-prompt.md');
  let dir, pi;
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-cowork-test-'));
    fs.cpSync(WORKSPACE, dir, { recursive: true });
    pi = new PiRpc({
      cwd: dir, extensions: EXTENSIONS, env: { HOME: dir },
      args: ['--no-session', '--offline', '--tools', '+grep,+find,+ls', '--desktop-profile', 'cowork', '--append-system-prompt', PROMPT, '--model', 'demo/demo-coder'],
    }).start();
    await pi.send({ type: 'get_state' });
  });
  afterEach(async () => {
    await pi.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('organizes the inbox; moving files asks even in auto mode', async () => {
    const r = await runPrompt(pi, '帮我整理收件箱：归类、标记需要回复的邮件，并起草回复', () => ({ value: 'Allow' }));
    const system = r.events.find((e) => e.type === 'message_end' && e.message.role === 'system');
    assert.match(JSON.stringify(system.message), /Cowork/, 'cowork prompt appended');
    const asked = r.ui.filter((u) => u.title.startsWith('[[pi-desktop:perm:')).map((u) => u.title);
    assert.equal(asked.length, 1, `only the move asks: ${asked}`);
    assert.match(asked[0], /mv inbox\/04/);
    assert.ok(fs.existsSync(path.join(dir, '收件箱整理.md')));
    assert.ok(fs.existsSync(path.join(dir, 'inbox/已归档/04-行业周刊.txt')));
    assert.equal(r.tools.filter((t) => t.toolName === 'read').length, 5);
    assert.match(r.finalText, /收件箱整理好了/);
  });

  it('denying the move leaves the files in place', async () => {
    const r = await runPrompt(pi, '帮我整理收件箱', () => ({ value: 'Deny' }));
    assert.ok(fs.existsSync(path.join(dir, 'inbox/04-行业周刊.txt')));
    assert.match(r.finalText, /不执行/);
  });

  it('writes a daily briefing file from the folder contents', async () => {
    // The idea prompt also mentions 邮件; it must still be treated as a briefing.
    const r = await runPrompt(pi, '每个工作日早上 8 点给我发一份简报：日程、待办和重要邮件');
    assert.equal(r.ui.length, 0);
    const brief = fs.readdirSync(dir).find((f) => f.startsWith('每日简报-'));
    assert.ok(brief, 'briefing written');
    assert.match(fs.readFileSync(path.join(dir, brief), 'utf8'), /季度预算评审/);
  });
});
