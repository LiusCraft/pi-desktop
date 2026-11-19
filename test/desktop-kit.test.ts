import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';
import { createDesktopKit, type KitHost, isPrAutomationCommand } from '../src/agent/desktop-kit';
import { PLAN_CHOICES, type UiResponse } from '../src/shared/protocol';

type Review = NonNullable<KitHost['review']>;

function load(overrides: Partial<KitHost> = {}, reply: UiResponse = { value: 'Allow' }) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const tools = new Map<string, ToolDefinition>();
  const requests: Parameters<KitHost['ask']>[0][] = [];
  const state = {
    mode: 'auto',
    profile: 'code',
    outputStyle: 'default',
    allowed: new Set<string>(),
  } as KitHost['state'];
  const pi = {
    on: (event: string, handler: (...args: any[]) => any) => handlers.set(event, handler),
    getAllTools: () => [],
    registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
    sendMessage: () => {},
  };
  createDesktopKit({
    state,
    ask: async (request) => {
      requests.push(request);
      return reply;
    },
    setMode: (mode) => {
      state.mode = mode;
    },
    ...overrides,
  })(pi as any);
  const ctx = { cwd: process.cwd(), signal: undefined } as Parameters<ToolDefinition['execute']>[4];
  return {
    state,
    requests,
    call: (input: Record<string, unknown>, toolName = 'bash') =>
      handlers.get('tool_call')?.({ toolName, toolCallId: 'call-1', input }, ctx),
    submitPlan: () =>
      tools
        .get('pidesk_exit_plan_mode')!
        .execute('call-2', { title: 'Date helper', plan: 'Fix the month.' }, undefined, undefined, ctx),
  };
}

describe('Plan mode and subagent permissions', () => {
  it('blocks edits and tells a subagent to report instead of asking for plan approval', async () => {
    const loaded = load({ setMode: undefined });
    loaded.state.mode = 'plan';
    await expect(loaded.call({ path: 'date.ts' }, 'write')).resolves.toEqual({
      block: true,
      reason: 'Subagents are read-only. Return your findings in your final text response.',
    });
    expect(loaded.requests).toHaveLength(0);
  });

  it('directs a normal plan-mode session to submit its plan instead of editing', async () => {
    const loaded = load();
    loaded.state.mode = 'plan';
    await expect(loaded.call({ path: 'date.ts' }, 'edit')).resolves.toEqual({
      block: true,
      reason: expect.stringContaining('pidesk_exit_plan_mode'),
    });
    expect(loaded.requests).toHaveLength(0);
  });

  it('skips approval outside plan mode', async () => {
    const loaded = load();
    await expect(loaded.submitPlan()).resolves.toMatchObject({ details: { status: 'skipped' } });
    expect(loaded.requests).toHaveLength(0);
    expect(loaded.state.mode).toBe('auto');
  });

  it.each([
    [PLAN_CHOICES[0], 'acceptEdits'],
    [PLAN_CHOICES[1], 'default'],
  ] as const)('switches modes after %s', async (value, mode) => {
    const loaded = load({}, { value });
    loaded.state.mode = 'plan';
    await expect(loaded.submitPlan()).resolves.toMatchObject({ details: { status: 'approved', mode } });
    expect(loaded.requests).toEqual([{ kind: 'plan', toolCallId: 'call-2', title: 'Date helper' }]);
    expect(loaded.state.mode).toBe(mode);
  });

  it.each([{ value: PLAN_CHOICES[2] }, { cancelled: true }])('stops to wait for plan feedback on %o', async (reply) => {
    const loaded = load({}, reply);
    loaded.state.mode = 'plan';
    await expect(loaded.submitPlan()).resolves.toMatchObject({ details: { status: 'keep' }, terminate: true });
    expect(loaded.state.mode).toBe('plan');
  });

  it('switches to accept-edits mode when the user always allows an edit', async () => {
    const loaded = load({}, { value: 'Always allow' });
    loaded.state.mode = 'default';
    await expect(loaded.call({ path: 'date.ts' }, 'edit')).resolves.toBeUndefined();
    expect(loaded.requests).toHaveLength(1);
    expect(loaded.state.mode).toBe('acceptEdits');
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
