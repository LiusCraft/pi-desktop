import { describe, expect, it, vi } from 'vitest';
import { createDesktopKit, type KitHost, isPrAutomationCommand } from '../src/agent/desktop-kit';
import type { UiResponse } from '../src/shared/protocol';

type Review = NonNullable<KitHost['review']>;

function load(overrides: Partial<KitHost> = {}) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const requests: unknown[] = [];
  const state = {
    mode: 'auto',
    profile: 'code',
    outputStyle: 'default',
    allowed: new Set<string>(),
  } as KitHost['state'];
  const pi = {
    on: (event: string, handler: (...args: any[]) => any) => handlers.set(event, handler),
    getAllTools: () => [],
    registerTool: () => {},
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
    call: (input: Record<string, unknown>) =>
      handlers.get('tool_call')?.(
        { toolName: 'bash', toolCallId: 'call-1', input },
        { cwd: process.cwd(), signal: undefined },
      ),
  };
}

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
