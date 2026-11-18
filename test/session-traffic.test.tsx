// @vitest-environment jsdom
import './renderer-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { encodePeerMessage, SEND_MESSAGE_TOOL } from '../src/shared/peer-message';
import { TASK_NOTIFICATION_TYPE } from '../src/shared/task-message';
import type { AgentMessage, SessionMeta } from '../src/shared/protocol';
import { TooltipProvider } from '../src/renderer/src/components/ui/tooltip';
import { applyPiEvent, emptySession, replay } from '../src/renderer/src/store/transcript';

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
