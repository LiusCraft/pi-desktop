// @vitest-environment jsdom
import './renderer-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { produce } from 'immer';
import { describe, expect, it, vi } from 'vitest';
import { encodePeerMessage, SEND_MESSAGE_TOOL } from '../src/shared/peer-message';
import { TASK_NOTIFICATION_TYPE } from '../src/shared/task-message';
import type { AgentMessage, SessionMeta } from '../src/shared/protocol';
import { TooltipProvider } from '../src/renderer/src/components/ui/tooltip';
import { applyPiEvent, emptySession, replay } from '../src/renderer/src/store/transcript';
import type { SessionView, Todo } from '../src/renderer/src/store/types';

const { Transcript } = await import('../src/renderer/src/components/thread/Transcript');
const meta = { id: 's1', cwd: '/p', title: 'Main', kind: 'code' } as SessionMeta;
const args = { session_id: 'other', message: 'Please check the dates.' };
const received = { role: 'user', content: encodePeerMessage({ id: 'other', title: 'Beta' }, 'Dates checked.') };
const event = {
  role: 'custom',
  customType: TASK_NOTIFICATION_TYPE,
  content:
    '<task-notification id="bg" status="done">\nBuild finished.\nAll checks passed.\n\nLast output:\nDetailed log.\n</task-notification>',
  display: true,
};
const reply = {
  role: 'assistant',
  content: [{ type: 'toolCall', id: 'send', name: SEND_MESSAGE_TOOL, arguments: args }],
};
const result = { role: 'toolResult', toolName: SEND_MESSAGE_TOOL, toolCallId: 'send', details: { outcome: 'queued' } };

