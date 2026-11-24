// @vitest-environment jsdom
import { invoke } from './renderer-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { normalizePrBar, type PrBarSettings } from '../src/shared/pr-bar-settings';

const { SettingsApp } = await import('../src/renderer/src/settings/SettingsApp');

it('saves PR Bar placement, automation limits, and bounded refresh intervals independently', async () => {
  const url = location.href;
  history.replaceState(null, '', '#code');
  let prBar = normalizePrBar({ idleSeconds: 360 });
  invoke.mockImplementation(async (channel, patch) => {
    if (channel === 'settings:set') {
      const { prBar: change } = patch as { prBar: Partial<PrBarSettings> };
      prBar = normalizePrBar({ ...prBar, ...change });
    }
    if (channel === 'settings:get' || channel === 'settings:set') return { prBar, locale: 'en' };
    return channel === 'app:info' ? null : [];
  });
  const { unmount } = render(<SettingsApp />);
  const enabled = () => screen.getByRole('switch', { name: 'Enable PR Bar' });
  const inactive = () => screen.getByRole('switch', { name: 'Refresh PRs for unopened sessions' });
  const option = () => screen.getByText('Session overview only', { exact: true });
  try {
    const idle = screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Unopened sessions' });
    await waitFor(() => expect(idle.value).toBe('360'));
    expect(enabled().getAttribute('aria-checked')).toBe('true');
    fireEvent.click(option());
    await waitFor(() => expect(option().getAttribute('aria-checked')).toBe('true'));
    expect(invoke).toHaveBeenLastCalledWith('settings:set', { prBar: { placement: 'overview' } });

    const comments = screen.getByRole('switch', { name: 'Address review comments' });
    fireEvent.click(comments);
    await waitFor(() => expect(comments.getAttribute('aria-checked')).toBe('false'));
    expect(invoke).toHaveBeenLastCalledWith('settings:set', { prBar: { addressComments: false } });
    expect(screen.getByRole('switch', { name: 'Fix failed CI' }).getAttribute('aria-checked')).toBe('true');

    const fast = screen.getByRole<HTMLInputElement>('spinbutton', { name: 'CI in progress' });
    fireEvent.change(fast, { target: { value: '90' } });
    fireEvent.keyDown(fast, { key: 'Enter' });
    const slow = screen.getByRole<HTMLInputElement>('spinbutton', { name: 'CI settled' });
    await waitFor(() => expect(slow.value).toBe('90'));
    expect(invoke).toHaveBeenLastCalledWith('settings:set', { prBar: { fastSeconds: 90 } });
    expect(slow.min).toBe('90');

    fireEvent.click(inactive());
    await waitFor(() => expect(screen.queryByRole('spinbutton', { name: 'Unopened sessions' })).toBeNull());
    expect(invoke).toHaveBeenLastCalledWith('settings:set', { prBar: { watchInactive: false } });
    fireEvent.click(enabled());
    await waitFor(() => expect(enabled().getAttribute('aria-checked')).toBe('false'));
    expect(screen.queryByText('Session overview only', { exact: true })).toBeNull();
    fireEvent.click(enabled());
    await waitFor(() => expect(option().getAttribute('aria-checked')).toBe('true'));
    expect(prBar).toMatchObject({
      placement: 'overview',
      addressComments: false,
      fastSeconds: 90,
      watchInactive: false,
    });
  } finally {
    unmount();
    history.replaceState(null, '', url);
  }
});
