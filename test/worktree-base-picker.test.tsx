// @vitest-environment jsdom
import './renderer-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';

const { WorktreeBasePicker } = await import('../src/renderer/src/components/composer/WorktreeBasePicker');
const { useApp } = await import('../src/renderer/src/store/app');

it('filters worktree bases, selects with the keyboard and resets the search on reopen', async () => {
  useApp.setState({ projectBranches: ['origin/main', 'main', 'feature/Release'], baseRef: 'origin/main' });
  render(<WorktreeBasePicker branch="main" />);
  const trigger = screen.getByRole('button', { name: 'origin/main' });
  fireEvent.click(trigger);
  const search = await screen.findByRole('combobox');
  await waitFor(() => expect(document.activeElement).toBe(search));
  expect(screen.getAllByRole('option').map((item) => item.title)).toEqual(['main', 'origin/main', 'feature/Release']);
  expect(screen.getByTitle('main').textContent).toContain('current');

  fireEvent.change(search, { target: { value: 'nonexistent' } });
  expect(await screen.findByText('No matching branches')).toBeTruthy();
  expect(useApp.getState().baseRef).toBe('origin/main');
  fireEvent.change(search, { target: { value: 'release' } });
  expect(screen.getByRole('option').title).toBe('feature/Release');
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(useApp.getState().baseRef).toBe('feature/Release');
  await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
  expect(trigger.textContent).toBe('feature/Release');

  fireEvent.click(trigger);
  expect((await screen.findByRole<HTMLInputElement>('combobox')).value).toBe('');
  fireEvent.click(screen.getByTitle('main'));
  expect(useApp.getState().baseRef).toBe('main');
});