describe('session traffic in the normal transcript', () => {
  it.each(['live', 'history'])(
    'shows both message directions and keeps the full task report behind its preview (%s)',
    (mode) => {
      const s = emptySession(meta);
      if (mode === 'live') {
        applyPiEvent(
          s,
          { type: 'tool_execution_start', toolCallId: 'send', toolName: SEND_MESSAGE_TOOL, args },
          'normal',
        );
        applyPiEvent(
          s,
          { type: 'tool_execution_end', toolCallId: 'send', toolName: SEND_MESSAGE_TOOL, result },
          'normal',
        );
        for (const message of [received, event]) applyPiEvent(s, { type: 'message_end', message }, 'normal');
      } else replay(s, [reply, result, received, event], 'normal');
      render(<Transcript s={s} />, { wrapper: TooltipProvider });
      for (const text of [
        'To session “other”',
        args.message,
        'Queued',
        'From session “Beta”',
        'Dates checked.',
        'Background task notification',
        'Build finished. All checks passed.',
      ])
        expect(screen.getAllByText(text)).toHaveLength(1);
      expect(screen.queryByText(/Detailed log/)).toBeNull();
      const show = screen.getByRole('button', { name: 'Show full notification', expanded: false });
      fireEvent.click(show);
      expect(screen.getByText(/Detailed log/).textContent).toBe(
        'Build finished.\nAll checks passed.\n\nLast output:\nDetailed log.',
      );
      fireEvent.click(screen.getByRole('button', { name: 'Hide details', expanded: true }));
      expect(screen.queryByText(/Detailed log/)).toBeNull();
      expect(screen.queryByText(/<task-notification|<session-message|pidesk_send_message/)).toBeNull();
    },
  );

  it('shows progress snapshots on either side of the intervening assistant message', () => {
    const s = emptySession(meta);
    const toolName = 'pidesk_todo_write';
    const inspecting = [{ content: 'Inspect', status: 'in_progress', activeForm: 'Inspecting' }];
    const inspected = [{ content: 'Inspect', status: 'completed' }];
    replay(
      s,
      [
        { role: 'toolResult', toolCallId: 'first', toolName, details: { todos: inspecting } },
        { role: 'assistant', content: [{ type: 'text', text: 'Found the issue.' }] },
        { role: 'toolResult', toolCallId: 'second', toolName, details: { todos: inspected } },
        { role: 'toolResult', toolCallId: 'failed', toolName, isError: true, details: { todos: [] } },
      ],
      'normal',
    );
    expect(s.lastTodos).toEqual(inspected);
    expect(s.items.filter((i) => i.kind !== 'foot').map((i) => i.kind)).toEqual(['todos', 'text', 'todos']);
    render(<Transcript s={s} />, { wrapper: TooltipProvider });
    expect(screen.getByText('Inspecting')).toBeTruthy();
    expect(screen.getByText('Inspect')).toBeTruthy();
  });

  it('refreshes consecutive live todo updates in the same card without stale rows', () => {
    const toolName = 'pidesk_todo_write';
    const update = (s: SessionView, id: string, todos: Todo[]) =>
      produce(s, (draft) => {
        applyPiEvent(draft, { type: 'tool_execution_start', toolCallId: id, toolName, args: { todos } }, 'normal');
        applyPiEvent(
          draft,
          { type: 'tool_execution_end', toolCallId: id, toolName, result: { details: { todos } } },
          'normal',
        );
      });
    let s = update(emptySession(meta), 'first', [
      { content: 'Inspect', status: 'in_progress', activeForm: 'Inspecting' },
      { content: 'Old step', status: 'pending' },
    ]);
    const first = s.items[0];
    const { container, rerender } = render(<Transcript s={s} />, { wrapper: TooltipProvider });
    const card = container.querySelector('[data-item-key]');
    expect(screen.getByText('Inspecting')).toBeTruthy();

    const latest: Todo[] = [
      { content: 'Inspect', status: 'completed' },
      { content: 'Verify', status: 'in_progress', activeForm: 'Verifying' },
    ];
    s = update(s, 'second', latest);
    rerender(<Transcript s={s} />);
    expect(s.items).toEqual([{ ...first, items: latest }]);
    expect(s.lastTodos).toEqual(latest);
    expect(container.querySelectorAll('[data-item-key]')).toHaveLength(1);
    expect(container.querySelector('[data-item-key]')).toBe(card);
    expect(screen.queryByText('Inspecting')).toBeNull();
    expect(screen.queryByText('Old step')).toBeNull();
    expect(screen.getByText('Inspect').parentElement?.className).toContain('line-through');
    expect(screen.getByText('Verifying')).toBeTruthy();

    s = update(
      s,
      'third',
      latest.map((todo) => ({ ...todo, status: 'completed' })),
    );
    rerender(<Transcript s={s} />);
    expect(container.querySelector('[data-item-key]')).toBe(card);
    expect(container.querySelectorAll('[data-item-key]')).toHaveLength(1);
    expect(screen.queryByText('Verifying')).toBeNull();
    expect(screen.getByText('Verify').parentElement?.className).toContain('line-through');
  });

  it.each(['normal', 'verbose'] as const)('replays consecutive todo calls as one latest list (%s)', (view) => {
    const toolName = 'pidesk_todo_write';
    const first: Todo[] = [{ content: 'Inspect', status: 'in_progress', activeForm: 'Inspecting' }];
    const latest: Todo[] = [{ content: 'Inspect', status: 'completed' }];
    const s = emptySession(meta);
    replay(
      s,
      [first, latest, latest].flatMap((todos, index): AgentMessage[] => [
        {
          role: 'assistant',
          content: [{ type: 'toolCall', id: `${index}`, name: toolName, arguments: { todos } }],
        },
        { role: 'toolResult', toolCallId: `${index}`, toolName, details: { todos } },
      ]),
      view,
    );
    expect(s.items.filter((i) => i.kind !== 'foot')).toEqual([
      { kind: 'todos', key: expect.any(String), items: latest },
    ]);
    expect(s.lastTodos).toEqual(latest);
    render(<Transcript s={s} />, { wrapper: TooltipProvider });
    expect(screen.queryByText('Inspecting')).toBeNull();
    expect(screen.getAllByText('Inspect')).toHaveLength(1);
  });

  it.each([
    { role: 'assistant', content: [{ type: 'text', text: 'Found the issue.' }] },
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'Check the next step.' }] },
    { role: 'assistant', content: [{ type: 'toolCall', id: 'read', name: 'read', arguments: { path: 'a.ts' } }] },
    { role: 'user', content: 'Continue.' },
    { role: 'custom', customType: 'notice', display: true, content: 'A notification.' },
    { role: 'compactionSummary', summary: 'Earlier work.', tokensBefore: 1000 },
  ] satisfies AgentMessage[])('keeps todo snapshots separated by $role content', (between) => {
    const toolName = 'pidesk_todo_write';
    const first: Todo[] = [{ content: 'Inspect', status: 'in_progress' }];
    const latest: Todo[] = [{ content: 'Inspect', status: 'completed' }];
    const s = emptySession(meta);
    replay(
      s,
      [
        { role: 'toolResult', toolCallId: 'first', toolName, details: { todos: first } },
        between,
        { role: 'toolResult', toolCallId: 'second', toolName, details: { todos: latest } },
      ],
      'normal',
    );
    expect(s.items.filter((i) => i.kind === 'todos').map((i) => i.items)).toEqual([first, latest]);
    expect(s.lastTodos).toEqual(latest);
  });

  it.each([{ isError: true, details: { todos: [] } }, { details: undefined }, { details: { todos: 'invalid' } }])(
    'ignores failed or malformed todo updates without replacing the visible list: %j',
    (result) => {
      const toolName = 'pidesk_todo_write';
      const todos: Todo[] = [{ content: 'Inspect', status: 'in_progress' }];
      const s = emptySession(meta);
      applyPiEvent(
        s,
        { type: 'tool_execution_end', toolCallId: 'first', toolName, result: { details: { todos } } },
        'normal',
      );
      const card = s.items[0];
      applyPiEvent(
        s,
        {
          type: 'tool_execution_end',
          toolCallId: 'invalid',
          toolName,
          isError: result.isError,
          result: { details: result.details },
        },
        'normal',
      );
      expect(s.items).toEqual([card]);
      expect(s.lastTodos).toEqual(todos);
    },
  );

  it('leaves a short notification readable without a redundant disclosure', () => {
    const s = emptySession(meta);
    replay(
      s,
      [{ ...event, content: '<task-notification id="bg" status="done">\nDone.\n</task-notification>' }],
      'normal',
    );
    render(<Transcript s={s} />, { wrapper: TooltipProvider });
    expect(screen.getByText('Done.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show full notification' })).toBeNull();
  });

  it('offers the full text when a single line wraps beyond the two-line preview', () => {
    // jsdom has no layout: model an overflowing clamped preview in a narrow pane.
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(60);
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(40);
    const s = emptySession(meta);
    replay(s, [{ ...event, content: 'A long unbroken log line' }], 'normal');
    render(<Transcript s={s} />, { wrapper: TooltipProvider });
    fireEvent.click(screen.getByRole('button', { name: 'Show full notification', expanded: false }));
    expect(screen.getByRole('button', { name: 'Hide details', expanded: true })).toBeTruthy();
  });

  it.each(['live', 'history'])('shows a failed nested send as failed, not delivered (%s)', (mode) => {
    const s = emptySession(meta);
    const id = 'script/1';
    const error = 'No such session';
    if (mode === 'live') {
      const call = { toolCallId: id, parentToolCallId: 'script', toolName: SEND_MESSAGE_TOOL };
      applyPiEvent(s, { ...call, type: 'tool_execution_start', args }, 'normal');
      applyPiEvent(s, { ...call, type: 'tool_execution_end', result: { content: error }, isError: true }, 'normal');
    } else {
      const message: AgentMessage = {
        role: 'toolResult',
        toolName: 'codemode',
        toolCallId: 'script',
        nestedCalls: { calls: [{ id, name: SEND_MESSAGE_TOOL, arguments: args, status: 'error', error }] },
      };
      replay(s, [message], 'normal');
    }
    render(<Transcript s={s} />, { wrapper: TooltipProvider });
    expect(screen.getByText(args.message)).toBeTruthy();
    expect(screen.getByText('Send failed: No such session')).toBeTruthy();
    expect(screen.queryByText('Sent')).toBeNull();
  });
});
