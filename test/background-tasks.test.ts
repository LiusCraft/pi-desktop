import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDesktopKit, type KitHost, type SubagentRun } from '../src/agent/desktop-kit';
import { SessionHub } from '../src/agent/hub';
import type { TaskUpdate } from '../src/shared/protocol';

/** Loads the kit into a fake pi and exposes the tools it registered. */
function load(host: Partial<KitHost>) {
  const tools = new Map<string, any>();
  const messages: { message: any; options: any }[] = [];
  const pi = {
    on: () => {},
    getAllTools: () => [],
    registerTool: (t: any) => tools.set(t.name, t),
    sendMessage: (message: any, options: any) => messages.push({ message, options }),
  };
  const state = { mode: 'auto', profile: 'code', outputStyle: 'default', allowed: new Set<string>() } as KitHost['state'];
  createDesktopKit({ state, ask: async () => ({ cancelled: true }), setMode: () => {}, ...host })(pi as any);
  return { tools, messages };
}

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 50));
  expect(cond()).toBe(true);
};
const ctx = { cwd: process.cwd(), model: undefined } as any;
const text = (r: any) => r.content[0].text as string;

describe('background tasks', () => {
  it('pidesk_bg_shell returns at once, streams output, and notifies the model when the command exits', async () => {
    const updates: TaskUpdate[] = [];
    const { tools, messages } = load({ taskUpdate: (u) => updates.push(u) });
    const started = await tools.get('pidesk_bg_shell').execute('call-1', { command: 'node -e "console.log(\'hello-bg\')"' }, undefined, undefined, ctx);
    expect(started.details.background).toBe(true);
    expect(messages).toHaveLength(0);

    await until(() => messages.length > 0);
    expect(messages[0].options).toMatchObject({ triggerTurn: true, deliverAs: 'followUp' });
    expect(messages[0].message.content).toMatch(/exited with code 0/);
    expect(messages[0].message.content).toMatch(/hello-bg/);
    const last = updates.at(-1)!;
    expect(last).toMatchObject({ toolCallId: 'call-1', state: 'done' });
    expect(last.shell?.output).toMatch(/hello-bg/);

    const out = await tools.get('pidesk_bg_output').execute('call-2', { id: 'call-1' });
    expect(text(out)).toMatch(/finished.*\n.*hello-bg/s);
  });

  it('pidesk_bg_shell runs in the workdir it was given', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-bg-workdir-'));
    const updates: TaskUpdate[] = [];
    const { tools } = load({ taskUpdate: (u) => updates.push(u) });
    await tools.get('pidesk_bg_shell').execute('call-1', { command: 'node -e "console.log(process.cwd())"', workdir: dir }, undefined, undefined, ctx);
    await until(() => updates.at(-1)?.state === 'done');
    expect(updates.at(-1)?.shell?.output).toContain(fs.realpathSync(dir));
  });

  it('pidesk_bg_kill stops a running command without waking the model', async () => {
    const stops = new Map<string, AbortController>();
    const updates: TaskUpdate[] = [];
    const { tools, messages } = load({
      taskUpdate: (u) => updates.push(u),
      trackTask: (id, stop) => (stops.set(id, stop), () => void stops.delete(id)),
    });
    await tools.get('pidesk_bg_shell').execute('call-1', { command: 'node -e "setInterval(() => {}, 1000)"' }, undefined, undefined, ctx);
    expect(stops.has('call-1')).toBe(true);
    await tools.get('pidesk_bg_kill').execute('call-2', { id: 'call-1' });

    await until(() => messages.length > 0);
    expect(messages[0].options.triggerTurn).toBe(false);
    expect(updates.at(-1)?.state).toBe('stopped');
    expect(stops.size).toBe(0);
  });

  it('pidesk_task with run_in_background returns immediately and delivers the report later', async () => {
    const updates: TaskUpdate[] = [];
    let finish!: (text: string) => void;
    const { tools, messages } = load({
      taskUpdate: (u) => updates.push(u),
      runSubagent: (run: SubagentRun) =>
        new Promise<string>((resolve) => {
          run.onProgress({ commands: 0, reads: 1, searches: 0, failed: 0 }, { startedAt: Date.now(), tokens: 5, toolUses: 1, activity: 'Reading', steps: [] });
          finish = resolve;
        }),
    });
    const r = await tools.get('pidesk_task').execute('call-1', { description: 'Explore it', prompt: 'look', run_in_background: true }, undefined, undefined, ctx);
    expect(r.details.background).toBe(true);
    expect(updates.at(-1)).toMatchObject({ state: 'running' });
    expect(messages).toHaveLength(0);

    finish('the report');
    await until(() => messages.length > 0);
    expect(messages[0].message.content).toMatch(/the report/);
    expect(updates.at(-1)).toMatchObject({ state: 'done', text: 'the report' });
  });

  it('stopping the turn also stops its background tasks, so nothing wakes the session later', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-desktop-hub-stop-'));
    const hub = new SessionHub({ dataDir: path.join(dir, 'data'), agentDir: path.join(dir, 'agent'), emit: () => {} });
    const shell = new AbortController();
    const subagent = new AbortController();
    let abortedTurn = false;
    // Only what abort() reads from a live session: its tracked tasks and its own session.
    const live = {
      id: 's1', pending: new Map(), tasks: new Map([['call-1', shell], ['call-2', subagent]]),
      runtime: { session: { abort: async () => void (abortedTurn = true) } },
    };
    (hub as unknown as { live: Map<string, unknown> }).live.set('s1', live);

    await hub.abort('s1');

    expect(abortedTurn).toBe(true);
    expect(shell.signal.aborted).toBe(true);
    expect(subagent.signal.aborted).toBe(true);
  });
});
