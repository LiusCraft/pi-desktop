import { resolve } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';
import { createDesktopKit, type KitHost, isPrAutomationCommand } from '../src/agent/desktop-kit';
import { SCOPE_KEY } from '../src/agent/work-scope';
import type { UiResponse } from '../src/shared/protocol';

type Review = NonNullable<KitHost['review']>;
type Execute = (id: string, params: Record<string, unknown>) => Promise<unknown>;
type ToolInfo = ReturnType<ExtensionAPI['getAllTools']>[number];

function load(
  overrides: Partial<KitHost> = {},
  {
    response = { value: 'Allow' },
    tools = [],
  }: { response?: UiResponse; tools?: Pick<ToolInfo, 'name' | 'annotations'>[] } = {},
) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const requests: unknown[] = [];
  const registered = new Map<string, Execute>();
  const state: KitHost['state'] = overrides.state ?? {
    mode: 'auto',
    profile: 'code',
    outputStyle: 'default',
    allowed: new Set<string>(),
  };
  const pi = {
    on: (event: string, handler: (...args: any[]) => any) => handlers.set(event, handler),
    getAllTools: () => tools,
    registerTool: (tool: { name: string; execute: Execute }) => registered.set(tool.name, tool.execute),
    sendMessage: () => {},
  };
  createDesktopKit({
    state,
    ask: async (request) => {
      requests.push(request);
      return response;
    },
    setMode: () => {},
    ...overrides,
  })(pi as any);
  return {
    state,
    requests,
    execute: (name: string, params: Record<string, unknown>) => registered.get(name)!('call-1', params),
    call: (input: Record<string, unknown>, toolName = 'bash') =>
      handlers.get('tool_call')?.(
        { toolName, toolCallId: 'call-1', input },
        { cwd: overrides.cwd ?? process.cwd(), signal: undefined },
      ),
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

describe('Plan mode and Work scope', () => {
  const cwd = resolve('work-scope-fixture', 'work');
  const outside = resolve(cwd, '..', 'outside');
  const path = resolve(outside, 'notes.md');
  const key = `${SCOPE_KEY}${outside}`;

  // Work subagents use this same gate with their own plan-mode state and no PR automation.
  const loadScoped = (options?: Parameters<typeof load>[1]) =>
    load(
      {
        cwd,
        scope: { cwd, readable: () => [] },
        state: { mode: 'plan', profile: 'work', outputStyle: 'default', allowed: new Set() },
      },
      options,
    );

  it.each([
    ['write', { path, content: 'notes' }],
    ['edit', { path }],
    ['bash', { command: 'npm test', workdir: outside }],
    ['powershell', { command: 'npm test', workdir: outside }],
    ['pidesk_bg_shell', { command: 'npm test', workdir: outside }],
  ] as const)('blocks %s before asking for or honoring a directory grant', async (tool, input) => {
    const loaded = loadScoped();
    const blocked = { block: true, reason: expect.stringContaining('Plan mode') };
    await expect(loaded.call(input, tool)).resolves.toEqual(blocked);
    loaded.state.allowed.add(key);
    await expect(loaded.call(input, tool)).resolves.toEqual(blocked);
    expect(loaded.requests).toHaveLength(0);
  });

  it.each([
    ['read', { path }],
    ['bash', { command: 'ls', workdir: outside }],
  ] as const)('still asks before %s reads outside the scope and honors a denial', async (tool, input) => {
    const loaded = loadScoped({ response: { value: 'Deny' } });
    await expect(loaded.call(input, tool)).resolves.toMatchObject({ block: true });
    expect(loaded.requests).toHaveLength(1);
    expect(loaded.state.allowed.size).toBe(0);
  });

  it('lets a directory grant extend read access without lifting plan restrictions', async () => {
    const loaded = loadScoped({ response: { value: 'Always allow' } });
    await expect(loaded.call({ path }, 'read')).resolves.toBeUndefined();
    expect(loaded.state.allowed.has(key)).toBe(true);
    await expect(loaded.call({ command: 'ls', workdir: outside })).resolves.toBeUndefined();
    await expect(loaded.call({ path, content: 'notes' }, 'write')).resolves.toMatchObject({ block: true });
    expect(loaded.requests).toHaveLength(1);
    expect(loaded.state.mode).toBe('plan');
  });

  it('uses extension tool annotations to enforce Plan Mode even with a directory grant', async () => {
    const loaded = loadScoped({
      tools: [
        { name: 'inspect', annotations: { readOnlyHint: true } },
        { name: 'update', annotations: { readOnlyHint: false } },
      ],
    });
    loaded.state.allowed.add(key);
    await expect(loaded.call({ path }, 'inspect')).resolves.toBeUndefined();
    await expect(loaded.call({ path }, 'update')).resolves.toEqual({ block: true, reason: 'Plan mode blocks update.' });
    await expect(loaded.call({ path }, 'unannotated')).resolves.toEqual({
      block: true,
      reason: 'Plan mode blocks unannotated.',
    });
    expect(loaded.requests).toHaveLength(0);
  });

  it('honors a Work directory grant for edits outside Plan Mode without authorizing shell commands', async () => {
    const loaded = loadScoped({ response: { value: 'Deny' } });
    loaded.state.mode = 'default';
    loaded.state.allowed.add(key);
    await expect(loaded.call({ path, content: 'notes' }, 'write')).resolves.toBeUndefined();
    expect(loaded.requests).toHaveLength(0);
    await expect(loaded.call({ command: 'npm test', workdir: outside })).resolves.toMatchObject({ block: true });
    expect(loaded.requests).toEqual([expect.objectContaining({ kind: 'permission', title: 'Run npm test' })]);
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
