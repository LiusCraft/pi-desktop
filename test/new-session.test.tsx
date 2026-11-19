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
const { selectProject, send, showWelcome, openSession, startSuggested, handleHostEvent } =
  await import('../src/renderer/src/store/actions');
const { emptySession } = await import('../src/renderer/src/store/transcript');
const { useWelcomeBranches } = await import('../src/renderer/src/store/welcome-branches');
const { dialogs } = await import('../src/renderer/src/store/dialogs');

beforeEach(() => {
  useDrafts.setState({ active: null, drafts: {} });
  useWelcomeBranches.setState({}, true);
  setApp((st) => {
    st.view = 'code';
    st.prefs.project = '/project';
    st.prefs.model = 'vendor/known-model';
    st.adopt = null;
    st.workFolders = [];
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

it('can start from a PR without a project and cancels without creating a session', async () => {
  const url = 'https://github.com/acme/app/pull/42';
  const prompt = vi.spyOn(dialogs, 'prompt').mockResolvedValue(url);
  const confirm = vi.spyOn(dialogs, 'confirm').mockResolvedValue(true);
  try {
    setApp((st) => {
      st.projects = [];
      st.prefs.project = '';
    });
    invoke.mockImplementation(async (channel) =>
      channel === 'sessions:fromPr' ? { kind: 'folder', repo: 'acme/app' } : channel === 'git:branches' ? [] : null,
    );
    mount();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start from PR' }));
    });
    expect(invoke.mock.calls.filter(([ch]) => ch === 'sessions:fromPr')).toEqual([
      ['sessions:fromPr', url, [], null, expect.any(Object)],
    ]);
    expect(invoke.mock.calls.some(([ch]) => ch === 'app:pickFolder')).toBe(true);
    expect(invoke.mock.calls.some(([ch]) => ch === 'projects:addPath')).toBe(false);
    expect(getApp().current).toBeNull();
  } finally {
    prompt.mockRestore();
    confirm.mockRestore();
  }
});

it('offers /goal before a session exists without submitting the draft', async () => {
  invoke.mockImplementation(async (channel) => (channel === 'git:branches' ? [] : null));
  mount();
  const box = screen.getByRole('textbox');
  fireEvent.change(box, { target: { value: '/goa' } });
  const option = await screen.findByRole('option', { name: /\/goal/ });
  fireEvent.click(option);
  expect(activeDraft()?.text).toBe('/goal ');
  expect(getApp().current).toBeNull();
  expect(invoke.mock.calls.some(([channel]) => channel === 'sessions:create')).toBe(false);
});

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

const source = {
  id: 'parent',
  kind: 'code',
  projectPath: '/parent-project',
  cwd: '/parent-project',
  title: 'Parent',
  worktree: false,
} as SessionMeta;
const child = { ...source, id: 'child', title: 'Child', parentId: source.id };
const task = { title: 'Split CI', prompt: 'Move the CI fix from PR #3325 into a separate PR.' };
async function openSource(meta = source) {
  setApp((st) => {
    st.sessions[meta.id] = { ...emptySession(meta), loaded: true };
  });
  await openSession(meta.id);
  drafts.setText(activeDraft()!.key, 'Unsent parent draft');
}

it('opens the handoff preview before spawn resolves; Start all follows only the first task', async () => {
  const first = deferred<SessionMeta>();
  const second = deferred<SessionMeta>();
  invoke.mockImplementation(async (channel, _id, _task, key) =>
    channel === 'sessions:spawn' ? (key === 'call:0' ? first.promise : second.promise) : null,
  );
  await openSource();
  useWelcomeBranches.setState({
    [source.projectPath]: { current: 'main', defaultRef: 'main', selected: 'release', branches: ['release'] },
  });
  setApp((st) => void (st.prefs.worktree = true));
  const item = { toolCallId: 'call' };
  const opening = startSuggested(source.id, item, 0, task);
  const background = startSuggested(source.id, item, 1, { title: 'Two', prompt: 'Second task' });
  await startSuggested(source.id, item, 0, task);
  const ui = mount();
  expect(screen.getByText(task.prompt)).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('Starting the session…');
  expect(invoke.mock.calls.filter(([channel]) => channel === 'sessions:spawn')).toHaveLength(2);
  expect(invoke).toHaveBeenCalledWith('sessions:spawn', source.id, task, 'call:0', {
    worktree: true,
    projects: { [source.projectPath]: { baseRef: 'release' } },
  });
  await act(async () => {
    second.resolve({ ...child, id: 'second' });
    await background;
  });
  expect(screen.getByText(task.prompt)).toBeTruthy();
  ui.unmount();
  first.resolve(child);
  await opening;
  expect(getApp().current).toBe(child.id);
  expect(invoke.mock.calls.filter(([channel]) => channel === 'sessions:prompt')).toHaveLength(0);
});

it('passes only the linked Code destinations and their welcome choices with a Work prompt', async () => {
  invoke.mockImplementation(async (ch) => (ch === 'sessions:prompt' ? { disposition: 'sent' } : null));
  await openSource({ ...source, kind: 'work' });
  setApp((st) => {
    st.workFolders = [{ name: 'Work', addedAt: 0, path: source.projectPath, codeFolders: ['/repo'] }];
    st.adopt = { mainRoot: '/repo', branch: 'feature', path: '/existing' };
    st.prefs.worktree = false;
  });
  await send();
  expect(invoke).toHaveBeenCalledWith('sessions:prompt', source.id, expect.anything(), 'steer', {
    worktree: false,
    projects: { '/repo': { adoptPath: '/existing' } },
  });
});

it('restores the parent on a rejected suggestion and allows retry in its linked Code folder', async () => {
  const attempt = deferred<SessionMeta>();
  invoke.mockImplementation(async (ch) => (ch === 'sessions:spawn' ? attempt.promise : null));
  await openSource({ ...source, kind: 'work' });
  const retry = () => startSuggested(source.id, { toolCallId: 'retry' }, 0, { ...task, codeFolder: '/repo' });
  const starting = retry();
  expect(getApp().view).toBe('code');
  await send(); // Pending preview must not submit the unsent parent draft.
  expect(invoke.mock.calls.some(([ch]) => ch === 'sessions:prompt')).toBe(false);
  attempt.reject(new Error('Worktree unavailable'));
  await starting;
  expect(getApp()).toMatchObject({ current: source.id, view: 'work', creating: null });
  expect(activeDraft()?.text).toBe('Unsent parent draft');
  invoke.mockResolvedValueOnce(child);
  await retry();
  expect(getApp().current).toBe(child.id);
});

it('recovers from a remote disconnect even if the parent was archived during launch', async () => {
  invoke.mockResolvedValue(null);
  await openSource();
  const launch = { type: 'session_launch', sessionId: source.id, launchId: 'disconnected' } as const;
  handleHostEvent({ ...launch, phase: 'starting', kind: 'code', prompt: task.prompt });
  setApp((st) => void (st.sessions[source.id].meta.archived = true));
  handleHostEvent({ type: 'remote_link', state: 'reconnecting' });
  expect(getApp()).toMatchObject({ current: null, creating: null });
  handleHostEvent({ ...launch, phase: 'created', meta: child });
  expect(getApp().current).toBeNull();
});

it('restores the source draft on launch failure and does not steal focus after navigation', async () => {
  invoke.mockResolvedValue(null);
  await openSource();
  const launch = { type: 'session_launch', sessionId: source.id, launchId: 'launch' } as const;
  const start = () => handleHostEvent({ ...launch, phase: 'starting', kind: 'code', prompt: task.prompt });
  start();
  expect(getApp().creating).toMatchObject({ kind: 'task', prompt: task.prompt });
  handleHostEvent({ ...launch, phase: 'failed', error: 'Branch not found' });
  expect(getApp().current).toBe(source.id);
  expect(activeDraft()?.text).toBe('Unsent parent draft');
  start();
  showWelcome();
  handleHostEvent({ ...launch, phase: 'created', meta: child });
  expect(getApp().current).toBeNull();
  expect(getApp().creating).toBeNull();
  expect(getApp().sessions[child.id].meta.parentId).toBe(source.id);
});
