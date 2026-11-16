import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveLocale } from '../src/shared/i18n/runtime';
import type { SessionMeta } from '../src/shared/protocol';
import { applyPiEvent, emptySession, settle } from '../src/renderer/src/store/transcript';

const meta = { id: 's1', title: 'Main', kind: 'code', projectPath: '/p', cwd: '/p' } as SessionMeta;

describe('stream token rate', () => {
  beforeEach(() => {
    setActiveLocale('en');
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => vi.useRealTimers());

  it('accumulates assistant stream tokens across the whole session request', () => {
    const s = emptySession(meta);
    applyPiEvent(s, { type: 'agent_start' }, 'normal');

    vi.setSystemTime(10_000);
    applyPiEvent(s, { type: 'message_start', message: { role: 'assistant' } }, 'normal');
    vi.setSystemTime(10_500);
    applyPiEvent(s, { type: 'message_update', assistantMessageEvent: { type: 'thinking_start' } }, 'normal');
    vi.setSystemTime(11_500);
    applyPiEvent(
      s,
      { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'x'.repeat(300) } },
      'normal',
    );
    vi.setSystemTime(12_500);
    applyPiEvent(
      s,
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'x'.repeat(300) } },
      'normal',
    );
    vi.setSystemTime(13_500);
    applyPiEvent(
      s,
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'x'.repeat(300) }],
          usage: { output: 200 },
        },
      },
      'normal',
    );

    expect(s.tokens).toBe(200);
    expect(s.streamTokens).toBe(200);

    vi.setSystemTime(14_000);
    applyPiEvent(
      s,
      { type: 'tool_execution_start', toolCallId: 'tool-1', toolName: 'bash', args: { command: 'sleep 10' } },
      'normal',
    );
    vi.setSystemTime(23_000);
    applyPiEvent(
      s,
      { type: 'tool_execution_end', toolCallId: 'tool-1', toolName: 'bash', result: { content: 'done' } },
      'normal',
    );
    vi.setSystemTime(23_500);
    settle(s, false, 'normal');
    const foot = s.items.at(-1);
    expect(s.sessionTokens).toBe(200);
    expect(s.sessionStreamMs).toBe(3_000);
    expect(foot).toMatchObject({ kind: 'foot', usage: '24s · 200 tokens' });
  });
});
