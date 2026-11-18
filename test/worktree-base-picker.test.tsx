// @vitest-environment jsdom
import './renderer-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const { WorktreeBasePicker } = await import('../src/renderer/src/components/composer/WorktreeBasePicker');

it('filters worktree bases, selects with the keyboard and resets the search on reopen', async () => {
  const props = {
    branch: 'main',
    branches: ['origin/main', 'main', 'feature/Release'],
    onSelect: vi.fn<(ref: string) => void>(),
  };
  const { rerender } = render(<WorktreeBasePicker {...props} base="origin/main" />);
  const trigger = screen.getByRole('button', { name: 'origin/main' });
  fireEvent.click(trigger);
  const search = await screen.findByRole('combobox');
  await waitFor(() => expect(document.activeElement).toBe(search));
  expect(screen.getAllByRole('option').map((item) => item.title)).toEqual(['main', 'origin/main', 'feature/Release']);
  expect(screen.getByTitle('main').textContent).toContain('current');

  fireEvent.change(search, { target: { value: 'nonexistent' } });
  expect(await screen.findByText('No matching branches')).toBeTruthy();
  expect(props.onSelect).not.toHaveBeenCalled();
  fireEvent.change(search, { target: { value: 'release' } });
  expect(screen.getByRole('option').title).toBe('feature/Release');
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(props.onSelect).toHaveBeenCalledWith('feature/Release');
  rerender(<WorktreeBasePicker {...props} base="feature/Release" />);
  await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
  expect(trigger.textContent).toBe('feature/Release');

  fireEvent.click(trigger);
  expect((await screen.findByRole<HTMLInputElement>('combobox')).value).toBe('');
  fireEvent.click(screen.getByTitle('main'));
  expect(props.onSelect).toHaveBeenLastCalledWith('main');
});
