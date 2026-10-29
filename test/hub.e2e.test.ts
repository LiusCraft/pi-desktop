// End-to-end: the agent host's SessionHub running real in-process pi sessions with
// desktop-kit and the offline demo model. No API key and no Electron required.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decodeUserContent } from '@shared/attachments';
import { MAX_SESSION_TITLE, type HostEvent, type PermissionMode, type PiEvent, type UiRequest, type UiResponse } from '@shared/protocol';
import { importAttachments } from '../src/agent/attachments';
import { SessionHub } from '../src/agent/hub';
import { setActiveLocale } from '../src/shared/i18n/runtime';

// These assertions read the host's Chinese messages.
setActiveLocale('zh');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-desktop-hub-'));
const agentDir = path.join(tmp, 'agent');
// pi resolves its config (sessions, settings, auth) from here: never touch ~/.pi in tests.
process.env.PI_CODING_AGENT_DIR = agentDir;

function makeProject(name: string) {
  const dir = path.join(tmp, name);
  fs.cpSync(path.join(ROOT, 'demo', 'todo-app'), dir, { recursive: true });
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  return dir;
}

type Answer = (req: UiRequest) => UiResponse;

/** Collects one session's events and answers its questions. */
class Driver {
  events: HostEvent[] = [];
  answer: Answer = () => ({ cancelled: true });
  hub: SessionHub;
  constructor() {
    this.hub = new SessionHub({ dataDir: path.join(tmp, 'data'), agentDir, demoModel: true, emit: (e) => this.onEvent(e) });
  }
  private waiters: { id: string; resolve: () => void }[] = [];
  private onEvent(e: HostEvent) {
    this.events.push(e);
    if (e.type === 'ui_request') queueMicrotask(() => this.hub.respond(e.sessionId, e.request.id, this.answer(e.request)));
    if (e.type === 'pi' && e.event.type === 'agent_settled') {
      for (const w of this.waiters.filter((w) => w.id === e.sessionId)) w.resolve();
      this.waiters = this.waiters.filter((w) => w.id !== e.sessionId);
    }
  }
  /** Run one prompt to agent_settled. */
  async run(id: string, text: string, answer?: Answer) {
    if (answer) this.answer = answer;
    const from = this.events.length;
    const settled = new Promise<void>((resolve) => this.waiters.push({ id, resolve }));
    const { disposition } = await this.hub.prompt(id, { text, attachments: [] }, 'steer');
    if (disposition === 'started') await settled;
    const events = this.events.slice(from).filter((e) => 'sessionId' in e && e.sessionId === id);
    const pi = events.filter((e): e is Extract<HostEvent, { type: 'pi' }> => e.type === 'pi').map((e) => e.event);
    const ui = events.filter((e): e is Extract<HostEvent, { type: 'ui_request' }> => e.type === 'ui_request').map((e) => e.request);
    const tools = pi.filter((e) => e.type === 'tool_execution_end');
    const finalText = pi
      .filter((e) => e.type === 'message_end' && e.message.role === 'assistant')
      .map((e: PiEvent) => e.message.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join(''))
      .filter(Boolean)
      .at(-1) as string;
    return { pi, ui, tools, finalText, events };
  }
}

