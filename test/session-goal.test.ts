import { describe, expect, it, vi } from 'vitest';
import { sessionGoal } from '../src/agent/session-goal';
import { tr } from '../src/shared/i18n/runtime';

function setup() {
  const events = new Map<string, (...args: any[]) => any>();
  const entries: { type: 'custom'; customType: string; data: any }[] = [];
  const ctx = {
    isIdle: vi.fn<() => boolean>(() => true),
    abort: vi.fn<() => void>(),
    ui: { notify: vi.fn<(message: string, level: string) => void>() },
    sessionManager: { getBranch: () => entries },
  };
  let command!: (arg: string, ctx: unknown) => Promise<void>;
  type Result = { status: 'complete' | 'blocked'; reason: string };
  let report!: (id: string, result: Result) => Promise<unknown>;
  const sendUserMessage = vi.fn<(text: string) => void>();
  sessionGoal({
    registerCommand: (_name: string, def: { handler: typeof command }) => (command = def.handler),
    registerTool: (def: { execute: typeof report }) => (report = def.execute),
    on: (name: string, handler: (...args: any[]) => any) => events.set(name, handler),
    appendEntry: (customType: string, data: unknown) => entries.push({ type: 'custom', customType, data }),
    sendUserMessage,
  } as any);
  return {
    ctx,
    entries,
    sendUserMessage,
    command: (s: string) => command(s, ctx),
    result: (status: Result['status'], reason: string) => report('result', { status, reason }),
    event: (name: string, event = {}) => events.get(name)!(event, ctx),
  };
}

describe('session goal lifecycle', () => {
  it('requires evidence, resumes a blocked goal, and never reopens a completed goal', async () => {
    const g = setup();
    await expect(g.result('complete', 'tests passed')).rejects.toThrow(tr('ag.goalNotActive'));
    await g.command('green tests');
    await expect(g.result('complete', '   ')).rejects.toThrow(tr('ag.goalNeedReason'));
    expect(g.entries.at(-1)?.data.status).toBe('active');
    g.ctx.isIdle.mockReturnValue(false);
    await g.command('a different objective');
    expect(g.entries.at(-1)?.data.objective).toBe('green tests');
    await g.result('blocked', 'waiting for CI');
    expect(g.event('agent_before_settle', { outcome: 'completed', entries: [] })).toBeUndefined();
    g.ctx.isIdle.mockReturnValue(true);
    await g.command('resume');
    await g.result('complete', 'all CI checks passed');
    await g.command('resume');
    expect(g.entries.at(-1)?.data).toEqual({
      objective: 'green tests',
      status: 'complete',
      reason: 'all CI checks passed',
    });
    expect(g.sendUserMessage.mock.calls).toEqual([['green tests'], ['green tests']]);
  });

  it('caps extra requests and renews the budget only on explicit resume', async () => {
    const g = setup();
    await g.command('green tests');
    const settle = () => g.event('agent_before_settle', { entries: [], outcome: 'completed' });
    for (let i = 0; i < 10; i++) expect(settle()).toMatchObject({ continue: true });
    expect(settle()).toBeUndefined();
    expect(g.entries.at(-1)?.data.status).toBe('paused');
    await g.command('');
    expect(g.sendUserMessage).toHaveBeenCalledTimes(1);
    await g.command('resume');
    expect(settle()).toMatchObject({ continue: true });
  });

  it('never restarts on reopen, abort, error or clear', async () => {
    const g = setup();
    await g.command('green tests');
    g.event('session_start');
    expect(g.event('before_agent_start')).toBeUndefined();
    await g.command('resume');
    g.event('agent_settled', { aborted: true });
    expect(g.entries.at(-1)?.data.status).toBe('paused');
    await g.command('resume');
    expect(g.event('agent_before_settle', { outcome: 'error', entries: [] })).toBeUndefined();
    expect(g.entries.at(-1)?.data.status).toBe('paused');
    await g.command('resume');
    g.ctx.isIdle.mockReturnValue(false);
    await g.command('pause');
    expect(g.ctx.abort).toHaveBeenCalledOnce();
    await g.command('clear');
    g.event('session_tree');
    await g.command('resume');
    expect(g.entries.at(-1)?.data).toBeNull();
    expect(g.sendUserMessage).toHaveBeenCalledTimes(4);
  });
});
