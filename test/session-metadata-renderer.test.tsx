// @vitest-environment jsdom
import { invoke } from './renderer-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { SessionMeta } from '@shared/protocol';

const { Sidebar } = await import('../src/renderer/src/components/layout/Sidebar');
const { TooltipProvider } = await import('../src/renderer/src/components/ui/tooltip');
const { handleHostEvent } = await import('../src/renderer/src/store/actions');
const { setApp } = await import('../src/renderer/src/store/app');

it('updates the open sidebar and toggles automatic updates through the host', async () => {
  const meta: SessionMeta = {
    id: 'summarized-session',
    kind: 'work',
    title: 'Trace login redirect',
    description: 'Looking for the cache key',
    autoName: true,
    titleLocked: false,
    autoNamed: false,
    nameAttempted: true,
    projectPath: '/work',
    cwd: '/work',
    branch: null,
    baseBranch: null,
    baseCommit: null,
    worktree: false,
    mode: 'auto',
    outputStyle: 'default',
    sessionFile: null,
    createdAt: 1,
    updatedAt: Date.now(),
    pr: null,
  };
  setApp((state) => {
    state.view = 'work';
    state.sessions = {};
  });
  render(
    <TooltipProvider>
      <Sidebar />
    </TooltipProvider>,
  );
  handleHostEvent({ type: 'meta', sessionId: meta.id, meta });
  await screen.findByText('Looking for the cache key');
  const updated = { ...meta, title: 'Repair login redirect', description: 'Cache key fixed; tests pass' };
  handleHostEvent({ type: 'meta', sessionId: meta.id, meta: updated });
  await screen.findByText(updated.description);
  expect(screen.queryByText('Looking for the cache key')).toBeNull();
  expect(screen.getByRole('button', { name: updated.title })).toBeTruthy();

  invoke.mockImplementation(async (channel) => {
    if (channel === 'sessions:update') {
      handleHostEvent({ type: 'meta', sessionId: meta.id, meta: { ...updated, autoUpdateMetadata: false } });
    }
  });
  fireEvent.contextMenu(screen.getByRole('button', { name: updated.title }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Pause title & description updates' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('sessions:update', meta.id, { autoUpdateMetadata: false }));
  fireEvent.contextMenu(screen.getByRole('button', { name: updated.title }));
  await screen.findByRole('menuitem', { name: 'Resume title & description updates' });
});
