// @vitest-environment jsdom
import { invoke } from './renderer-dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import type { SessionMeta } from '../src/shared/protocol';
import type { SessionView } from '../src/renderer/src/store/types';

const { ComposerTodos } = await import('../src/renderer/src/components/composer/ComposerTodos');
const { WorkPanel } = await import('../src/renderer/src/components/workspace/Panels');
const { emptySession } = await import('../src/renderer/src/store/transcript');
const { setApp } = await import('../src/renderer/src/store/app');

const items: SessionView['lastTodos'] = [
  { content: 'Verify the change', status: 'in_progress', activeForm: 'Verifying the change' },
  { content: 'Review the result', status: 'pending' },
];

beforeEach(() => {
  setApp((s) => void (s.settings = {}));
  invoke.mockResolvedValue(undefined);
});

it('starts collapsed and updates the summary without opening on task changes', () => {
  const { rerender } = render(<ComposerTodos items={[]} />);
  expect(screen.queryByRole('button')).toBeNull();

  rerender(<ComposerTodos items={items} />);
  const tasks = screen.getByRole('button', { name: 'Tasks 2 remaining', expanded: false });
  expect(screen.queryByRole('list')).toBeNull();

  rerender(<ComposerTodos items={[{ ...items[0], status: 'completed' }, items[1]]} />);
  expect(screen.getByRole('button', { name: 'Tasks 1 remaining', expanded: false })).toBe(tasks);
  rerender(<ComposerTodos items={items.map((item) => ({ ...item, status: 'completed' }))} />);
  expect(screen.getByRole('button', { name: 'Tasks All done', expanded: false })).toBe(tasks);
  expect(screen.queryByRole('list')).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
});

it('saves both choices as an app preference and uses it when the checklist remounts', () => {
  const { unmount } = render(<ComposerTodos items={items} />);
  fireEvent.click(screen.getByRole('button', { name: 'Tasks 2 remaining', expanded: false }));
  expect(invoke).toHaveBeenLastCalledWith('settings:set', { todosExpanded: true });
  // Apply the main process's settings update as App does on settings:changed.
  act(() => setApp((s) => void (s.settings.todosExpanded = true)));
  expect(within(screen.getByRole('list')).getByText('Verifying the change')).toBeTruthy();
  unmount();

  const session = emptySession({ id: 'other-session', cwd: '/work', mode: 'auto', kind: 'work' } as SessionMeta);
  session.lastTodos = [items[1]];
  render(
    <>
      <ComposerTodos items={session.lastTodos} />
      <WorkPanel s={session} />
    </>,
  );
  const tasks = screen.getByRole('button', { name: 'Tasks 1 remaining', expanded: true });
  const progress = screen.getByRole('button', { name: 'Progress 0/1', expanded: true });
  fireEvent.click(progress);
  expect(invoke).toHaveBeenLastCalledWith('settings:set', { todosExpanded: false });
  act(() => setApp((s) => void (s.settings.todosExpanded = false)));
  expect(tasks.getAttribute('aria-expanded')).toBe('false');
  expect(progress.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('list')).toBeNull();
});
