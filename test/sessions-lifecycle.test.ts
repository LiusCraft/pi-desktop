// Session lifecycle against real repositories and the offline demo model: fast creation with a
// background worktree, archive / delete, adopting a worktree the user made, suggested tasks and
// messages between the sessions of one project.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodePeerMessage } from '@shared/peer-message';
import type { HostEvent } from '@shared/protocol';
import * as git from '../src/agent/git';
import { SessionHub, readTranscript } from '../src/agent/hub';

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-desktop-lifecycle-'));
const agentDir = path.join(tmp, 'agent');
process.env.PI_CODING_AGENT_DIR = agentDir;

const run = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe', encoding: 'utf8' });

function makeProject(name: string) {
  const dir = path.join(tmp, name);
  fs.cpSync(path.join(ROOT, 'demo', 'todo-app'), dir, { recursive: true });
  run(dir, 'init', '-q', '-b', 'main');
  run(dir, 'add', '-A');
  run(dir, 'commit', '-qm', 'init');
  return dir;
}

const events: HostEvent[] = [];
let hub: SessionHub;
const settled = new Map<string, number>();

beforeAll(async () => {
  hub = new SessionHub({
    dataDir: path.join(tmp, 'data'), agentDir, demoModel: true,
    emit: (e) => {
      events.push(e);
      if (e.type === 'pi' && e.event.type === 'agent_settled') settled.set(e.sessionId, (settled.get(e.sessionId) ?? 0) + 1);
    },
  });
  await hub.init();
});
afterAll(async () => {
  await hub.shutdown();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const waitSettled = async (id: string, turns = 1) => {
  const until = Date.now() + 60_000;
  while ((settled.get(id) ?? 0) < turns) {
    if (Date.now() > until) throw new Error('the session never settled');
    await new Promise((r) => setTimeout(r, 25));
  }
};
const code = (projectPath: string, extra: Partial<Parameters<SessionHub['create']>[0]> = {}) =>
  hub.create({ kind: 'code', projectPath, model: 'demo/demo-coder', mode: 'auto', title: 'test', autoName: false, ...extra });

describe('creating a session', { timeout: 120_000 }, () => {
  it('returns before the worktree exists, then builds it while the session starts', async () => {
    const project = makeProject('fast');
    const meta = await code(project, { worktree: true });
    expect(meta.worktree).toBe(true);
    expect(meta.worktreeSetup).toBeTruthy();
    await hub.open(meta.id);
    expect(fs.existsSync(path.join(meta.cwd, '.git'))).toBe(true);
    expect(hub.meta(meta.id).worktreeSetup).toBeUndefined();

    const steps = events.filter((e): e is Extract<HostEvent, { type: 'setup' }> => e.type === 'setup' && e.sessionId === meta.id);
    expect(steps[0].steps?.map((s) => s.id)).toEqual(['worktree', 'agent']);
    expect(steps.some((e) => e.steps?.some((s) => s.id === 'worktree' && s.state === 'done'))).toBe(true);
    expect(steps.at(-1)!.steps).toBeNull();
  });

  it('reports a vanished session folder as an error instead of starting an agent there', async () => {
    const project = makeProject('retry');
    const meta = await code(project, { worktree: true });
    await hub.open(meta.id);
    await hub.archive(meta.id);
      fs.rmSync(meta.cwd, { recursive: true, force: true });
    hub.unarchive(meta.id);
    await expect(hub.open(meta.id)).rejects.toThrow(/no longer exists/);
  });
});

describe('archive and delete', { timeout: 120_000 }, () => {
  it('archives without touching disk and unarchives again', async () => {
    const project = makeProject('archive');
    const meta = await code(project, { worktree: true });
    await hub.open(meta.id);
    await hub.archive(meta.id);
    expect(hub.list().find((s) => s.id === meta.id)?.archived).toBe(true);
    expect(fs.existsSync(meta.cwd), 'the worktree survives archiving').toBe(true);
    await expect(hub.open(meta.id)).rejects.toThrow(/archived/);
    hub.unarchive(meta.id);
    expect((await hub.open(meta.id)).meta.archived).toBe(false);
  });

  it('delete removes the worktree, its branch and the conversation file', async () => {
    const project = makeProject('delete');
    const meta = await code(project, { worktree: true });
    await hub.open(meta.id);
    const file = hub.meta(meta.id).sessionFile;
    expect(await hub.inspect(meta.id)).toMatchObject({ worktree: meta.cwd, branch: meta.branch, dirty: 0, unpushed: 0 });
    fs.writeFileSync(path.join(meta.cwd, 'scratch.txt'), 'x');
    expect((await hub.inspect(meta.id)).dirty).toBe(1);

    const result = await hub.remove(meta.id);
    expect(result).toEqual({ worktreeRemoved: true, branchKept: null });
    expect(fs.existsSync(meta.cwd)).toBe(false);
    expect(run(project, 'branch', '--list', meta.branch!).trim()).toBe('');
    expect(hub.list().some((s) => s.id === meta.id)).toBe(false);
    if (file) expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(path.join(project, 'package.json')), 'the project itself is untouched').toBe(true);
  });

  it('keeps the branch when it holds commits that exist nowhere else', async () => {
    const project = makeProject('keep-branch');
    const meta = await code(project, { worktree: true });
    await hub.open(meta.id);
    fs.writeFileSync(path.join(meta.cwd, 'work.txt'), 'important');
    run(meta.cwd, 'add', '-A');
    run(meta.cwd, 'commit', '-qm', 'work');
    expect((await hub.inspect(meta.id)).unpushed).toBe(1);

    const result = await hub.remove(meta.id);
    expect(result).toEqual({ worktreeRemoved: true, branchKept: meta.branch });
    expect(run(project, 'branch', '--list', meta.branch!)).toContain(meta.branch!);
  });

  it('forgets children of a deleted session instead of orphaning them', async () => {
    const project = makeProject('parent');
    const parent = await code(project, { worktree: false });
    const child = await code(project, { worktree: false, parentId: parent.id });
    await hub.remove(parent.id);
    expect(hub.meta(child.id).parentId).toBeUndefined();
  });
});

describe('opening a folder that is already a worktree', { timeout: 120_000 }, () => {
  it('recognises linked worktrees and their main checkout', async () => {
    const project = makeProject('wt-main');
    const linked = path.join(tmp, 'wt-linked');
    run(project, 'worktree', 'add', '-b', 'feature/x', linked);
    expect(await git.worktreeInfo(project)).toBeNull();
    const info = await git.worktreeInfo(linked);
    expect(info?.branch).toBe('feature/x');
    expect(path.resolve(info!.mainRoot).toLowerCase()).toBe(path.resolve(project).toLowerCase());
    expect(await git.worktreeInfo(path.join(tmp))).toBeNull();
  });

  it('runs a session in the user’s own worktree and never deletes it', async () => {
    const project = makeProject('adopt');
    const linked = path.join(tmp, 'adopt-linked');
    run(project, 'worktree', 'add', '-b', 'feature/adopt', linked);
    fs.writeFileSync(path.join(linked, 'a.txt'), 'a');
    run(linked, 'add', '-A');
    run(linked, 'commit', '-qm', 'a');

    const meta = await code(project, { adoptPath: linked });
    expect(meta).toMatchObject({ cwd: linked, branch: 'feature/adopt', worktree: true, external: true });
    expect(meta.worktreeSetup).toBeUndefined();
    expect(meta.baseCommit, 'diffs start where the worktree left main').toBe(run(project, 'rev-parse', 'HEAD').trim());
    await hub.open(meta.id);
    expect((await hub.inspect(meta.id)).worktree).toBeNull();

    await hub.remove(meta.id);
    expect(fs.existsSync(path.join(linked, 'a.txt'))).toBe(true);
    expect(run(project, 'branch', '--list', 'feature/adopt')).toContain('feature/adopt');
  });
});

describe('suggested tasks', { timeout: 120_000 }, () => {
  it('starts a task in a new session of the same project and records the choice', async () => {
    const project = makeProject('spawn');
    const from = await code(project, { worktree: false });
    const child = await hub.spawn(from.id, { title: 'Tidy the date helper', prompt: '你好' }, 'call-1:0');
    expect(child).toMatchObject({ kind: 'code', projectPath: project, parentId: from.id, title: 'Tidy the date helper', titleLocked: true });
    expect(hub.meta(from.id).suggestions?.['call-1:0']).toEqual({ state: 'started', sessionId: child.id });
    await waitSettled(child.id);
    const sent = events.find((e) => e.type === 'pi' && e.sessionId === child.id && e.event.type === 'message_end' && e.event.message.role === 'user');
    expect(JSON.stringify(sent)).toContain('你好');
  });

  it('does not let a suggestion inherit bypass mode', async () => {
    const project = makeProject('spawn-bypass');
    const from = await code(project, { worktree: false, mode: 'bypass' });
    const child = await hub.spawn(from.id, { title: 'x', prompt: 'hi' });
    expect(child.mode).toBe('auto');
  });

  it('remembers what the user did with a suggestion', async () => {
    const project = makeProject('spawn-state');
    const from = await code(project, { worktree: false });
    hub.update(from.id, { suggestion: { key: 'c:0', state: 'dismissed' } });
    expect(hub.meta(from.id).suggestions?.['c:0']).toEqual({ state: 'dismissed' });
  });
});

describe('sessions talking to each other', { timeout: 120_000 }, () => {
  it('lists only the project’s other sessions and reads their messages', async () => {
    const project = makeProject('peers');
    const a = await code(project, { worktree: false, title: 'Alpha' });
    const b = await code(project, { worktree: false, title: 'Beta' });
    const other = await code(makeProject('peers-other'), { worktree: false, title: 'Elsewhere' });
    expect(hub.peerList(a.id).map((s) => s.id)).toEqual([b.id]);
    expect(() => hub.peerRead(a.id, other.id)).toThrow(/different project/);
    expect(() => hub.peerRead(a.id, a.id)).toThrow(/No other session/);

    await hub.open(b.id);
    const turn = settled.get(b.id) ?? 0;
    await hub.prompt(b.id, { text: '你好', attachments: [] }, 'steer');
    await waitSettled(b.id, turn + 1);
    const lines = hub.peerRead(a.id, b.id, 5);
    expect(lines.some((l) => l.role === 'user' && l.text.includes('你好'))).toBe(true);
    await hub.archive(b.id);
    expect(hub.peerList(a.id)).toEqual([]);
    await expect(hub.peerSend(a.id, b.id, 'ping')).rejects.toThrow(/archived/);
  });

  it('delivers a message as a user message that names its sender', async () => {
    const project = makeProject('peers-send');
    const a = await code(project, { worktree: false, title: 'Sender' });
    const b = await code(project, { worktree: false, title: 'Receiver' });
    expect(await hub.peerSend(a.id, b.id, '请检查一下日期格式')).toBe('delivered');
    await waitSettled(b.id);
    const received = events.find((e) => e.type === 'pi' && e.sessionId === b.id && e.event.type === 'message_end' && e.event.message.role === 'user');
    const text = (received as Extract<HostEvent, { type: 'pi' }>).event.message.content;
    const peer = decodePeerMessage(typeof text === 'string' ? text : text.map((c: any) => c.text).join(''));
    expect(peer).toEqual({ fromId: a.id, fromTitle: 'Sender', text: '请检查一下日期格式' });
    expect(readTranscript(hub.meta(b.id).sessionFile!, 5)[0].text).toContain('message from session "Sender"');
  });

  it('stops two sessions from flooding each other', async () => {
    const project = makeProject('peers-flood');
    const a = await code(project, { worktree: false });
    const b = await code(project, { worktree: false });
    for (let i = 0; i < 8; i++) await hub.peerSend(a.id, b.id, `m${i}`);
    await expect(hub.peerSend(a.id, b.id, 'too many')).rejects.toThrow(/Too many/);
    await waitSettled(b.id);
  });
});