let driver: Driver;
beforeAll(async () => {
  driver = new Driver();
  await driver.hub.init();
});
afterAll(async () => {
  await driver.hub.shutdown();
  // Windows can report EBUSY for a moment after a shell holding the folder was killed.
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const codeSession = async (mode: PermissionMode = 'auto', worktree = false) => {
  const project = makeProject(`proj-${Math.random().toString(36).slice(2, 8)}`);
  const meta = await driver.hub.create({ kind: 'code', projectPath: project, worktree, model: 'demo/demo-coder', mode, title: 'test', autoName: false });
  return { project, meta };
};
const read = (dir: string, rel: string) => fs.readFileSync(path.join(dir, rel), 'utf8');

describe('code sessions', { timeout: 120_000 }, () => {
  it('lists the offline demo model and its thinking levels', async () => {
    const { models } = await driver.hub.listModels();
    expect(models.some((m) => m.provider === 'demo' && m.id === 'demo-coder')).toBe(true);
    expect(driver.hub.thinkingLevels('demo/demo-coder').length).toBeGreaterThan(1);
  });

  it('answers a session’s live state without its transcript, and stays quiet for one nobody holds', async () => {
    const { meta } = await codeSession();
    expect(driver.hub.sessionState(meta.id), 'not held live before it is opened').toBeNull();
    const opened = await driver.hub.open(meta.id);
    const state = driver.hub.sessionState(meta.id)!;
    expect(state.model).toBe(opened.model);
    expect(state.thinking).toBe(opened.thinking);
    expect(state.levels).toEqual(opened.levels);
    // A level picked elsewhere (another window, the terminal) is what a view coming back must show.
    // pi clamps a level the provider does not really run at, so pick one that survives: the lowest it offers.
    const picked = state.levels.includes('medium') ? 'medium' : state.levels[0];
    await driver.hub.setThinking(meta.id, picked);
    expect(driver.hub.sessionState(meta.id)!.thinking).toBe(picked);
    expect(driver.hub.meta(meta.id).thinking).toBe(picked);
  });

  it('auto mode: fixes the bug end to end in an isolated worktree, without prompts', async () => {
    const { project, meta } = await codeSession('auto', true);
    expect(meta.branch).toMatch(/^claude\//);
    expect(meta.cwd).not.toBe(project);
    expect(meta.cwd.startsWith(path.join(tmp, 'data', '.worktree') + path.sep), 'default worktree root').toBe(true);
    const opened = await driver.hub.open(meta.id);
    expect(opened.model).toBe('demo/demo-coder');

    const r = await driver.run(meta.id, '日期显示少了一个月，帮我修一下');
    expect(r.ui).toHaveLength(0);
    const names = r.tools.map((t) => t.toolName);
    for (const t of ['pidesk_todo_write', 'grep', 'read', 'bash', 'edit']) expect(names).toContain(t);
    const bash = r.tools.filter((t) => t.toolName === 'bash');
    expect(bash[0].isError, 'tests fail before the fix').toBe(true);
    expect(bash.at(-1)!.isError, 'tests pass after the fix').toBe(false);
    expect(read(meta.cwd, 'src/utils/date.js')).toMatch(/getMonth\(\) \+ 1/);
    expect(read(project, 'src/utils/date.js'), 'main checkout untouched').not.toMatch(/getMonth\(\) \+ 1/);
    expect(r.finalText).toMatch(/测试全部通过/);

    const { files, state } = await driver.hub.changes(meta.id);
    expect(files.map((c) => c.path).sort()).toEqual(['src/utils/date.js', 'tests/date.test.js']);
    // The worktree starts clean but the agent left the edits uncommitted.
    expect(state.dirty.sort()).toEqual(['src/utils/date.js', 'tests/date.test.js']);
    expect(state.ahead).toBe(0);
    const status = r.events.filter((e) => e.type === 'status').map((e) => (e as any).status);
    expect(status).toEqual(['running', 'idle']);
  });

  it('ask mode: edits and commands ask; deny stops the run', async () => {
    const { meta } = await codeSession('default');
    const r = await driver.run(meta.id, '日期显示少了一个月，帮我修一下', (req) =>
      req.title.includes('Run npm test') ? { value: 'Allow' } : { value: 'Deny' });
    const perms = r.ui.filter((u) => u.kind === 'permission');
    expect(perms.some((u) => /Run npm test/.test(u.title))).toBe(true);
    const edit = perms.find((u) => /Edit src\/utils\/date.js/.test(u.title)) as Extract<UiRequest, { kind: 'permission' }>;
    expect(edit).toBeTruthy();
    expect(r.pi.some((e) => e.type === 'tool_execution_start' && e.toolCallId === edit.toolCallId), 'request names its tool call').toBe(true);
    expect(r.finalText).toMatch(/不执行/);
    expect(read(meta.cwd, 'src/utils/date.js')).not.toMatch(/\+ 1/);
  });

  it('plan mode: blocks edits until the plan is approved, then auto-accepts edits', async () => {
    const { meta } = await codeSession('plan');
    const r = await driver.run(meta.id, '添加深色模式', (req) =>
      req.kind === 'plan' ? { value: 'Approve & auto-accept edits' } : { value: 'Allow' });
    expect(r.ui.some((u) => u.kind === 'plan')).toBe(true);
    const metas = r.events.filter((e) => e.type === 'meta').map((e) => (e as any).meta.mode);
    expect(metas.at(-1)).toBe('acceptEdits');
    expect(driver.hub.meta(meta.id).mode).toBe('acceptEdits');
    expect(fs.existsSync(path.join(meta.cwd, 'src/components/ThemeToggle.jsx'))).toBe(true);
    const perms = r.ui.filter((u) => u.kind === 'permission').map((u) => u.title);
    expect(perms.some((t) => /Create|Edit/.test(t)), 'no edit prompts after approval').toBe(false);
    expect(perms.some((t) => /Run npm run build/.test(t)), 'commands still ask in acceptEdits').toBe(true);
    expect(r.finalText).toMatch(/深色模式已加好/);
  });

  it('switching the mode mid-session takes effect on the next tool call', async () => {
    const { meta } = await codeSession('auto');
    await driver.hub.open(meta.id);
    driver.hub.setMode(meta.id, 'default');
    const r = await driver.run(meta.id, '日期显示少了一个月，帮我修一下', () => ({ value: 'Deny' }));
    expect(r.ui.some((u) => u.kind === 'permission')).toBe(true);
  });

  it('subagent: the task tool runs an in-process read-only session and returns its report', async () => {
    const { meta } = await codeSession();
    const r = await driver.run(meta.id, '解释一下项目结构');
    const task = r.tools.find((t) => t.toolName === 'pidesk_task')!;
    expect(task, 'task tool ran').toBeTruthy();
    expect(task.isError, JSON.stringify(task.result).slice(0, 400)).toBe(false);
    expect(task.result.details.text).toMatch(/数据流/);
    expect(task.result.details.stats.reads).toBeGreaterThanOrEqual(2);
    expect(r.pi.some((e) => e.type === 'tool_execution_update' && e.toolName === 'pidesk_task'), 'progress updates').toBe(true);
  });

  it('auto mode: risky commands still ask (git push)', async () => {
    const { meta } = await codeSession();
    const r = await driver.run(meta.id, '提交并创建 PR', () => ({ value: 'Allow' }));
    const asked = r.ui.filter((u) => u.kind === 'permission').map((u) => u.title);
    expect(asked.some((t) => /git push/.test(t))).toBe(true);
    expect(asked.some((t) => /git status/.test(t))).toBe(false);
    expect(r.finalText).toMatch(/推送失败/);
  });

  it('resumes from the session file with tool details and image attachments', async () => {
    const { meta } = await codeSession();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
    const imagePath = path.join(tmp, 'pixel.png');
    fs.writeFileSync(imagePath, png);
    const imported = await importAttachments([{ path: imagePath }]);
    expect(imported.errors).toEqual([]);
    const image = imported.attachments[0];
    expect(image.kind).toBe('image');

    await driver.hub.open(meta.id);
    const settled = driver.run(meta.id, '日期显示少了一个月，帮我修一下');
    await settled;
    // A second prompt carrying an image through the real validation path.
    const before = driver.events.length;
    await driver.hub.prompt(meta.id, { text: 'look', attachments: [image], clientId: 'img-1' }, 'steer');
    await new Promise<void>((resolve) => {
      const t = setInterval(() => {
        if (driver.events.slice(before).some((e) => e.type === 'pi' && e.sessionId === meta.id && e.event.type === 'agent_settled')) { clearInterval(t); resolve(); }
      }, 50);
    });

    await driver.hub.archive(meta.id); // disposes the live session
    const m = driver.hub.meta(meta.id);
    m.archived = false; // reopen from disk
    const reopened = await driver.hub.open(meta.id);
    const edit = reopened.messages.find((x) => x.role === 'toolResult' && x.toolName === 'edit');
    expect(edit?.details?.diff).toMatch(/padStart/);
    const user = reopened.messages.filter((x) => x.role === 'user').map((x) => decodeUserContent(x.content)).find((u) => u.clientId === 'img-1');
    expect(user?.text).toBe('look');
    expect(user?.attachments[0]).toMatchObject({ kind: 'image', name: 'pixel.png' });
    expect((user?.attachments[0] as any).data).toBeTruthy();
  });

  it('/clear starts a fresh context and keeps the session', async () => {
    const { meta } = await codeSession();
    await driver.run(meta.id, '你好');
    const first = driver.hub.meta(meta.id).sessionFile;
    await driver.hub.newContext(meta.id);
    const opened = await driver.hub.open(meta.id);
    expect(opened.messages.filter((m) => m.role === 'user')).toHaveLength(0);
    expect(driver.hub.meta(meta.id).sessionFile).not.toBe(first);
  });

  it('rewinds an exact user message and persists the new leaf before resending', async () => {
    const { meta } = await codeSession();
    const firstRun = await driver.run(meta.id, '你好');
    expect(firstRun.pi.find((event) => event.type === 'message_end' && event.message.role === 'user')?.message.entryId).toBeTruthy();
    await driver.run(meta.id, '你好');
    const before = await driver.hub.open(meta.id);
    const users = before.messages.filter((message) => message.role === 'user');
    expect(users[0].entryId).toBeTruthy();
    expect(users[1].entryId).not.toBe(users[0].entryId);
    const result = await driver.hub.messageAction(meta.id, users[1].entryId!, 'rewind');
    expect(result.draft.text).toBe('你好');
    expect(result.session.messages.filter((message) => message.role === 'user')).toHaveLength(1);
    await driver.hub.archive(meta.id);
    driver.hub.meta(meta.id).archived = false;
    const reopened = await driver.hub.open(meta.id);
    expect(reopened.messages.filter((message) => message.role === 'user')).toHaveLength(1);
    await expect(driver.hub.messageAction(meta.id, users[1].entryId!, 'rewind')).rejects.toThrow(/不在当前对话/);
    const root = await driver.hub.messageAction(meta.id, users[0].entryId!, 'rewind');
    expect(root.session.messages.filter((message) => message.role === 'user')).toHaveLength(0);
    await driver.hub.archive(meta.id);
    driver.hub.meta(meta.id).archived = false;
    expect((await driver.hub.open(meta.id)).messages.filter((message) => message.role === 'user')).toHaveLength(0);
    await driver.run(meta.id, '重新开始');
    expect((await driver.hub.open(meta.id)).messages.filter((message) => message.role === 'user')).toHaveLength(1);
  });

  it('forks into a separate desktop session while retaining the original history', async () => {
    const { meta } = await codeSession();
    await driver.run(meta.id, '第一条消息');
    await driver.run(meta.id, '第二条消息');
    const before = await driver.hub.open(meta.id);
    const users = before.messages.filter((message) => message.role === 'user');
    const forked = await driver.hub.messageAction(meta.id, users[1].entryId!, 'fork');
    expect(forked.session.meta.id).not.toBe(meta.id);
    expect(forked.session.meta.sessionFile).not.toBe(before.meta.sessionFile);
    expect(forked.session.messages.filter((message) => message.role === 'user')).toHaveLength(1);
    expect(forked.draft.text).toBe('第二条消息');
    expect(driver.hub.list().some((session) => session.id === forked.session.meta.id)).toBe(true);
    expect((await driver.hub.open(meta.id)).messages).toEqual(before.messages);
    const rootFork = await driver.hub.messageAction(meta.id, users[0].entryId!, 'fork');
    expect(rootFork.session.messages.filter((message) => message.role === 'user')).toHaveLength(0);
    await driver.run(rootFork.session.meta.id, '新的分支');
    expect((await driver.hub.open(meta.id)).messages).toEqual(before.messages);
  });

  it('names a session from its first prompt, and a rename locks the title', async () => {
    const project = makeProject('naming');
    const meta = await driver.hub.create({ kind: 'code', projectPath: project, worktree: false, model: 'demo/demo-coder', title: 'placeholder', autoName: true });
    await driver.run(meta.id, '日期显示少了一个月 @src/utils/date.js 帮我修一下');
    expect(driver.hub.meta(meta.id).title).toBe('日期显示少了一个月 帮我修一下');
    driver.hub.update(meta.id, { title: 'Dates' });
    expect(driver.hub.meta(meta.id)).toMatchObject({ title: 'Dates', titleLocked: true, autoName: false });
    // A pasted-in paragraph is cut, not stored whole.
    driver.hub.update(meta.id, { title: 'x'.repeat(MAX_SESSION_TITLE + 20) });
    expect(driver.hub.meta(meta.id).title).toHaveLength(MAX_SESSION_TITLE);
  });

  it('skips next-message prediction when only the offline demo model exists', async () => {
    const { meta } = await codeSession();
    await driver.hub.open(meta.id);
    expect(await driver.hub.suggest(meta.id, { model: 'auto', context: 6 })).toBeNull();
    expect(await driver.hub.suggest(meta.id, { model: 'session', context: 'all' })).toBeNull();
    expect(await driver.hub.suggest(meta.id, { model: 'fixed', modelId: 'demo/demo-coder', context: 6 })).toBeNull();
  });

  it('keeps a side chat in the host without touching the session', async () => {
    const { meta } = await codeSession();
    await driver.hub.open(meta.id);
    const before = (await driver.hub.open(meta.id)).messages.length;
    const from = driver.events.length;
    driver.hub.side(meta.id, { text: '刚才为什么这样做？', quote: '一段回复' });
    // The call returns as soon as the question is queued; the answer arrives as events.
    const queued = driver.hub.sideGet(meta.id);
    expect(queued.busy).toBe(true);
    expect(queued.turns[0]).toEqual({ role: 'user', text: '刚才为什么这样做？', quote: '一段回复' });
    await new Promise<void>((resolve) => {
      const t = setInterval(() => {
        if (!driver.hub.sideGet(meta.id).busy) { clearInterval(t); resolve(); }
      }, 10);
    });
    const chat = driver.hub.sideGet(meta.id);
    expect(chat.busy).toBe(false);
    expect(chat.turns[0]).toEqual({ role: 'user', text: '刚才为什么这样做？', quote: '一段回复' });
    expect(chat.turns.length === 2 ? chat.turns[1].role : 'assistant').toBe('assistant');
    expect(chat.turns.length === 2 || !!chat.error).toBe(true);
    const sides = driver.events.slice(from).filter((e) => e.type === 'side');
    expect(sides.length).toBeGreaterThanOrEqual(2);
    expect((await driver.hub.open(meta.id)).messages.length).toBe(before);
    driver.hub.sideStage(meta.id, ' 引用 ');
    expect(driver.hub.sideGet(meta.id).quote).toBe('引用');
    driver.hub.sideReset(meta.id);
    expect(driver.hub.sideGet(meta.id)).toMatchObject({ turns: [], quote: null, busy: false });
  });

  it('uses the worktree folder from settings, and the default when it is unset', async () => {
    const project = makeProject('worktree-root');
    const custom = path.join(tmp, 'custom-worktrees');
    const create = (title: string) =>
      driver.hub.create({ kind: 'code', projectPath: project, worktree: true, model: 'demo/demo-coder', title, autoName: false });
    const settingsFile = path.join(tmp, 'data', 'settings.json');

    const fallback = await create('default root');
    expect(fallback.cwd.startsWith(path.join(tmp, 'data', '.worktree') + path.sep)).toBe(true);

    fs.writeFileSync(settingsFile, JSON.stringify({ worktreeDir: custom }));
    try {
      const configured = await create('configured root');
      expect(configured.cwd.startsWith(custom + path.sep)).toBe(true);
    } finally {
      fs.rmSync(settingsFile, { force: true });
    }
  });
});

describe('work sessions', { timeout: 120_000 }, () => {
  let dir: string;
  beforeEach(() => {
    dir = path.join(tmp, `work-${Math.random().toString(36).slice(2, 8)}`);
    fs.cpSync(path.join(ROOT, 'demo', 'work-workspace'), dir, { recursive: true });
  });
  const work = (projectPath: string | null) =>
    driver.hub.create({ kind: 'work', projectPath, model: 'demo/demo-coder', title: 'task', autoName: false });

  it('organizes the inbox; only moving files asks, even in auto mode', async () => {
    const meta = await work(dir);
    const r = await driver.run(meta.id, '帮我整理收件箱：归类、标记需要回复的邮件，并起草回复', () => ({ value: 'Allow' }));
    const asked = r.ui.filter((u) => u.kind === 'permission').map((u) => u.title);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/mv inbox\/04/);
    expect(fs.existsSync(path.join(dir, '收件箱整理.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'inbox/已归档/04-行业周刊.txt'))).toBe(true);
    expect(r.tools.filter((t) => t.toolName === 'read')).toHaveLength(5);
    expect(r.finalText).toMatch(/收件箱整理好了/);
  });

  it('denying the move leaves the files in place', async () => {
    const meta = await work(dir);
    const r = await driver.run(meta.id, '帮我整理收件箱', () => ({ value: 'Deny' }));
    expect(fs.existsSync(path.join(dir, 'inbox/04-行业周刊.txt'))).toBe(true);
    expect(r.finalText).toMatch(/不执行/);
  });

  it('writes a daily briefing file from the folder contents', async () => {
    const meta = await work(dir);
    // The idea prompt also mentions 邮件; it must still be treated as a briefing.
    const r = await driver.run(meta.id, '每个工作日早上 8 点给我发一份简报：日程、待办和重要邮件');
    expect(r.ui).toHaveLength(0);
    const brief = fs.readdirSync(dir).find((f) => f.startsWith('每日简报-'));
    expect(brief).toBeTruthy();
    expect(read(dir, brief!)).toMatch(/季度预算评审/);
  });

  it('without a folder, works in a fresh temporary workspace', async () => {
    const meta = await work(null);
    expect(meta.scratch).toBe(true);
    expect(meta.cwd.startsWith(path.join(tmp, 'data', 'work'))).toBe(true);
    expect(fs.existsSync(meta.cwd)).toBe(true);
  });
});
