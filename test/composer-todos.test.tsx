// @vitest-environment jsdom
import './renderer-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { SessionView } from '../src/renderer/src/store/types';

const { ComposerTodos } = await import('../src/renderer/src/components/composer/ComposerTodos');

it('shows the current tasks and updates the count without reopening a collapsed card', () => {
  const { rerender } = render(<ComposerTodos items={[]} />);
  expect(screen.queryByRole('button')).toBeNull();

  const items: SessionView['lastTodos'] = [
    { content: 'Verify the change', status: 'in_progress', activeForm: 'Verifying the change' },
    { content: 'Review the result', status: 'pending' },
  ];
  rerender(<ComposerTodos items={items} />);
  const tasks = screen.getByRole('button', { name: 'Tasks 2 remaining' });
  expect(tasks.getAttribute('aria-expanded')).toBe('true');
  expect(within(screen.getByRole('list')).getByText('Verifying the change')).toBeTruthy();
  fireEvent.click(tasks);
  expect(tasks.getAttribute('aria-expanded')).toBe('false');

  rerender(<ComposerTodos items={[{ ...items[0], status: 'completed' }, items[1]]} />);
  expect(screen.getByRole('button', { name: 'Tasks 1 remaining' })).toBe(tasks);
  expect(tasks.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('list')).toBeNull();

  fireEvent.click(tasks);
  expect(within(screen.getByRole('list')).getByText('Verify the change')).toBeTruthy();
  rerender(<ComposerTodos items={items.map((item) => ({ ...item, status: 'completed' }))} />);
  expect(screen.getByRole('button', { name: 'Tasks All done' })).toBe(tasks);
  rerender(<ComposerTodos items={[]} />);
  expect(screen.queryByRole('button')).toBeNull();
});
