// End-to-end: the agent host's SessionHub running real in-process pi sessions with
// desktop-kit and the offline demo model. No API key and no Electron required.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentSession, ProjectTrustStore } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage, fauxProvider, fauxToolCall, getCurrentTools } from '@earendil-works/pi-ai';
import { applyPiEvent, emptySession, replay } from '../src/renderer/src/store/transcript';
import { decodeUserContent } from '@shared/attachments';
import {
  HOST_CHANNELS,
  MAX_SESSION_TITLE,
  type BashRunResult,
  type HostEvent,
  type PermissionMode,
  type PiEvent,
  type Settings,
  type UiRequest,
  type UiResponse,
} from '@shared/protocol';
import { importAttachments } from '../src/agent/attachments';
import { PLAN_MODE_MARKER } from '../src/agent/desktop-kit';
import * as git from '../src/agent/git';
import { sessionHandlers } from '../src/agent/handlers';
import { SessionHub } from '../src/agent/hub';
import { Store } from '../src/agent/store';
import { setActiveLocale } from '../src/shared/i18n/runtime';

// These assertions read the host's Chinese messages.
setActiveLocale('zh');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-desktop-hub-'));
const agentDir = path.join(tmp, 'agent');
// pi resolves its config (sessions, settings, auth) from here: never touch ~/.pi in tests.
process.env.PI_CODING_AGENT_DIR = agentDir;

