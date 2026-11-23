// @vitest-environment jsdom
import './renderer-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { ScriptToolResult, SessionMeta } from '@shared/protocol';
import { GroupItem } from '@/components/thread/Items';
import { getApp, setApp, useApp } from '@/store/app';
import { applyPiEvent, emptySession, replay } from '@/store/transcript';

const meta = { id: 'script-rows', cwd: '/project', title: 'Test', kind: 'code' } as SessionMeta;
const script = { toolCallId: 'script', toolName: 'codemode', args: { code: 'return 42;' } };
const read: ScriptToolResult = {
  parentToolCallId: 'script',
  toolCallId: 'script/1',
  toolName: 'read',
  args: { path: 'sample.txt', offset: 3, limit: 1 },
  result: { content: [{ type: 'text', text: 'before-line' }] },
  isError: false,
};
const edit: ScriptToolResult = {
  ...read,
  toolCallId: 'script/2',
  toolName: 'edit',
  args: { path: 'sample.txt' },
  result: { content: [], details: { diff: '-3 before-line\n+3 after-line', firstChangedLine: 3 } },
};
const result = {
  content: [{ type: 'text', text: 'Script completed\nWall time 0.3 seconds\nOutput:\nScript output' }],
  details: {
    calls: [
      { id: read.toolCallId, name: 'read', args: 'read preview', status: 'ok' },
      { id: edit.toolCallId, name: 'edit', args: 'edit preview', status: 'ok' },
      { id: 'script/model', name: 'models.classify', status: 'ok' },
    ],
  },
};

afterEach(() => {
  if (getApp().sessions[meta.id]) setApp((state) => void delete state.sessions[meta.id]);
});

it.each(['live', 'history'])('shows Codemode file operations as ordinary expandable tool rows (%s)', (mode) => {
  const s = emptySession(meta);
  if (mode === 'live') {
    applyPiEvent(s, { type: 'tool_execution_start', ...script }, 'normal');
    for (const row of [read, edit]) {
      applyPiEvent(s, { type: 'tool_execution_start', ...row }, 'normal');
      applyPiEvent(s, { type: 'tool_execution_end', ...row }, 'normal');
    }
    applyPiEvent(s, { type: 'tool_execution_end', ...script, result }, 'normal');
  } else {
    replay(
      s,
      [
        {
          role: 'assistant',
          content: [{ type: 'toolCall', id: script.toolCallId, name: script.toolName, arguments: script.args }],
          scriptTools: [read, edit],
        },
        { role: 'toolResult', ...script, ...result },
      ],
      'normal',
    );
  }
  setApp((state) => {
    state.sessions[meta.id] = s;
  });
  function Group() {
    const group = useApp((state) => state.sessions[meta.id]?.items.find((item) => item.kind === 'group'));
    return group ? <GroupItem sid={meta.id} item={group} view="normal" /> : null;
  }
  render(<Group />);
  const summary = screen.getByTitle('Read a file, edited a file');
  expect(within(summary).getByText('+1')).toBeTruthy();
  expect(within(summary).getByText('−1')).toBeTruthy();
  fireEvent.click(summary);
  expect(screen.getAllByTitle('Open current file: sample.txt')).toHaveLength(2);
  expect(screen.getByTitle('L3–3')).toBeTruthy();
  fireEvent.click(screen.getByTitle('Read sample.txt'));
  expect(screen.getByText('before-line')).toBeTruthy();
  fireEvent.click(screen.getByTitle('Edited sample.txt'));
  expect(screen.getByText('after-line')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'View diff' })).toBeTruthy();
  fireEvent.click(screen.getByTitle('Ran script: read, edit, models.classify'));
  expect(screen.getByText('Script output')).toBeTruthy();
  expect(screen.getByText('models.classify')).toBeTruthy();
  expect(screen.queryByText('edit preview')).toBeNull();
});
