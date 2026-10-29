// How suggested tasks and messages from other sessions reach the transcript.
import { describe, expect, it } from 'vitest';
import { decodePeerMessage, encodePeerMessage, isPeerMessage } from '../src/shared/peer-message';
import type { SessionMeta } from '../src/shared/protocol';
import { applyPiEvent, emptySession, replay } from '../src/renderer/src/store/transcript';

const meta = { id: 's1', title: 'Main', kind: 'code', projectPath: '/p', cwd: '/p' } as SessionMeta;

describe('peer messages', () => {
  it('round-trips and names the sender', () => {
    const wire = encodePeerMessage({ id: 'abc', title: 'Fix "dates"\nnow' }, '第一行\n第二行');
    expect(isPeerMessage(wire)).toBe(true);
    expect(decodePeerMessage(wire)).toEqual({ fromId: 'abc', fromTitle: 'Fix dates now', text: '第一行\n第二行' });
  });

  it('tells the receiving model the sender is a peer, not the user', () => {
    expect(encodePeerMessage({ id: 'a', title: 't' }, 'hi')).toMatch(/not by the user/);
  });

  it('leaves ordinary text alone', () => {
    expect(decodePeerMessage('hello <session-message>')).toBeNull();
    expect(isPeerMessage('hello')).toBe(false);
  });
});

describe('suggested tasks in the transcript', () => {
  const tasks = [
    { title: 'Add a test', prompt: 'Write a test for formatDate' },
    { title: 'Fix typo', prompt: 'README says teh' },
  ];

  it('shows one card per suggestion call, from the call’s arguments', () => {
    const s = emptySession(meta);
    applyPiEvent(
      s,
      { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'pidesk_suggest_task', args: { tasks } },
      'normal',
    );
    applyPiEvent(
      s,
      {
        type: 'tool_execution_end',
        toolCallId: 'c1',
        toolName: 'pidesk_suggest_task',
        result: { content: [{ type: 'text', text: 'ok' }], details: { tasks } },
      },
      'normal',
    );
    expect(s.items.filter((i) => i.kind === 'suggest')).toEqual([
      { kind: 'suggest', key: expect.any(String), toolCallId: 'c1', tasks },
    ]);
    expect(
      s.items.some((i) => i.kind === 'group'),
      'not a generic tool row',
    ).toBe(false);
  });

  it('ignores malformed suggestions instead of drawing an empty card', () => {
    const s = emptySession(meta);
    applyPiEvent(
      s,
      {
        type: 'tool_execution_start',
        toolCallId: 'c2',
        toolName: 'pidesk_suggest_task',
        args: { tasks: [{ title: 'no prompt' }] },
      },
      'normal',
    );
    expect(s.items).toEqual([]);
  });

  it('comes back when the session is reopened', () => {
    const s = emptySession(meta);
    replay(
      s,
      [
        {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'c3', name: 'pidesk_suggest_task', arguments: { tasks } }],
        },
        {
          role: 'toolResult',
          toolCallId: 'c3',
          toolName: 'pidesk_suggest_task',
          content: [{ type: 'text', text: 'ok' }],
          details: { tasks },
        },
      ],
      'normal',
    );
    expect(s.items.find((i) => i.kind === 'suggest')).toMatchObject({ toolCallId: 'c3', tasks });
  });
});

describe('messages from another session', () => {
  it('arrive as user items whose text still decodes to the sender', () => {
    const s = emptySession(meta);
    const wire = encodePeerMessage({ id: 'other', title: 'Beta' }, 'status?');
    applyPiEvent(s, { type: 'message_end', message: { role: 'user', content: wire, timestamp: 1 } }, 'normal');
    const user = s.items.find((i) => i.kind === 'user');
    expect(user && decodePeerMessage(user.text)).toMatchObject({ fromId: 'other', text: 'status?' });
  });
});