function makeProject(name: string, autoCrlf?: boolean) {
  const dir = path.join(tmp, name);
  fs.cpSync(path.join(ROOT, 'demo', 'todo-app'), dir, { recursive: true });
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  if (autoCrlf !== undefined) git('config', 'core.autocrlf', String(autoCrlf));
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
    this.hub = new SessionHub({
      dataDir: path.join(tmp, 'data'),
      agentDir,
      demoModel: true,
      emit: (e) => this.onEvent(e),
    });
  }
  private waiters: { id: string; resolve: () => void }[] = [];
  private onEvent(e: HostEvent) {
    this.events.push(e);
    if (e.type === 'ui_request')
      queueMicrotask(() => this.hub.respond(e.sessionId, e.request.id, this.answer(e.request)));
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
    const ui = events
      .filter((e): e is Extract<HostEvent, { type: 'ui_request' }> => e.type === 'ui_request')
      .map((e) => e.request);
    const tools = pi.filter((e) => e.type === 'tool_execution_end');
    const finalText = pi
      .filter((e) => e.type === 'message_end' && e.message.role === 'assistant')
      .map((e: PiEvent) =>
        e.message.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join(''),
      )
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

const codeSession = async (mode: PermissionMode = 'auto', worktree = false, autoCrlf?: boolean) => {
  const project = makeProject(`proj-${Math.random().toString(36).slice(2, 8)}`, autoCrlf);
  const meta = await driver.hub.create({
    kind: 'code',
    projectPath: project,
    worktree,
    model: 'demo/demo-coder',
    mode,
    title: 'test',
    autoName: false,
  });
  return { project, meta };
};
const read = (dir: string, rel: string) => fs.readFileSync(path.join(dir, rel), 'utf8');

describe('code sessions', { timeout: 120_000 }, () => {
  it('runs the keyboard demo through the question tool and records the completed reply', async () => {
    const { meta } = await codeSession();
    expect(meta.lastResponseAt).toBeUndefined();
    const answers = [{ selected: ['Plain text'] }, { selected: ['Summary (Recommended)', 'Details'] }];
    let lastResponseBeforeAnswer: number | undefined;
    const previousAnswer = driver.answer;
    const turn = await driver
      .run(meta.id, 'keyboard shortcut demo', (request) => {
        lastResponseBeforeAnswer = driver.hub.meta(meta.id).lastResponseAt;
        return request.kind === 'questions' ? { answers } : { cancelled: true };
      })
      .finally(() => {
        driver.answer = previousAnswer;
      });
    expect(lastResponseBeforeAnswer).toBeUndefined();
    expect(turn.ui).toHaveLength(1);
    expect(turn.ui[0]).toMatchObject({
      kind: 'questions',
      questions: [{ header: 'Format' }, { header: 'Sections', multiSelect: true }],
    });
    expect(turn.finalText).toContain('Plain text');
    expect(turn.finalText).toContain('"Summary (Recommended)", "Details"');
    const lastResponseAt = driver.hub.meta(meta.id).lastResponseAt;
    expect(lastResponseAt).toBeGreaterThanOrEqual(meta.createdAt);
    expect(turn.events).toContainEqual(
      expect.objectContaining({ type: 'meta', meta: expect.objectContaining({ lastResponseAt }) }),
    );
  });

  it('writes Code worktree notes to the current Work project, including after a live rebind', async () => {
    const repo = makeProject('linked-memory');
    const faux = fauxProvider({ provider: 'memory-test', models: [{ id: 'm' }] });
    driver.hub.models.registerNativeProvider(faux.provider);
    const meta = await driver.hub.create({
      kind: 'code',
      projectPath: repo,
      model: 'memory-test/m',
      worktree: true,
      title: 'memory',
      mode: 'auto',
    });
    expect(meta.cwd).not.toBe(repo);
    // Background summaries use the same model and could consume the next scripted tool call.
    driver.hub.update(meta.id, { autoUpdateMetadata: false });
    const save = async (note: string) => {
      faux.setResponses([
        fauxAssistantMessage(fauxToolCall('pidesk_remember', { note }), { stopReason: 'toolUse' }),
        fauxAssistantMessage('Saved'),
      ]);
      const turn = await driver.run(meta.id, 'Save the project decision');
      expect(turn.tools).toContainEqual(expect.objectContaining({ toolName: 'pidesk_remember', isError: false }));
    };
    await save('Use UTC');
    const book = driver.hub.projects;
    const old = book.owner(repo)!;
    expect(old.memory).toBe('- Use UTC');
    const next = book.addWorkFolder(fs.mkdtempSync(path.join(tmp, 'project-notes-')));
    book.updateWorkFolder(next.path, { codeFolders: [repo] });
    await save('Use ISO dates');
    expect(book.owner(repo)?.memory).toBe('- Use ISO dates');
    expect(book.workFolders().find((p) => p.path === old.path)?.memory).toBe('- Use UTC');
  });

  it('continues an unfinished /goal, pre-arms only CI, and restores the verified result', async () => {
    const project = makeProject('goal-ci');
    const faux = fauxProvider({ provider: 'goal-test', models: [{ id: 'm' }] });
    faux.setResponses([
      fauxAssistantMessage('Next I will enable the requested watch.'),
      fauxAssistantMessage(fauxToolCall('pidesk_set_ci_watch', { enabled: true }), { stopReason: 'toolUse' }),
      fauxAssistantMessage(
        fauxToolCall('pidesk_goal_result', { status: 'complete', reason: 'CI watch enabled before PR creation' }),
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('Done'),
    ]);
    driver.hub.models.registerNativeProvider(faux.provider);
    const { id } = await driver.hub.create({
      kind: 'code',
      projectPath: project,
      model: 'goal-test/m',
      mode: 'auto',
      title: 'goal-ci',
      autoName: false,
    });
    expect(await driver.hub.commands(id)).toContainEqual(expect.objectContaining({ name: 'goal' }));
    const cmd = (text: string) => driver.hub.prompt(id, { text, attachments: [] }, 'steer');
    await cmd('/goal Enable CI handling before opening my PR');
    await vi.waitFor(
      () =>
        expect(driver.events).toContainEqual(
          expect.objectContaining({
            type: 'pi',
            sessionId: id,
            event: expect.objectContaining({ type: 'agent_settled' }),
          }),
        ),
      { timeout: 10000 },
    );
    expect(driver.hub.meta(id)).toMatchObject({ pr: null, autoFixCi: true, agentArmedCi: true });
    expect(driver.hub.meta(id).autoMerge).toBeFalsy();
    await driver.hub.archive(id);
    driver.hub.unarchive(id);
    await cmd('/goal');
    expect(driver.events).toContainEqual(
      expect.objectContaining({
        type: 'notify',
        sessionId: id,
        message: expect.stringContaining('CI watch enabled before PR creation'),
      }),
    );
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('pidesk_set_ci_watch', { enabled: false }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('Watch disabled'),
    ]);
    const disabled = await driver.run(id, 'Disable CI handling');
    expect(disabled.tools).toContainEqual(expect.objectContaining({ toolName: 'pidesk_set_ci_watch', isError: false }));
    expect(driver.hub.meta(id).autoFixCi).toBe(false);
    expect(driver.hub.meta(id).agentArmedCi).toBeUndefined();
  });

  it('rejects /goal attachments without starting a goal', async () => {
    const { meta, project } = await codeSession();
    const { attachments } = await importAttachments([{ path: path.join(project, 'src/utils/date.js') }]);
    expect(attachments).toHaveLength(1);
    await expect(driver.hub.prompt(meta.id, { text: '/goal fix the tests', attachments }, 'steer')).rejects.toThrow(
      /附件/,
    );
    expect(await driver.hub.prompt(meta.id, '/goal', 'steer')).toEqual({ disposition: 'handled' });
    expect(driver.events).toContainEqual(
      expect.objectContaining({ type: 'notify', sessionId: meta.id, message: expect.stringContaining('当前没有目标') }),
    );
  });

  it('only lets the user arm auto-merge', async () => {
    const { meta } = await codeSession();
    const patch = { prAuto: { merge: true } };
    driver.hub.update(meta.id, patch, 'agent');
    expect(driver.hub.meta(meta.id).autoMerge).toBeFalsy();
    driver.hub.update(meta.id, patch, 'user');
    expect(driver.hub.meta(meta.id).autoMerge).toBe(true);
  });

  it.each(['agent', 'user'] as const)('honors the %s permission grant on a real CI event', async (source) => {
    const project = makeProject('ci-watch-' + source);
    const provider = 'ci-watch-' + source;
    const faux = fauxProvider({ provider, models: [{ id: 'm' }] });
    // A harmless git invocation not in the read-only allowlist: manual arming allows it,
    // while agent arming must go through the normal default-mode approval.
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('bash', { command: 'git --version' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('Done'),
    ]);
    driver.hub.models.registerNativeProvider(faux.provider);
    const { id } = await driver.hub.create({
      kind: 'code',
      projectPath: project,
      worktree: false,
      model: provider + '/m',
      mode: 'default',
      title: 'CI event',
      autoName: false,
    });
    const snapshot: git.PrSnapshot = {
      notes: [],
      status: {
        num: 4,
        url: 'https://example.org/pull/4',
        state: 'open',
        draft: false,
        head: 'abc',
        ci: 'fail',
        checks: [],
        comments: 0,
      },
    };
    const read = git.readPr;
    const lookup = vi
      .spyOn(git, 'readPr')
      .mockImplementation(async (cwd) => (path.resolve(cwd) === path.resolve(project) ? snapshot : read(cwd)));
    try {
      driver.hub.update(id, { prAuto: { fixCi: true } }, source);
      await driver.hub.open(id);
      await vi.waitFor(
        () =>
          expect(driver.events).toContainEqual(
            expect.objectContaining({
              type: 'pi',
              sessionId: id,
              event: expect.objectContaining({ type: 'agent_settled' }),
            }),
          ),
        { timeout: 10000 },
      );
      const events = driver.events.filter((e) => 'sessionId' in e && e.sessionId === id);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'pi',
          event: expect.objectContaining({ type: 'tool_execution_end', toolName: 'bash' }),
        }),
      );
      const approvals = events.filter((e) => e.type === 'ui_request' && e.request.kind === 'permission');
      expect(approvals).toHaveLength(source === 'agent' ? 1 : 0);
      expect(driver.hub.meta(id).prAutoDone?.fix).toBe('4:abc');
      // Even after a manually armed watcher, its one-turn permission must not leak into normal conversation.
      faux.setResponses([
        fauxAssistantMessage(fauxToolCall('bash', { command: 'git --version' }), { stopReason: 'toolUse' }),
        fauxAssistantMessage('Done'),
      ]);
      const userTurn = await driver.run(id, 'Check the git version');
      expect(userTurn.ui).toContainEqual(expect.objectContaining({ kind: 'permission', title: 'Run git --version' }));
    } finally {
      lookup.mockRestore();
      await driver.hub.archive(id);
    }
  });

  it('lists the offline demo model and its thinking levels', async () => {
    const { models } = await driver.hub.listModels();
    expect(models.some((m) => m.provider === 'demo' && m.id === 'demo-coder')).toBe(true);
    expect(driver.hub.thinkingLevels('demo/demo-coder').length).toBeGreaterThan(1);
  });

  it('keeps Diff comparisons separate from the session base and PR target', async () => {
    const { project, meta } = await codeSession();
    const before = { branch: meta.branch, baseBranch: meta.baseBranch, baseCommit: meta.baseCommit };
    execFileSync('git', ['branch', 'diff-only-base'], { cwd: project, stdio: 'pipe' });
    fs.writeFileSync(path.join(project, 'diff-only.txt'), 'one\n');
    const from = driver.events.length;
    const result = await driver.hub.diff(meta.id, { kind: 'branch', ref: 'diff-only-base' });
    expect(result.files.map((f) => f.path)).toContain('diff-only.txt');
    expect(await driver.hub.changeContent(meta.id, 'diff-only.txt', null, result.base)).toEqual({
      before: null,
      after: 'one\n',
      binary: false,
    });
    await driver.hub.diff(meta.id, { kind: 'lastCommit' });
    expect({ branch: meta.branch, baseBranch: meta.baseBranch, baseCommit: meta.baseCommit }).toEqual(before);
    expect(driver.events.slice(from).filter((e) => e.type === 'meta')).toEqual([]);
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

  it('reloads skills, prompts and extensions without replacing the conversation', async () => {
    const { project, meta } = await codeSession();
    await driver.run(meta.id, '你好');
    const before = await driver.hub.open(meta.id);
    const root = path.join(project, '.pi');
    const skill = path.join(root, 'skills', 'reload-test', 'SKILL.md');
    const prompt = path.join(root, 'prompts', 'reload-test.md');
    const extension = path.join(root, 'extensions', 'reload-test.ts');
    for (const file of [skill, prompt, extension]) fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(skill, '---\nname: reload-test\ndescription: Reloaded skill\n---\nUse this skill.\n');
    fs.writeFileSync(prompt, '---\ndescription: Reloaded prompt\n---\nReply briefly.\n');
    fs.writeFileSync(
      extension,
      `export default (pi) => {
      pi.registerCommand('reload-test-ping', {
        description: 'Reloaded extension',
        handler: async (_, ctx) => ctx.ui.notify('reload-pong', 'info'),
      });
      pi.registerCommand('reload-test-again', {
        handler: async (_, ctx) => { await ctx.reload(); },
      });
    };`,
    );
    expect((await driver.hub.commands(meta.id)).some((c) => c.name === 'skill:reload-test')).toBe(false);
    const from = driver.events.length;
    const handlers = sessionHandlers(Promise.resolve(driver.hub), () => null);
    await handlers['sessions:reload'](meta.id);
    const after = await driver.hub.open(meta.id);
    expect(after.messages).toEqual(before.messages);
    expect(after.meta.sessionFile).toBe(before.meta.sessionFile);
    expect(after.meta.id).toBe(before.meta.id);
    expect(after.model).toBe(before.model);
    expect(after.thinking).toBe(before.thinking);
    expect(after.meta.mode).toBe(before.meta.mode);
    expect(await driver.hub.commands(meta.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'skill:reload-test', description: 'Reloaded skill' }),
        expect.objectContaining({ name: 'reload-test', source: 'prompt' }),
        expect.objectContaining({ name: 'reload-test-ping', source: 'extension' }),
      ]),
    );
    expect(driver.hub.context(meta.id)!.items.some((item) => item.name === 'reload-test')).toBe(true);
    expect(driver.events.slice(from).filter((e) => e.type === 'changed')).toEqual([
      { type: 'changed', resource: 'sessionResources' },
    ]);
    const ping = await driver.run(meta.id, '/reload-test-ping');
    expect(ping.events).toContainEqual(expect.objectContaining({ type: 'notify', message: 'reload-pong' }));

    // Commands that call ctx.reload share the same desktop path, including change notifications.
    fs.writeFileSync(skill, '---\nname: reload-test\ndescription: Updated skill\n---\nUpdated body.\n');
    await driver.run(meta.id, '/reload-test-again');
    expect(await driver.hub.commands(meta.id)).toContainEqual(
      expect.objectContaining({
        name: 'skill:reload-test',
        description: 'Updated skill',
      }),
    );
    fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({ skills: [`-${skill}`] }));
    fs.rmSync(prompt);
    fs.rmSync(extension);
    expect(await driver.hub.prompt(meta.id, { text: '/reload', attachments: [] }, 'steer')).toEqual({
      disposition: 'handled',
    });
    expect((await driver.hub.commands(meta.id)).some((c) => c.name.includes('reload-test'))).toBe(false);
    expect((await driver.hub.open(meta.id)).messages).toEqual(before.messages);
    // The session subscription and desktop shell still work after repeated reloads.
    expect((await driver.hub.bash(meta.id, 'echo after-reload')).output.trim()).toBe('after-reload');
    await driver.run(meta.id, '你好');
  });

  it('reloads MCP configuration in an existing session, including disabling a server', async () => {
    const server = createServer(async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }
      let text = '';
      for await (const chunk of req) text += chunk;
      const request = JSON.parse(text);
      if (request.id === undefined) {
        res.writeHead(202).end();
        return;
      }
      const result =
        request.method === 'initialize'
          ? {
              protocolVersion: request.params.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: 'reload-test', version: '1.0.0' },
            }
          : request.method === 'tools/list'
            ? {
                tools: [
                  { name: 'probe', description: 'Reload probe', inputSchema: { type: 'object', properties: {} } },
                ],
              }
            : { content: [{ type: 'text', text: 'reload-probe-ok' }] };
      res
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
    const { project, meta } = await codeSession();
    try {
      await driver.hub.open(meta.id);
      const config = path.join(project, '.pi', 'mcp.json');
      fs.mkdirSync(path.dirname(config), { recursive: true });
      const connector = { url: `http://127.0.0.1:${address.port}/mcp`, exposure: 'direct' };
      fs.writeFileSync(config, JSON.stringify({ mcpServers: { reload_test: connector } }));
      await driver.hub.reload(meta.id);
      // Direct MCP tools are connected before the next model request.
      await driver.run(meta.id, '你好');
      expect(driver.hub.context(meta.id)!.items.some((item) => item.name === 'mcp__reload_test__probe')).toBe(true);
      fs.writeFileSync(config, JSON.stringify({ mcpServers: { reload_test: { ...connector, enabled: false } } }));
      await driver.hub.reload(meta.id);
      await driver.run(meta.id, '你好');
      expect(driver.hub.context(meta.id)!.items.some((item) => item.name === 'mcp__reload_test__probe')).toBe(false);
    } finally {
      await driver.hub.archive(meta.id);
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it('guards reload against running work and concurrent session updates, and unlocks after failure', async () => {
    const { meta } = await codeSession();
    await driver.hub.open(meta.id);
    const reload = vi.spyOn(AgentSession.prototype, 'reload');
    const bashRunning = vi.spyOn(AgentSession.prototype, 'isBashRunning', 'get').mockReturnValue(true);
    try {
      await expect(driver.hub.reload(meta.id)).rejects.toThrow(/任务和命令/);
      expect(reload).not.toHaveBeenCalled();
    } finally {
      bashRunning.mockRestore();
    }
    const idle = vi.spyOn(AgentSession.prototype, 'isIdle', 'get').mockReturnValue(false);
    try {
      await expect(driver.hub.reload(meta.id)).rejects.toThrow(/任务和命令/);
      expect(reload).not.toHaveBeenCalled();
    } finally {
      idle.mockRestore();
    }
    const retrying = vi.spyOn(AgentSession.prototype, 'isRetrying', 'get').mockReturnValue(true);
    try {
      await expect(driver.hub.reload(meta.id)).rejects.toThrow(/任务和命令/);
      expect(reload).not.toHaveBeenCalled();
    } finally {
      retrying.mockRestore();
    }
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    reload.mockImplementationOnce(async () => {
      entered();
      await gate;
    });
    // Prompt validation yields after its first busy check; reloading must catch that in-flight prompt too.
    const earlyPrompt = driver.hub.prompt(meta.id, { text: '你好' }, 'steer');
    const loading = driver.hub.reload(meta.id);
    await started;
    try {
      await expect(earlyPrompt).rejects.toThrow(/正在更新会话/);
      expect(await driver.hub.suggest(meta.id, { model: 'session', context: 6 })).toBeNull();
      await expect(driver.hub.reload(meta.id)).rejects.toThrow(/任务和命令/);
      await expect(driver.hub.prompt(meta.id, { text: '你好' }, 'steer')).rejects.toThrow(/正在更新会话/);
      await expect(driver.hub.bash(meta.id, 'echo no')).rejects.toThrow(/正在更新会话/);
      await expect(driver.hub.newContext(meta.id)).rejects.toThrow(/正在更新会话/);
      await expect(driver.hub.compact(meta.id)).rejects.toThrow(/正在更新会话/);
    } finally {
      release();
      await loading;
    }
    const from = driver.events.length;
    reload.mockRejectedValueOnce(new Error('reload failed'));
    try {
      await expect(driver.hub.reload(meta.id)).rejects.toThrow('reload failed');
      expect(driver.events.slice(from).some((e) => e.type === 'changed')).toBe(false);
    } finally {
      reload.mockRestore();
    }
    await driver.hub.reload(meta.id);
    expect((await driver.hub.bash(meta.id, 'echo unlocked')).output.trim()).toBe('unlocked');
  });

  it.each([false, true])('waits for reload before disposing, even when reload fails: %s', async (fails) => {
    const { meta } = await codeSession();
    await driver.hub.open(meta.id);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const reload = vi.spyOn(AgentSession.prototype, 'reload').mockImplementationOnce(async () => {
      entered();
      await gate;
      if (fails) throw new Error('reload during close failed');
    });
    const dispose = vi.spyOn(AgentSession.prototype, 'dispose');
    const loading = driver.hub.reload(meta.id);
    const result = loading.catch((error: Error) => error);
    await started;
    const from = driver.events.length;
    const closing = driver.hub.archive(meta.id);
    try {
      await vi.waitFor(() => expect(driver.hub.sessionState(meta.id)).toBeNull());
      expect(dispose).not.toHaveBeenCalled();
    } finally {
      release();
      try {
        const [failure] = await Promise.all([result, closing]);
        expect(failure).toEqual(fails ? new Error('reload during close failed') : undefined);
        expect(dispose).toHaveBeenCalledOnce();
      } finally {
        reload.mockRestore();
        dispose.mockRestore();
      }
    }
    expect(driver.hub.meta(meta.id).archived).toBe(true);
    expect(driver.events.slice(from).some((e) => e.type === 'changed' || e.type === 'notify')).toBe(false);
  });

  it.each([false, true])('auto mode: fixes the bug end to end (core.autocrlf=%s)', async (autoCrlf) => {
    const { project, meta } = await codeSession('auto', true, autoCrlf);
    expect(meta.branch).toMatch(/^pi-desktop\//);
    expect(meta.cwd).not.toBe(project);
    expect(meta.cwd.startsWith(path.join(tmp, 'data', '.worktree') + path.sep), 'default worktree root').toBe(true);
    const opened = await driver.hub.open(meta.id);
    expect(opened.model).toBe('demo/demo-coder');
    const originals = new Map<string, string>(
      ['src/utils/date.js', 'tests/date.test.js'].map((file) => [file, read(meta.cwd, file)]),
    );
    // A worktree checkout can have different line endings from the copied source fixture.
    expect(originals.get('src/utils/date.js')!.includes('\r\n')).toBe(autoCrlf);

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
    expect(driver.hub.meta(meta.id).lastResponseAt).toBeGreaterThanOrEqual(meta.createdAt);
    expect(r.events).toContainEqual(
      expect.objectContaining({
        type: 'meta',
        meta: expect.objectContaining({ lastResponseAt: expect.any(Number) }),
      }),
    );

    const { files, state } = await driver.hub.changes(meta.id);
    expect(files.map((c) => c.path).sort()).toEqual(['src/utils/date.js', 'tests/date.test.js']);
    // The worktree starts clean but the agent left the edits uncommitted.
    expect(state.dirty.sort()).toEqual(['src/utils/date.js', 'tests/date.test.js']);
    expect(state.ahead).toBe(0);
    const status = r.events.filter((e) => e.type === 'status').map((e) => (e as any).status);
    expect(status).toEqual(['running', 'idle']);

    const turn = await driver.hub.diff(meta.id, { kind: 'lastTurn' });
    expect(turn.files.map((file) => file.path).sort()).toEqual(['src/utils/date.js', 'tests/date.test.js']);
    for (const file of turn.files)
      expect(file).toMatchObject({
        before: originals.get(file.path),
        after: read(meta.cwd, file.path),
        binary: false,
      });
    // A later read-only turn must not reuse the previous turn's edits.
    await driver.run(meta.id, '运行 codemode 脚本');
    expect((await driver.hub.diff(meta.id, { kind: 'lastTurn' })).files).toEqual([]);
    const beforeNextTurn = read(meta.cwd, 'src/utils/date.js');
    await driver.run(meta.id, '修复 isOverdue');
    const nextTurn = await driver.hub.diff(meta.id, { kind: 'lastTurn' });
    expect(nextTurn.files).toHaveLength(1);
    expect(nextTurn.files[0]).toMatchObject({
      path: 'src/utils/date.js',
      before: beforeNextTurn,
      after: read(meta.cwd, 'src/utils/date.js'),
    });
  });

  it('ask mode: edits and commands ask; deny stops the run', async () => {
    const { meta } = await codeSession('default');
    const r = await driver.run(meta.id, '日期显示少了一个月，帮我修一下', (req) =>
      req.title.includes('Run npm test') ? { value: 'Allow' } : { value: 'Deny' },
    );
    const perms = r.ui.filter((u) => u.kind === 'permission');
    expect(perms.some((u) => /Run npm test/.test(u.title))).toBe(true);
    const edit = perms.find((u) => /Edit src\/utils\/date.js/.test(u.title)) as Extract<
      UiRequest,
      { kind: 'permission' }
    >;
    expect(edit).toBeTruthy();
    expect(
      r.pi.some((e) => e.type === 'tool_execution_start' && e.toolCallId === edit.toolCallId),
      'request names its tool call',
    ).toBe(true);
    expect(r.finalText).toMatch(/不执行/);
    expect(read(meta.cwd, 'src/utils/date.js')).not.toMatch(/\+ 1/);
  });

  it('plan mode: blocks edits until the plan is approved, then auto-accepts edits', async () => {
    const { meta } = await codeSession('plan');
    const r = await driver.run(meta.id, '添加深色模式', (req) =>
      req.kind === 'plan' ? { value: 'Approve & auto-accept edits' } : { value: 'Allow' },
    );
    expect(r.ui.some((u) => u.kind === 'plan')).toBe(true);
    const metas = r.events.filter((e) => e.type === 'meta').map((e) => (e as any).meta.mode);
    expect(metas.at(-1)).toBe('acceptEdits');
    expect(driver.hub.meta(meta.id).mode).toBe('acceptEdits');
    expect(fs.existsSync(path.join(meta.cwd, 'src/components/ThemeToggle.jsx'))).toBe(true);
    const perms = r.ui.filter((u) => u.kind === 'permission').map((u) => u.title);
    expect(
      perms.some((t) => /Create|Edit/.test(t)),
      'no edit prompts after approval',
    ).toBe(false);
    expect(
      perms.some((t) => /Run npm run build/.test(t)),
      'commands still ask in acceptEdits',
    ).toBe(true);
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
    assert.equal(task.isError, false, JSON.stringify(task.result).slice(0, 400));
    expect(task.result.details.text).toMatch(/数据流/);
    expect(task.result.details.stats.reads).toBeGreaterThanOrEqual(2);
    expect(
      r.pi.some((e) => e.type === 'tool_execution_update' && e.toolName === 'pidesk_task'),
      'progress updates',
    ).toBe(true);
  });

  it('subagent: a background planner returns its report without entering plan approval', async () => {
    const parent = fauxProvider({ provider: 'delegate-test', models: [{ id: 'm' }] });
    const child = fauxProvider({ provider: 'planner-test', models: [{ id: 'm' }] });
    const approvalTool = 'pidesk_exit_plan_mode';
    const question = 'Which date should the helper use?';
    const choice = 'UTC date (Recommended)';
    const report = '1. Update the helper to use the UTC date. 2. Verify with date tests.';
    parent.setResponses([
      fauxAssistantMessage(
        fauxToolCall('pidesk_task', {
          description: 'Plan date helper changes',
          prompt: 'Return a plan for the date helper change.',
          subagent_type: 'test-planner',
          run_in_background: true,
        }),
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('Delegated.'),
      fauxAssistantMessage('Received the report.'),
    ]);
    let childTools: string[] = [];
    let childSawApprovalPrompt = false;
    child.setResponses([
      ({ messages }) => {
        childTools = getCurrentTools(messages).map((tool) => tool.name);
        childSawApprovalPrompt = JSON.stringify(messages).includes(PLAN_MODE_MARKER);
        // On the old path the model would follow this instruction, then the cancelled approval
        // would terminate the run without an assistant text response.
        return childSawApprovalPrompt
          ? fauxAssistantMessage(fauxToolCall(approvalTool, { title: 'Date helper', plan: report }), {
              stopReason: 'toolUse',
            })
          : fauxAssistantMessage(
              fauxToolCall('pidesk_ask_question', {
                questions: [{ question, header: 'Date', options: [{ label: choice }, { label: 'Local date' }] }],
              }),
              { stopReason: 'toolUse' },
            );
      },
      ({ messages }) => {
        const answered = messages.some(
          (message) =>
            message.role === 'toolResult' &&
            message.toolName === 'pidesk_ask_question' &&
            message.content.some((block) => block.type === 'text' && block.text.includes(`→ "${choice}"`)),
        );
        return fauxAssistantMessage(answered ? report : 'No answer reached the subagent.');
      },
    ]);
    driver.hub.models.registerNativeProvider(parent.provider);
    driver.hub.models.registerNativeProvider(child.provider);
    driver.hub.saveAgent({
      name: 'test-planner',
      description: 'Read-only planner',
      body: 'Return an implementation plan to the caller.',
      model: 'planner-test/m',
    });
    const { id } = await driver.hub.create({
      kind: 'code',
      projectPath: makeProject('subagent-plan'),
      model: 'delegate-test/m',
      mode: 'plan',
      title: 'Subagent plan',
      autoName: false,
    });
    const answer = vi.fn<Answer>((request) =>
      request.kind === 'questions' ? { answers: [{ selected: [choice] }] } : { cancelled: true },
    );
    const result = await driver.run(id, 'Delegate the plan.', answer);
    expect(result.tools.find((tool) => tool.toolName === 'pidesk_task')?.isError).toBe(false);
    const finished = await vi.waitFor(
      () => {
        const event = driver.events.find(
          (e) => e.type === 'task' && e.sessionId === id && e.update.state !== 'running',
        );
        assert.ok(event, 'background planner reached a terminal state');
        return event;
      },
      { timeout: 10000 },
    );
    expect(finished).toMatchObject({ update: { state: 'done', text: report } });
    expect(childSawApprovalPrompt).toBe(false);
    expect(childTools).not.toContain(approvalTool);
    expect(childTools).toContain('pidesk_ask_question');
    expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: 'questions', title: question }));
    expect(driver.hub.meta(id).mode).toBe('plan');
  });

  it('auto mode sends non-read-only commands through review (git push)', async () => {
    const { meta } = await codeSession();
    const r = await driver.run(meta.id, '提交并创建 PR');
    const asked = r.ui.filter((u) => u.kind === 'permission').map((u) => u.title);
    // The offline demo reviewer allows the task-aware review; the push then reaches git and fails
    // for the expected reason because this test repository has no remote.
    expect(asked.some((t) => /git push/.test(t))).toBe(false);
    expect(asked.some((t) => /git status/.test(t))).toBe(false);
    expect(r.finalText).toMatch(/推送失败/);
  });

  it('resumes from the session file with tool details and image attachments', async () => {
    const { meta } = await codeSession();
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
      'base64',
    );
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
        if (
          driver.events
            .slice(before)
            .some((e) => e.type === 'pi' && e.sessionId === meta.id && e.event.type === 'agent_settled')
        ) {
          clearInterval(t);
          resolve();
        }
      }, 50);
    });

    await driver.hub.archive(meta.id); // disposes the live session
    const m = driver.hub.meta(meta.id);
    m.archived = false; // reopen from disk
    const reopened = await driver.hub.open(meta.id);
    const edit = reopened.messages.find((x) => x.role === 'toolResult' && x.toolName === 'edit');
    expect(edit?.details?.diff).toMatch(/padStart/);
    const user = reopened.messages
      .filter((x) => x.role === 'user')
      .map((x) => decodeUserContent(x.content))
      .find((u) => u.clientId === 'img-1');
    expect(user?.text).toBe('look');
    expect(user?.attachments[0]).toMatchObject({ kind: 'image', name: 'pixel.png' });
    expect((user?.attachments[0] as any)?.data).toBeTruthy();
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
    expect(
      firstRun.pi.find((event) => event.type === 'message_end' && event.message.role === 'user')?.message.entryId,
    ).toBeTruthy();
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

  it('rewinds a message and restores the file changes made after it', async () => {
    const { project, meta } = await codeSession();
    const before = read(project, 'src/utils/date.js');
    await driver.run(meta.id, '日期显示少了一个月，帮我修一下');
    expect(read(project, 'src/utils/date.js')).not.toBe(before);
    const opened = await driver.hub.open(meta.id);
    const user = opened.messages.find((message) => message.role === 'user');
    expect(user?.entryId).toBeTruthy();
    const result = await driver.hub.messageAction(meta.id, user!.entryId!, 'rewind');
    expect(read(project, 'src/utils/date.js')).toBe(before);
    expect(result.session.messages.filter((message) => message.role === 'user')).toHaveLength(0);
  });

  it('keeps user-facing tools top-level even in codemode-only sessions', async () => {
    const project = fs.mkdtempSync(path.join(tmp, 'visible-tools-'));
    fs.mkdirSync(path.join(project, '.pi'));
    fs.writeFileSync(
      path.join(project, '.pi/settings.json'),
      JSON.stringify({
        defaultTools: ['+codemode'],
        codemode: { mode: 'only' },
      }),
    );
    new ProjectTrustStore(agentDir).set(project, true);
    const faux = fauxProvider({ provider: 'visible-tools', models: [{ id: 'm' }] });
    const uiTools = [
      'pidesk_todo_write',
      'pidesk_exit_plan_mode',
      'pidesk_ask_question',
      'pidesk_suggest_task',
      'pidesk_create_session',
      'pidesk_send_message',
      'pidesk_task',
      'pidesk_bg_shell',
    ];
    const first = [{ content: 'Inspect', status: 'in_progress' }];
    const last = [{ content: 'Inspect', status: 'completed' }];
    const call = (name: string, args: Record<string, any>) =>
      fauxAssistantMessage(fauxToolCall(name, args), { stopReason: 'toolUse' });
    let declared: string[] = [];
    faux.setResponses([
      ({ messages }) => {
        declared = getCurrentTools(messages).map((tool) => tool.name);
        return call('pidesk_todo_write', { todos: first });
      },
      call('codemode', {
        code: `const names = ALL_TOOLS.map(t => t.name);
        if (!names.includes('read') || ${JSON.stringify(uiTools)}.some(n => names.includes(n))) throw Error('wrong callable tools');
        return 'verified';`,
      }),
      call('pidesk_todo_write', { todos: last }),
      fauxAssistantMessage('Done'),
    ]);
    driver.hub.models.registerNativeProvider(faux.provider);
    const meta = await driver.hub.create({
      kind: 'code',
      projectPath: project,
      model: 'visible-tools/m',
      mode: 'bypass',
      title: 'Visible tools',
      autoName: false,
    });
    const { pi, tools } = await driver.run(meta.id, 'Track progress');
    expect(declared).toEqual(expect.arrayContaining(['codemode', ...uiTools]));
    expect(declared).not.toContain('read');
    expect(tools.filter((e) => e.isError).map((e) => e.result?.content)).toEqual([]);
    expect(tools.map((e) => [e.toolName, e.isError])).toEqual([
      ['pidesk_todo_write', false],
      ['codemode', false],
      ['pidesk_todo_write', false],
    ]);
    const live = emptySession(meta);
    for (const event of pi) applyPiEvent(live, event, 'normal');
    const history = emptySession(meta);
    replay(history, (await driver.hub.open(meta.id)).messages, 'normal');
    for (const s of [live, history]) {
      expect(
        s.items
          .filter((i) => i.kind === 'todos' || i.kind === 'group')
          .map((i) => (i.kind === 'todos' ? i.items : i.tools.map((t) => t.name))),
      ).toEqual([first, ['codemode'], last]);
      expect(s.lastTodos).toEqual(last);
    }
  });

  it('tracks real codemode edits live and on replay, and rewinds only the successful local writes', async () => {
    const project = fs.mkdtempSync(path.join(tmp, 'nested-'));
    const outside = path.join(tmp, 'published.txt');
    fs.mkdirSync(path.join(project, '.pi'));
    fs.writeFileSync(path.join(project, '.pi', 'settings.json'), JSON.stringify({ defaultTools: ['+codemode'] }));
    new ProjectTrustStore(agentDir).set(project, true);
    fs.writeFileSync(path.join(project, 'original.txt'), 'original');
    const script = [
      "await tools.read({ path: 'original.txt' });",
      "await tools.edit({ path: 'original.txt', edits: [{ oldText: 'original', newText: 'edited' }] });",
      "await Promise.all(['one', 'two'].map(content => tools.write({ path: 'overlap.txt', content })));",
      "await tools.write({ content: 'x'.repeat(10000), path: 'large.txt' });",
      `await tools.write({ path: ${JSON.stringify(outside)}, content: 'outside' });`,
      "await tools.edit({ path: 'missing.txt', edits: [{ oldText: 'a', newText: 'b' }] });",
    ].join('\n');
    const faux = fauxProvider({ provider: 'nested-test', models: [{ id: 'm' }] });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('codemode', { code: script }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('Done'),
    ]);
    driver.hub.models.registerNativeProvider(faux.provider);
    const meta = await driver.hub.create({
      kind: 'code',
      projectPath: project,
      model: 'nested-test/m',
      mode: 'bypass',
      title: 'nested files',
    });
    const { pi, tools } = await driver.run(meta.id, 'Run the script');
    expect(tools.find((e) => e.toolName === 'codemode')).toMatchObject({ isError: true });
    const live = emptySession(meta);
    for (const event of pi) applyPiEvent(live, event, 'normal');
    const summary = (s: typeof live) => s.outputs.map(({ path, kind }) => ({ path, kind }));
    expect(summary(live)).toEqual([
      { path: 'original.txt', kind: 'edit' },
      { path: 'overlap.txt', kind: 'write' },
      { path: 'large.txt', kind: 'write' },
      { path: outside.replace(/\\/g, '/'), kind: 'write' },
    ]);
    expect(live.turnChanges.find((c) => c.path === 'original.txt')).toMatchObject({
      before: 'original',
      after: 'edited',
    });
    expect(live.items.flatMap((i) => (i.kind === 'group' ? i.tools.map((t) => t.name) : []))).toEqual(['codemode']);
    await driver.hub.archive(meta.id);
    driver.hub.meta(meta.id).archived = false;
    const reopened = await driver.hub.open(meta.id);
    const view = emptySession(meta);
    replay(view, reopened.messages, 'normal');
    expect(summary(view)).toEqual(summary(live));
    expect(view.sessionChanges.map((c) => c.after)).toEqual(live.sessionChanges.map((c) => c.after));
    expect((await driver.hub.diff(meta.id, { kind: 'lastTurn' })).files.map((f) => f.path)).toEqual([
      'large.txt',
      'original.txt',
      'overlap.txt',
    ]);
    expect(await driver.hub.readFile(meta.id, outside)).toBe('outside');
    const user = reopened.messages.find((m) => m.role === 'user')!;
    fs.writeFileSync(path.join(project, 'original.txt'), 'manual edit');
    await expect(driver.hub.messageAction(meta.id, user.entryId!, 'rewind')).rejects.toThrow(/file changed/);
    expect(read(project, 'original.txt')).toBe('manual edit');
    expect(fs.existsSync(path.join(project, 'large.txt'))).toBe(true);
    fs.writeFileSync(path.join(project, 'original.txt'), 'edited');
    const result = await driver.hub.messageAction(meta.id, user.entryId!, 'rewind');
    await expect(driver.hub.readFile(meta.id, outside)).rejects.toThrow(/outside the session/);
    expect(read(project, 'original.txt')).toBe('original');
    expect(fs.existsSync(path.join(project, 'large.txt'))).toBe(false);
    expect(fs.existsSync(path.join(project, 'overlap.txt'))).toBe(false);
    expect(fs.readFileSync(outside, 'utf8')).toBe('outside');
    replay(view, result.session.messages, 'normal');
    expect(view.outputs).toEqual([]);
  });

  it('rewinds a message and removes files created by write tools', async () => {
    const { project, meta } = await codeSession('bypass');
    const created = path.join(project, 'src/components/ThemeToggle.jsx');
    expect(fs.existsSync(created)).toBe(false);
    await driver.run(meta.id, '添加深色模式');
    expect(fs.existsSync(created)).toBe(true);
    const opened = await driver.hub.open(meta.id);
    const user = opened.messages.find((message) => message.role === 'user');
    expect(user?.entryId).toBeTruthy();
    await driver.hub.messageAction(meta.id, user!.entryId!, 'rewind');
    expect(fs.existsSync(created)).toBe(false);
  });

  it('names a session from its first prompt, and a rename locks the title', async () => {
    const project = makeProject('naming');
    const meta = await driver.hub.create({
      kind: 'code',
      projectPath: project,
      worktree: false,
      model: 'demo/demo-coder',
      title: 'placeholder',
      autoName: true,
    });
    await driver.run(meta.id, '日期显示少了一个月 @src/utils/date.js 帮我修一下');
    expect(driver.hub.meta(meta.id).title).toBe('日期显示少了一个月 帮我修一下');
    driver.hub.update(meta.id, { title: 'Dates' });
    expect(driver.hub.meta(meta.id)).toMatchObject({ title: 'Dates', titleLocked: true, autoName: false });
    // A pasted-in paragraph is cut, not stored whole.
    driver.hub.update(meta.id, { title: 'x'.repeat(MAX_SESSION_TITLE + 20) });
    expect(driver.hub.meta(meta.id).title).toHaveLength(MAX_SESSION_TITLE);
  });

  it('updates session metadata across turns without overwriting a manual title or a paused summary', async () => {
    const projectPath = makeProject('progress-metadata');
    const faux = fauxProvider({ provider: 'progress-metadata', models: [{ id: 'm' }] });
    driver.hub.models.registerNativeProvider(faux.provider);
    const { id } = await driver.hub.create({
      kind: 'code',
      projectPath,
      worktree: false,
      model: 'progress-metadata/m',
    });
    const complete = vi.spyOn(driver.hub.models, 'completeSimple');
    const digest = (title: string, description: string) => fauxAssistantMessage(JSON.stringify({ title, description }));
    const run = async (task: string, reply: string) => {
      faux.setResponses([fauxAssistantMessage(reply)]);
      await driver.run(id, task);
    };
    try {
      complete.mockResolvedValueOnce(digest('Investigate redirects', 'Traced the login redirect to the cache key.'));
      await run('Trace login redirects', 'The login redirect uses the old cache key.');
      await vi.waitFor(() =>
        expect(driver.hub.meta(id)).toMatchObject({
          title: 'Investigate redirects',
          description: 'Traced the login redirect to the cache key.',
        }),
      );
      expect(complete.mock.lastCall?.[1].messages[0]).toMatchObject({
        role: 'user',
        content: expect.stringContaining('The login redirect uses the old cache key.'),
      });

      complete.mockResolvedValueOnce(digest('Replace redirects', 'Updated the login redirect and checked the tests.'));
      await run('Replace the redirect', 'The tests pass with the new route.');
      await vi.waitFor(() => expect(driver.hub.meta(id).title).toBe('Replace redirects'));

      const pending = Promise.withResolvers<ReturnType<typeof digest>>();
      complete.mockReturnValueOnce(pending.promise);
      await run('Review the new route', 'Review finished.');
      const signal = complete.mock.lastCall?.[2]?.signal;
      expect(signal?.aborted).toBe(false);
      driver.hub.update(id, { autoUpdateMetadata: false, title: 'Custom title' });
      expect(signal?.aborted).toBe(true);
      await run('Wait for approval', 'Waiting for approval.');
      expect(complete).toHaveBeenCalledTimes(3);
      driver.hub.update(id, { autoUpdateMetadata: true });
      pending.resolve(digest('Stale title', 'Stale description.'));
      await pending.promise;
      expect(driver.hub.meta(id)).toMatchObject({
        title: 'Custom title',
        description: 'Updated the login redirect and checked the tests.',
      });

      complete.mockResolvedValueOnce(digest('Keep redirects', 'The redirect is approved and ready to ship.'));
      await run('Approval received', 'The redirect can ship.');
      const expected = { title: 'Custom title', description: 'The redirect is approved and ready to ship.' };
      await vi.waitFor(() => expect(driver.hub.meta(id)).toMatchObject(expected));
      expect(driver.events).toContainEqual(
        expect.objectContaining({ type: 'meta', sessionId: id, meta: expect.objectContaining(expected) }),
      );
      const disk = new Store(path.join(tmp, 'data'));
      expect(disk.get('sessions', [])).toContainEqual(expect.objectContaining({ id, ...expected }));
      expect(driver.hub.peerRead('another-session', id)).not.toContainEqual(
        expect.objectContaining({ text: expected.description }),
      );
    } finally {
      complete.mockRestore();
    }
  });

  it('keeps a task summary when a queued peer message arrives before the run settles', async () => {
    const projectPath = makeProject('progress-follow-up');
    const faux = fauxProvider({ provider: 'progress-follow-up', models: [{ id: 'm' }] });
    driver.hub.models.registerNativeProvider(faux.provider);
    const { id } = await driver.hub.create({
      kind: 'code',
      projectPath,
      worktree: false,
      model: 'progress-follow-up/m',
    });
    const peer = await driver.hub.create({ kind: 'code', projectPath, worktree: false, title: 'Reviewer' });
    const description = 'Moved the cache key and verified the login route.';
    const complete = vi
      .spyOn(driver.hub.models, 'completeSimple')
      .mockResolvedValue(fauxAssistantMessage(JSON.stringify({ title: 'Login redirects', description })));
    let delivery: string | undefined;
    const peerText = 'Different request from the reviewer';
    faux.setResponses([
      async () => {
        delivery = await driver.hub.peerSend(peer.id, id, peerText);
        return fauxAssistantMessage('Verified the route using the new cache key.');
      },
      fauxAssistantMessage('Responding to the reviewer, not changing the redirect task.'),
    ]);
    try {
      await driver.run(id, 'Fix the login redirect');
      expect(delivery).toBe('queued');
      expect(driver.hub.peerRead(peer.id, id)).toContainEqual(
        expect.objectContaining({ text: expect.stringContaining(peerText) }),
      );
      await vi.waitFor(() => expect(driver.hub.meta(id).description).toBe(description));
      expect(driver.hub.peerList(peer.id, 'project', 'moved the cache key')).toMatchObject([{ id, description }]);
      expect(complete).toHaveBeenCalledTimes(1);
      const input = JSON.stringify(complete.mock.lastCall?.[1].messages);
      expect(input).toContain('Verified the route using the new cache key.');
      expect(input).not.toContain(peerText);
    } finally {
      complete.mockRestore();
    }
  });

  it('discovers current peers between model requests without adding their transcripts to the prompt', async () => {
    const projectPath = makeProject('discovery');
    const demo = (dir: string) =>
      driver.hub.create({ kind: 'code', projectPath: dir, worktree: false, model: 'demo/demo-coder' });
    const source = await demo(projectPath);
    const archived = await demo(projectPath);
    const outside = await demo(makeProject('discovery-other'));
    await driver.run(archived.id, 'Old login redirect');
    await driver.hub.archive(archived.id);
    await driver.run(outside.id, 'Unrelated project login redirect');

    const faux = fauxProvider({ provider: 'peer-discovery', models: [{ id: 'm' }] });
    const request = (name: string, args: Record<string, string>) =>
      fauxAssistantMessage(fauxToolCall(name, args), { stopReason: 'toolUse' });
    const seen: string[] = [];
    const opaque = 'An opaque transcript-only line';
    faux.setResponses([
      async ({ messages }) => {
        seen.push(JSON.stringify(messages));
        // A starts work after B's first request; B should see it on the next request in the same turn.
        await driver.run(source.id, 'Check the login redirect cache');
        await driver.run(source.id, opaque);
        return request('read', { path: 'src/utils/date.js' });
      },
      ({ messages }) => {
        seen.push(JSON.stringify(messages));
        return request('pidesk_read_session', { session_id: source.id });
      },
      ({ messages }) => {
        seen.push(JSON.stringify(messages));
        return request('pidesk_send_message', { session_id: source.id, message: 'Is the redirect cache key shared?' });
      },
      fauxAssistantMessage('Continue the redirect work.'),
    ]);
    driver.hub.models.registerNativeProvider(faux.provider);
    const { id } = await driver.hub.create({
      kind: 'code',
      projectPath,
      worktree: false,
      model: 'peer-discovery/m',
      mode: 'default',
    });
    driver.hub.update(id, { autoUpdateMetadata: false });
    const { ui, tools } = await driver.run(id, 'Implement the login redirect', () => ({ value: 'Allow' }));
    expect(seen[0]).not.toContain(source.id);
    expect(seen[1]).toContain(source.id);
    expect(seen[1]).toContain('Check the login redirect cache');
    expect(seen[1]).not.toContain(opaque);
    expect(seen[2]).toContain(opaque);
    expect(seen.join('')).not.toContain(outside.id);
    expect(seen.join('')).not.toContain(archived.id);
    expect(ui).toContainEqual(expect.objectContaining({ kind: 'permission', title: 'Use pidesk_send_message' }));
    expect(tools.find((e) => e.toolName === 'pidesk_send_message')).toMatchObject({ isError: false });
    expect(JSON.stringify((await driver.hub.open(id)).messages)).not.toContain('同项目的其他近期会话');

    const store = new Store(path.join(tmp, 'data'));
    const settings = store.get<Partial<Settings>>('settings', {});
    store.set('settings', { ...settings, sessionPeerHints: false });
    try {
      faux.setResponses([
        ({ messages }) => {
          seen.push(JSON.stringify(messages));
          return fauxAssistantMessage('Continue without automatic peer hints.');
        },
      ]);
      await driver.run(id, 'Recheck the login redirect');
      expect(seen.at(-1)).not.toContain('同项目的其他近期会话');
    } finally {
      store.set('settings', settings);
    }
  });

  it('skips next-message prediction when only the offline demo model exists', async () => {
    const { meta } = await codeSession();
    await driver.hub.open(meta.id);
    expect(await driver.hub.suggest(meta.id, { model: 'auto', context: 6 })).toBeNull();
    expect(await driver.hub.suggest(meta.id, { model: 'session', context: 'all' })).toBeNull();
    expect(await driver.hub.suggest(meta.id, { model: 'fixed', modelId: 'demo/demo-coder', context: 6 })).toBeNull();
  });

  it('isolates concurrent side chats, including quotes, answers and reset, from each other and the session', async () => {
    const { meta } = await codeSession();
    const hub = driver.hub;
    const before = (await hub.open(meta.id)).messages.length;
    const from = driver.events.length;
    const a = hub.sideCreate(meta.id).id;
    const b = hub.sideCreate(meta.id).id;
    const first = Promise.withResolvers<ReturnType<typeof fauxAssistantMessage>>();
    const second = Promise.withResolvers<ReturnType<typeof fauxAssistantMessage>>();
    const complete = vi
      .spyOn(hub.models, 'completeSimple')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    try {
      hub.sideStage(meta.id, a, ' first quote ');
      hub.side(meta.id, a, { text: 'First question' });
      hub.side(meta.id, b, { text: 'Second question' });
      expect(hub.sideList(meta.id)).toEqual([
        { id: a, title: 'First question' },
        { id: b, title: 'Second question' },
      ]);
      expect(hub.sideList('other-session')).toEqual([]);
      expect(() => hub.sideGet('other-session', a)).toThrow('Side chat not found');
      expect(hub.sideGet(meta.id, a)).toMatchObject({
        busy: true,
        turns: [{ role: 'user', text: 'First question', quote: 'first quote' }],
      });
      expect(hub.sideGet(meta.id, b).turns).toEqual([{ role: 'user', text: 'Second question' }]);
      const secondPrompt = complete.mock.calls[1]?.[1].messages.at(-1);
      expect(secondPrompt).toMatchObject({ role: 'user', content: expect.stringContaining('Second question') });
      expect(secondPrompt).not.toMatchObject({ content: expect.stringContaining('First question') });

      hub.sideReset(meta.id, a);
      expect(complete.mock.calls[0]?.[2]?.signal?.aborted).toBe(true);
      expect(complete.mock.calls[1]?.[2]?.signal?.aborted).toBe(false);
      first.resolve(fauxAssistantMessage('Stale answer'));
      second.resolve(fauxAssistantMessage('Second answer'));
      await vi.waitFor(() =>
        expect(hub.sideGet(meta.id, b)).toMatchObject({
          busy: false,
          turns: [
            { role: 'user', text: 'Second question' },
            { role: 'assistant', text: 'Second answer' },
          ],
        }),
      );
      expect(hub.sideGet(meta.id, a)).toMatchObject({ turns: [], quote: null, busy: false, title: '' });
      expect(driver.events.slice(from)).toContainEqual(
        expect.objectContaining({
          type: 'side',
          sessionId: meta.id,
          chat: expect.objectContaining({ id: b, busy: false }),
        }),
      );
      expect(driver.events.slice(from)).toContainEqual({ type: 'changed', resource: 'sideChats' });
      expect((await hub.open(meta.id)).messages.length).toBe(before);
    } finally {
      complete.mockRestore();
      first.resolve(fauxAssistantMessage('First answer'));
      second.resolve(fauxAssistantMessage('Second answer'));
    }
  });

  it('runs a `!` command in the session’s own shell and keeps it in the conversation', async () => {
    const { meta } = await codeSession('auto');
    await driver.hub.open(meta.id);
    fs.mkdirSync(path.join(meta.cwd, 'sub'));
    // The shell the model's commands use keeps its folder: the composer's `!` commands start where it is.
    const first = await driver.hub.bash(meta.id, 'cd sub', { id: 'user-1' });
    expect(first.exitCode).toBe(0);
    const ran = await driver.hub.bash(meta.id, 'pwd', { id: 'user-2' });
    expect(path.basename(ran.output.trim())).toBe('sub');
    // The view streams the output by the id it sent, so it lands in the right transcript item.
    expect(
      driver.events.some(
        (e) =>
          e.type === 'pi' &&
          e.sessionId === meta.id &&
          e.event.type === 'bash_execution_update' &&
          e.event.id === 'user-2',
      ),
    ).toBe(true);
    const shells = (await driver.hub.open(meta.id)).messages.filter((m) => m.role === 'bashExecution');
    expect(shells.map((m) => m.command)).toEqual(['cd sub', 'pwd']);
    expect(String(shells.at(-1)!.output).trim()).toMatch(/sub$/);
    // `!!` keeps its output out of what the model reads, but the transcript still has it.
    await driver.hub.bash(meta.id, 'echo hidden-marker', { excludeFromContext: true });
    const hidden = (await driver.hub.open(meta.id)).messages.filter((m) => m.role === 'bashExecution').at(-1)!;
    expect(hidden).toMatchObject({ command: 'echo hidden-marker', excludeFromContext: true });
    expect(String(hidden.output)).toMatch(/hidden-marker/);
  });

  it('serves the composer’s `!` command through the host channel, guards included', async () => {
    const { meta } = await codeSession('auto');
    await driver.hub.open(meta.id);
    const handlers = sessionHandlers(Promise.resolve(driver.hub), () => null);
    // Every channel of the protocol has an implementation here: a new one that nobody wires would throw.
    expect(HOST_CHANNELS.filter((channel) => typeof handlers[channel] !== 'function')).toEqual([]);
    const ran = (await handlers['sessions:bash'](meta.id, 'echo via-channel', { id: 'ch-1' })) as BashRunResult;
    expect(ran).toMatchObject({ cancelled: false });
    expect(ran.output.trim()).toBe('via-channel');
    // A bare `!` never reaches the shell, and a session the host does not know cannot run anything.
    await expect(handlers['sessions:bash'](meta.id, '   ', {})).rejects.toThrow(/命令|command/i);
    await expect(handlers['sessions:bash']('no-such-session', 'echo hi', {})).rejects.toThrow(/Unknown session/);
  });

  it('uses the worktree folder from settings, and the default when it is unset', async () => {
    const project = makeProject('worktree-root');
    const custom = path.join(tmp, 'custom-worktrees');
    const create = (title: string) =>
      driver.hub.create({
        kind: 'code',
        projectPath: project,
        worktree: true,
        model: 'demo/demo-coder',
        title,
        autoName: false,
      });
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
    const r = await driver.run(meta.id, '帮我整理收件箱：归类、标记需要回复的邮件，并起草回复', () => ({
      value: 'Allow',
    }));
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

describe('desktop plugins', { timeout: 120_000 }, () => {
  it("gives every session the app's own authoring skill", async () => {
    const { meta } = await codeSession();
    await driver.hub.open(meta.id);
    const commands = await driver.hub.commands(meta.id);
    expect(commands.find((c) => c.name === 'skill:plugin-author')).toMatchObject({ source: 'skill' });
    // Written into the app's own folder, so an app update can refresh it without touching pi's folders.
    expect(fs.existsSync(path.join(tmp, 'data', 'skills', 'plugin-author', 'SKILL.md'))).toBe(true);
  });
});
