import { describe, expect, it, vi } from 'vitest';
import { createDesktopKit, type KitHost, isPrAutomationCommand } from '../src/agent/desktop-kit';
import type { UiResponse } from '../src/shared/protocol';

type Review = NonNullable<KitHost['review']>;
type Execute = (id: string, params: Record<string, unknown>) => Promise<unknown>;

function load(overrides: Partial<KitHost> = {}) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const requests: unknown[] = [];
  const tools = new Map<string, Execute>();
  const state = {
    mode: 'auto',
    profile: 'code',
    outputStyle: 'default',
    allowed: new Set<string>(),
  } as KitHost['state'];
  const pi = {
    on: (event: string, handler: (...args: any[]) => any) => handlers.set(event, handler),
    getAllTools: () => [],
    registerTool: (tool: { name: string; execute: Execute }) => tools.set(tool.name, tool.execute),
    sendMessage: () => {},
  };
  createDesktopKit({
    state,
    ask: async (request) => {
      requests.push(request);
      return { value: 'Allow' } as UiResponse;
    },
    setMode: () => {},
    ...overrides,
  })(pi as any);
  return {
    state,
    requests,
    execute: (name: string, params: Record<string, unknown>) => tools.get(name)!('call-1', params),
    call: (input: Record<string, unknown>, toolName = 'bash') =>
      handlers.get('tool_call')?.({ toolName, toolCallId: 'call-1', input }, { cwd: process.cwd(), signal: undefined }),
  };
}

describe('Work session handoffs', () => {
  const tool = 'pidesk_create_session';
  const input = { title: 'Follow up', prompt: 'Check the release build', code_folder: '/repo', base_ref: 'release' };

  it('remembers launch consent per folder, not for all Code folders or in plan mode', async () => {
    const ask = vi
      .fn<KitHost['ask']>()
      .mockResolvedValueOnce({ value: 'Always allow' })
      .mockResolvedValue({ value: 'Deny' });
    const kit = load({ scope: { cwd: '/work', readable: () => ['/repo', '/other'] }, ask });
    await expect(kit.call(input, tool)).resolves.toBeUndefined();
    await expect(kit.call(input, tool)).resolves.toBeUndefined();
    expect(ask).toHaveBeenCalledTimes(1);
    await expect(kit.call({ ...input, code_folder: '/other' }, tool)).resolves.toMatchObject({ block: true });
    kit.state.mode = 'plan';
    await expect(kit.call(input, tool)).resolves.toMatchObject({ block: true });
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('offers the same normalized handoff without starting it, and rejects unlinked destinations', async () => {
    const createSession = vi
      .fn<NonNullable<KitHost['createSession']>>()
      .mockResolvedValue({ id: 'child', title: input.title });
    const kit = load({
      createSession,
      project: { context: () => null, codeFolders: () => ['/repo'], remember: () => 0 },
    });
    const task = { title: input.title, prompt: input.prompt, codeFolder: '/repo', baseRef: 'release' };
    await expect(kit.execute('pidesk_suggest_task', { tasks: [input] })).resolves.toMatchObject({
      details: { tasks: [task] },
    });
    await expect(kit.execute(tool, { ...input, code_folder: '/other' })).rejects.toThrow(/not a Code folder/);
    expect(createSession).not.toHaveBeenCalled();
    await expect(kit.execute(tool, input)).resolves.toMatchObject({ details: { sessionId: 'child' } });
    expect(createSession).toHaveBeenCalledExactlyOnceWith(task);
  });
});

describe('PR automation command gate', () => {
  it('accepts only git and forge CLI steps', () => {
    expect(isPrAutomationCommand('git add -A && git commit -m "a && b" && gh pr create --fill')).toBe(true);
    expect(isPrAutomationCommand('glab mr merge 4')).toBe(true);
    expect(isPrAutomationCommand('git status && npm test')).toBe(false);
    expect(isPrAutomationCommand('git push; rm -rf .')).toBe(false);
    expect(isPrAutomationCommand('git status $(rm -rf .)')).toBe(false);
    expect(isPrAutomationCommand('git push & gh pr create')).toBe(false);
  });

  it('sends non-read-only auto commands to the model review', async () => {
    const review = vi.fn<Review>(async () => ({ verdict: 'allow', reason: '' }));
    const loaded = load({ review });
    await loaded.call({ command: 'git push --set-upstream origin HEAD' });
    expect(review).toHaveBeenCalledOnce();
    expect(loaded.requests).toHaveLength(0);
  });

  it('keeps the deterministic read-only pre-check ahead of review', async () => {
    const review = vi.fn<Review>(async () => ({ verdict: 'allow', reason: '' }));
    const loaded = load({ review });
    await loaded.call({ command: 'git status --short' });
    expect(review).not.toHaveBeenCalled();
    expect(loaded.requests).toHaveLength(0);
  });

  it('lets PR watcher git/forge commands through in every permission mode', async () => {
    for (const mode of ['auto', 'default', 'acceptEdits', 'plan'] as const) {
      const review = vi.fn<Review>(async () => ({ verdict: 'ask', reason: 'should not run' }));
      const loaded = load({ review, prAutomation: () => true });
      loaded.state.mode = mode;
      await expect(
        loaded.call({ command: 'git push -u origin HEAD && gh pr comment 4 --body done' }),
      ).resolves.toBeUndefined();
      expect(review).not.toHaveBeenCalled();
      expect(loaded.requests).toHaveLength(0);
    }
  });

  it('does not let PR automation widen a mixed shell command', async () => {
    const loaded = load({ prAutomation: () => true });
    loaded.state.mode = 'default';
    await loaded.call({ command: 'git push && npm test' });
    expect(loaded.requests).toHaveLength(1);
  });
});
