// @vitest-environment jsdom
import { deferred, invoke } from './renderer-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { SessionMeta } from '../src/shared/protocol';

// Virtualized workspace panels depend on browser layout; they aren't part of the welcome screen.
vi.mock('@/components/workspace/Workspace', () => ({
  openCards: () => ({ primary: [], secondary: [] }),
  soloCard: () => null,
  Workspace: () => null,
}));

const { Main } = await import('../src/renderer/src/components/layout/Main');
const { TooltipProvider } = await import('../src/renderer/src/components/ui/tooltip');
const { getApp, setApp } = await import('../src/renderer/src/store/app');
const { activeDraft, drafts, useDrafts } = await import('../src/renderer/src/store/drafts');
const { selectProject, send, showWelcome } = await import('../src/renderer/src/store/actions');
const { useWelcomeBranches } = await import('../src/renderer/src/store/welcome-branches');

beforeEach(() => {
  useDrafts.setState({ active: null, drafts: {} });
  useWelcomeBranches.setState({}, true);
  setApp((st) => {
    st.view = 'code';
    st.prefs.project = '/project';
    st.prefs.model = 'vendor/known-model';
    st.settings.pet = false;
    st.sessions = {};
  });
  showWelcome();
});

const mount = () =>
  render(
    <TooltipProvider>
      <Main />
    </TooltipProvider>,
  );

it('renders an editable welcome screen before Git responds and revalidates only the selected project’s cache', async () => {
  const remote = deferred<boolean>();
  const a = deferred<string>();
  const b = deferred<string>();
  invoke.mockImplementation(async (channel, project) => {
    if (channel === 'git:refresh') return remote.promise;
    if (channel === 'git:branch') return project === '/project' ? a.promise : b.promise;
    if (channel === 'git:branches') return [];
    return null;
  });
  mount();
  const box = screen.getByRole('textbox');
  expect(screen.getByText('Loading branches…')).toBeTruthy();
  expect(screen.getByText('known-model')).toBeTruthy();
  fireEvent.change(box, { target: { value: 'draft A' } });
  act(() => selectProject('/other'));
  await act(async () => b.resolve('branch-B'));
  expect(screen.getByText('branch-B')).toBeTruthy(); // fetch is still pending
  await act(async () => a.resolve('branch-A'));
  expect(screen.queryByText('branch-A')).toBeNull();
  act(() => selectProject('/project'));
  expect(screen.getByText('branch-A')).toBeTruthy();
  expect(screen.queryByText('Loading branches…')).toBeNull();
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('draft A');
  await act(async () => remote.resolve(false));
});

it.each(['code', 'work'] as const)(
  'shows the first %s message while creating, and restores the draft on failure',
  async (view) => {
    const creation = deferred<SessionMeta>();
    invoke.mockImplementation(async (channel) => {
      if (channel === 'sessions:create') return creation.promise;
      if (channel === 'artifacts:list' || channel === 'git:branches') return [];
      return null;
    });
    setApp((st) => void (st.view = view));
    showWelcome();
    mount();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'First message' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(screen.getByText('First message')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Starting the session…');
    expect(getApp().current).toBeNull();
    await act(async () => creation.reject(new Error('Folder unavailable')));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('First message');
    expect(screen.getByText('Folder unavailable')).toBeTruthy();
    expect(activeDraft()?.sending).toBe(false);
  },
);

it('sends to the real session exactly once without taking the user back after navigation', async () => {
  const creation = deferred<SessionMeta>();
  invoke.mockImplementation(async (channel) => {
    if (channel === 'sessions:create') return creation.promise;
    if (channel === 'sessions:prompt') return { disposition: 'sent' };
    return null;
  });
  drafts.setText(activeDraft()!.key, 'First message');
  const sending = send();
  await send();
  selectProject('/other');
  showWelcome();
  drafts.setText(activeDraft()!.key, 'Keep editing here');
  creation.resolve({ id: 'real-id', kind: 'code', projectPath: '/project' } as SessionMeta);
  await sending;
  expect(getApp().current).toBeNull();
  expect(activeDraft()?.text).toBe('Keep editing here');
  expect(invoke.mock.calls.filter(([channel]) => channel === 'sessions:create')).toHaveLength(1);
  expect(invoke.mock.calls.filter(([channel]) => channel === 'sessions:prompt').map(([, id]) => id)).toEqual([
    'real-id',
  ]);
  expect(getApp().sessions['real-id'].items.filter((i) => i.kind === 'user')).toHaveLength(1);
});
