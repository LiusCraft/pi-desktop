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

  it('shows a card only after success, using the host’s normalized tasks', () => {
    const s = emptySession(meta);
    const returnedTasks = tasks.map((task) => ({ ...task, codeFolder: '/p' }));
    applyPiEvent(
      s,
      {
        type: 'tool_execution_start',
        toolCallId: 'c1',
        toolName: 'pidesk_suggest_task',
        args: { tasks: tasks.map((task) => ({ ...task, code_folder: '/p' })) },
      },
      'normal',
    );
    expect(s.items).toEqual([]);
    applyPiEvent(
      s,
      {
        type: 'tool_execution_end',
        toolCallId: 'c1',
        toolName: 'pidesk_suggest_task',
        result: { content: [{ type: 'text', text: 'ok' }], details: { tasks: returnedTasks } },
      },
      'normal',
    );
    expect(s.items.filter((i) => i.kind === 'suggest')).toEqual([
      { kind: 'suggest', key: expect.any(String), toolCallId: 'c1', tasks: returnedTasks },
    ]);
    expect(
      s.items.some((i) => i.kind === 'group'),
      'not a generic tool row',
    ).toBe(false);
  });

  it.each([undefined, {}, { tasks: [] }, { tasks: {} }, { tasks: [null, { title: 'no prompt' }] }])(
    'ignores missing or malformed result tasks: %j',
    (details) => {
      const s = emptySession(meta);
      applyPiEvent(
        s,
        { type: 'tool_execution_start', toolCallId: 'c2', toolName: 'pidesk_suggest_task', args: { tasks } },
        'normal',
      );
      applyPiEvent(
        s,
        {
          type: 'tool_execution_end',
          toolCallId: 'c2',
          toolName: 'pidesk_suggest_task',
          result: { content: [], details },
        },
        'normal',
      );
      expect(s.items).toEqual([]);
    },
  );

  it.each([undefined, { tasks }])('hides a failed call and shows only its successful retry: %j', (details) => {
    const s = emptySession(meta);
    applyPiEvent(
      s,
      {
        type: 'tool_execution_start',
        toolCallId: 'failed',
        toolName: 'pidesk_suggest_task',
        args: { tasks: tasks.map((task) => ({ ...task, code_folder: '/unlinked' })) },
      },
      'normal',
    );
    applyPiEvent(
      s,
      {
        type: 'tool_execution_end',
        toolCallId: 'failed',
        toolName: 'pidesk_suggest_task',
        result: {
          content: [{ type: 'text', text: 'This project has no Code folders; leave code_folder out.' }],
          details,
        },
        isError: true,
      },
      'normal',
    );
    expect(s.items).toEqual([]);
    applyPiEvent(
      s,
      { type: 'tool_execution_start', toolCallId: 'retry', toolName: 'pidesk_suggest_task', args: { tasks } },
      'normal',
    );
    applyPiEvent(
      s,
      {
        type: 'tool_execution_end',
        toolCallId: 'retry',
        toolName: 'pidesk_suggest_task',
        result: { content: [{ type: 'text', text: 'ok' }], details: { tasks } },
      },
      'normal',
    );
    expect(s.items).toEqual([{ kind: 'suggest', key: expect.any(String), toolCallId: 'retry', tasks }]);
  });

  it('restores only successful suggestions when the session is reopened', () => {
    const s = emptySession(meta);
    replay(
      s,
      [
        {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'failed', name: 'pidesk_suggest_task', arguments: { tasks } }],
        },
        {
          role: 'toolResult',
          toolCallId: 'failed',
          toolName: 'pidesk_suggest_task',
          content: [{ type: 'text', text: 'Invalid code_folder' }],
          isError: true,
        },
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
    expect(s.items.filter((i) => i.kind === 'suggest')).toEqual([
      { kind: 'suggest', key: expect.any(String), toolCallId: 'c3', tasks },
    ]);
  });

  it('does not restore a suggestion whose call never finished', () => {
    const s = emptySession(meta);
    replay(
      s,
      [
        {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'interrupted', name: 'pidesk_suggest_task', arguments: { tasks } }],
        },
      ],
      'normal',
    );
    expect(s.items.some((i) => i.kind === 'suggest')).toBe(false);
  });
});

describe('messages from another session', () => {
  it('shows queued incoming messages until consumed or cleared, without touching the user draft queue', () => {
    const s = emptySession(meta);
    const wire = encodePeerMessage({ id: 'a', title: 'Alpha' }, 'review?');
    applyPiEvent(s, { type: 'queue_update', followUp: ['user prompt', wire, wire] }, 'normal');
    expect(s.queuedPeers).toEqual(Array(2).fill({ fromId: 'a', fromTitle: 'Alpha', text: 'review?' }));
    expect(s.pendingUser).toEqual([]);
    applyPiEvent(s, { type: 'queue_update', followUp: [] }, 'normal');
    expect(s.queuedPeers).toEqual([]);
  });

  it('arrive as user items whose text still decodes to the sender', () => {
    const s = emptySession(meta);
    const wire = encodePeerMessage({ id: 'other', title: 'Beta' }, 'status?');
    applyPiEvent(s, { type: 'message_end', message: { role: 'user', content: wire, timestamp: 1 } }, 'normal');
    const user = s.items.find((i) => i.kind === 'user');
    expect(user && decodePeerMessage(user.text)).toMatchObject({ fromId: 'other', text: 'status?' });
  });
});
