// @vitest-environment jsdom
import { deferred, invoke } from './renderer-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CommitInfo,
  DiffBase,
  DiffComparison,
  FileChange,
  FileContent,
  PrThread,
  SessionMeta,
} from '../src/shared/protocol';
import type { ReviewHandle, ReviewProps } from '../src/renderer/src/components/common/ReviewCodeView';
import type { PathTree } from '../src/renderer/src/components/workspace/PathTree';

const review = vi.hoisted(() => ({
  scrollToItem: vi.fn<(id: string) => void>(),
  scrollToLine: vi.fn<(id: string, line: number, side?: string) => void>(),
  focusThread: vi.fn<(thread: PrThread) => void>(),
}));

// The real menu, hooks, store, actions and lazy-content cache stay mounted.
// Only layout/virtualized viewers are replaced: jsdom cannot measure or run their workers.
vi.mock('react-resizable-panels', () => ({
  useDefaultLayout: () => ({ defaultLayout: undefined, onLayoutChanged: () => {} }),
}));
vi.mock('../src/renderer/src/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children, inert }: { children: ReactNode; inert?: boolean }) => (
    <div inert={inert}>{children}</div>
  ),
  ResizableHandle: () => <hr />,
}));
vi.mock('../src/renderer/src/components/common/ReviewCodeView', async () => {
  const { forwardRef, useEffect, useImperativeHandle } = await import('react');
  return {
    HEADER_TOGGLE_ATTR: 'data-header-toggle',
    ReviewCodeView: forwardRef<ReviewHandle, ReviewProps>(function Viewer(
      { items, threads = [], onNeed, renderPrefix, renderMetadata },
      ref,
    ) {
      useImperativeHandle(ref, () => review, []);
      useEffect(() => {
        const missing = items.filter((item) => item.kind === 'diff' && !item.ready).map((item) => item.id);
        if (missing.length) onNeed?.(missing);
      }, [items, onNeed]);
      return (
        <div data-testid="review" data-threads={threads.map((thread) => thread.id).join(',')}>
          {items.map((item) => (
            <article key={item.id} data-testid={`review:${item.path}`}>
              {renderPrefix?.(item)}
              <span>{item.path}</span>
              {renderMetadata?.(item)}
              {item.kind === 'diff' && item.ready && !item.collapsed && (
                <pre data-testid={`code:${item.path}`}>
                  {item.before} → {item.after}
                </pre>
              )}
            </article>
          ))}
        </div>
      );
    }),
  };
});
vi.mock('../src/renderer/src/components/workspace/PathTree', () => ({
  PathTree: ({ label, paths, selected, decorate, onOpen, snapshotOf, flat }: ComponentProps<typeof PathTree>) => (
    <nav aria-label={label} data-flat={!!flat}>
      {paths.map((path) => {
        const annotation = decorate?.(path);
        return (
          <div key={path}>
            <button data-selected={selected === path} onClick={() => onOpen(path)}>
              {path} {annotation && 'text' in annotation ? annotation.text : null}
            </button>
            <button onClick={() => snapshotOf?.(path)}>Snapshot {path}</button>
          </div>
        );
      })}
    </nav>
  ),
}));

const { Main } = await import('../src/renderer/src/components/layout/Main');
const { toolFromArgs } = await import('../src/renderer/src/lib/tools');
const { NewWorkspaceTabMenu, Workspace } = await import('../src/renderer/src/components/workspace/Workspace');
const { openWorkspaceTabs, readWorkspaceTab } = await import('../src/renderer/src/store/layout');
const { TooltipProvider } = await import('../src/renderer/src/components/ui/tooltip');
const { emptySession } = await import('../src/renderer/src/store/transcript');
const { getApp, setApp, updateSession, useApp } = await import('../src/renderer/src/store/app');
const { diffTarget, openFileRef, openPlan, requestFind } = await import('../src/renderer/src/store/actions');
const { useShortcuts } = await import('../src/renderer/src/lib/use-shortcuts');

const change = (path: string, status: FileChange['status'] = 'M'): FileChange => ({
  path,
  status,
  add: 2,
  del: 1,
  binary: false,
  rev: 'revision',
});
const commit: CommitInfo = {
  hash: 'c'.repeat(40),
  short: 'ccccccc',
  subject: 'Change app',
  author: 'Coder',
  date: '2026-01-01T00:00:00Z',
};
const thread: PrThread = {
  id: 'review-thread',
  path: 'src/app.ts',
  line: 1,
  side: 'new',
  resolved: false,
  outdated: false,
  comments: [],
};
let sequence = 0;
let id: string;
let branch: DiffComparison;
let lastCommit: DiffComparison;
let turn: DiffComparison;
let release: DiffComparison;
let commitFiles: FileChange[];
const host = async (channel: string, ...args: unknown[]): Promise<unknown> => {
  if (channel === 'sessions:diff') {
    const target = args[1] as DiffBase;
    return target.kind === 'lastTurn'
      ? turn
      : target.kind === 'lastCommit'
        ? lastCommit
        : target.ref === 'release'
          ? release
          : branch;
  }
  if (channel === 'sessions:changeContent') {
    const [, path, hash, base] = args;
    return {
      before: `${hash || base}:before:${path}`,
      after: `${hash || base}:after:${path}`,
      binary: false,
    } satisfies FileContent;
  }
  if (channel === 'sessions:commitChanges') return commitFiles;
  if (channel === 'sessions:changes')
    return {
      repo: true,
      files: branch.files,
      state: { dirty: [], ahead: 0, behind: 0, baseBehind: 0, base: null, upstream: null },
    };
  if (channel === 'git:branchBases') return ['main', 'release'].map((name) => ({ ...commit, name }));
  if (channel === 'sessions:prThreads') return [];
  if (channel === 'sessions:files') return ['src/app.ts'];
  if (channel === 'sessions:readFile') return 'file contents';
  if (channel === 'app:openTargets') return [];
  throw new Error(`Unexpected host call: ${channel}`);
};

function MountedPanel() {
  useShortcuts();
  const s = useApp((state) => state.sessions[id]);
  const tabs = openWorkspaceTabs(s, true);
  return (
    <TooltipProvider>{tabs.length ? <Workspace s={s} tabs={tabs} /> : <NewWorkspaceTabMenu s={s} />}</TooltipProvider>
  );
}
const since = () => screen.getByRole('button', { name: 'Compare against…' });
const fileRow = (path: string) =>
  within(screen.getByRole('navigation', { name: 'Changed files' })).getByRole('button', {
    name: new RegExp(`^${path} `),
  });
async function addWorkspaceTab(name: string) {
  fireEvent.keyDown(screen.getByRole('button', { name: 'New workspace tab' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name }));
}

async function pickScope(name: 'Last commit' | 'Last turn') {
  fireEvent.keyDown(since(), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: new RegExp(name) }));
  await waitFor(() => expect(since().textContent).toContain(name));
}
async function panelOption(name: string) {
  fireEvent.keyDown(screen.getByRole('button', { name: 'Panel options' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name }));
}

beforeEach(() => {
  review.scrollToItem.mockClear();
  review.scrollToLine.mockClear();
  review.focusThread.mockClear();
  Object.assign(diffTarget, { path: null, line: undefined, side: undefined, thread: false });
  id = `panel-${++sequence}`;
  branch = { base: 'branch-base', files: [change('src/app.ts')], commits: [commit] };
  lastCommit = { base: 'head-base', files: [change('dirty.ts', 'A')], commits: [] };
  turn = { base: null, files: [{ ...change('turn.ts'), before: 'turn before', after: 'turn after' }], commits: [] };
  release = { base: 'release-base', files: [change('release.ts')], commits: [] };
  commitFiles = [change('commit.ts')];
  invoke.mockImplementation(host);
  const meta = {
    id,
    kind: 'code',
    cwd: '/project',
    projectPath: '/project',
    branch: 'topic',
    baseBranch: 'main',
    baseCommit: 'recorded',
  } as SessionMeta;
  const s = emptySession(meta);
  s.panels.diff = true;
  s.changes = branch.files;
  s.prThreads = [thread];
  setApp((state) => {
    state.sessions = { [id]: s };
    state.current = id;
    state.settings = {};
  });
});

describe('Workspace tabs', () => {
  it('opens task output from the real session layout and restores the dock without remounting the task tab', async () => {
    const shell = toolFromArgs('shell-result', 'pidesk_bg_shell', { command: 'npm test', description: 'Run tests' });
    updateSession(id, (s) => {
      s.panels.diff = false;
      s.items.push({
        kind: 'group',
        key: 'task-group',
        open: false,
        thoughts: [],
        tools: [{ ...shell, status: 'done', sh: { command: 'npm test', output: 'Checks passed', exitCode: 0 } }],
      });
    });
    render(
      <TooltipProvider>
        <Main />
      </TooltipProvider>,
    );
    expect(screen.queryByRole('tablist', { name: 'Panels' })).toBeNull();
    await addWorkspaceTab('Background tasks');
    const taskTab = screen.getByRole('tabpanel', { name: 'Background tasks' });
    fireEvent.click(within(taskTab).getByRole('button', { name: 'View output' }));
    const detail = screen.getByRole('tabpanel', { name: 'Details' });
    expect(within(detail).getByText(/Checks passed/)).toBeTruthy();
    const transcriptItem = document.querySelector('[data-item-key="task-group"]');
    expect(transcriptItem).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand workspace' }));
    expect(transcriptItem?.closest('[inert]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restore workspace' }));
    expect(transcriptItem?.closest('[inert]')).toBeNull();
    fireEvent.click(within(detail).getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('tabpanel', { name: 'Background tasks' })).toBe(taskTab);
    expect(screen.queryByRole('tab', { name: 'Details' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand workspace' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close Background tasks' }));
    expect(screen.queryByRole('tablist', { name: 'Panels' })).toBeNull();
    expect(getApp().sessions[id].workspaceExpanded).toBe(false);
    expect(screen.getByRole('button', { name: 'New workspace tab' })).toBeTruthy();
  });

  it('selects an already-open tab from the menu without reading the file again or creating a duplicate', async () => {
    render(<MountedPanel />);
    await act(() => openFileRef('src/app.ts', 1, undefined, true));
    const tab = (name: string) => within(screen.getByRole('tablist', { name: 'Panels' })).getByRole('tab', { name });
    const files = screen.getByRole('tabpanel', { name: 'Files' });
    fireEvent.keyDown(tab('Files'), { key: 'Home' });
    expect(document.activeElement).toBe(tab('Changes'));
    fireEvent.keyDown(tab('Changes'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tab('Files'));
    fireEvent.click(tab('Changes'));
    await addWorkspaceTab('Files');
    expect(screen.getByRole('tabpanel', { name: 'Files' })).toBe(files);
    expect(screen.getAllByRole('tab', { name: 'Files' })).toHaveLength(1);
    expect(invoke.mock.calls.filter(([channel]) => channel === 'sessions:readFile')).toHaveLength(1);
  });

  it('selects a neighboring file or clears only the preview when closing inner file tabs', async () => {
    render(<MountedPanel />);
    await act(() => openFileRef('src/app.ts', 1, undefined, true));
    await act(() => openFileRef('src/other.ts', 1, undefined, true));
    const files = screen.getByRole('tabpanel', { name: 'Files' });
    await act(async () => void fireEvent.click(within(files).getByRole('button', { name: 'Close other.ts' })));
    expect(getApp().sessions[id].fileDetail?.path).toBe('src/app.ts');
    fireEvent.click(within(files).getByRole('button', { name: 'Close app.ts' }));
    expect(within(files).getByText(/Pick a file/)).toBeTruthy();
    expect(screen.getByRole('tabpanel', { name: 'Files' })).toBe(files);
  });

  it('keeps Work file previews in a standalone detail tab and offers only Work panels', async () => {
    updateSession(id, (s) => {
      s.meta.kind = 'work';
    });
    render(<MountedPanel />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'New workspace tab' }), { key: 'Enter' });
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual([
      'Progress',
      'Background tasks',
    ]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Progress' }));
    const progress = screen.getByRole('tabpanel', { name: 'Progress' });
    await act(() => openFileRef('notes.md'));
    expect(within(screen.getByRole('tabpanel', { name: 'Details' })).getByText('file contents')).toBeTruthy();
    expect(getApp().sessions[id].fileTabs).toEqual([]);
    expect(getApp().sessions[id].fileDetail).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close Details' }));
    expect(screen.getByRole('tabpanel', { name: 'Progress' })).toBe(progress);
  });

  it('loads image, media and error previews in the Files tab without opening Details', async () => {
    const src = 'data:image/png;base64,iVBORw0KGgo=';
    invoke.mockImplementation(async (channel, ...args) => {
      if (channel === 'sessions:readImage') return { src, mimeType: 'image/png' };
      if (channel === 'sessions:readMedia')
        return { kind: 'video', src: 'file:///project/video.mp4', mimeType: 'video/mp4' };
      if (channel === 'sessions:readFile') throw new Error('File no longer exists');
      return host(channel, ...args);
    });
    render(<MountedPanel />);
    await act(() => openFileRef('photo.png'));
    const files = screen.getByRole('tabpanel', { name: 'Files' });
    expect(within(files).getByRole('img', { name: 'photo.png' }).getAttribute('src')).toBe(src);
    await act(() => openFileRef('video.mp4'));
    expect(files.querySelector('video')?.getAttribute('src')).toBe('file:///project/video.mp4');
    await act(() => openFileRef('missing.txt'));
    expect(within(files).getByText('File no longer exists')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Details' })).toBeNull();
  });

  it('keeps open content and search state when switching, and closes tabs without stealing the selection', async () => {
    render(<MountedPanel />);
    await screen.findByTestId('review');
    const dock = screen.getByRole('tablist', { name: 'Panels' });
    const tab = (name: string) => within(dock).getByRole('tab', { name });
    await act(() => openFileRef('src/app.ts', 1, undefined, true));
    const files = screen.getByRole('tabpanel', { name: 'Files' });
    expect(within(files).getByRole('tab', { name: /app\.ts/ })).toBeTruthy();

    fireEvent.keyDown(tab('Files'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tab('Changes'));
    expect(screen.queryByRole('tabpanel', { name: 'Files' })).toBeNull();
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(readWorkspaceTab(id)).toBe('diff');

    act(() => requestFind('all'));
    expect(screen.getByPlaceholderText('Search in all files')).toBe(document.activeElement);
    expect(screen.getByRole('tabpanel', { name: 'Files' })).toBe(files);
    expect(getApp().sessions[id].fileDetail?.text).toBe('file contents');

    // Plan and task detail requests must not replace the file shown in Files.
    act(() => openPlan(id, 'plan-key'));
    expect(tab('Plan').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tab('Plan'), { key: 'Delete' });
    expect(tab('Files').getAttribute('aria-selected')).toBe('true');
    expect(getApp().sessions[id].fileTabs).toEqual([{ path: 'src/app.ts', pinned: true }]);

    fireEvent.click(within(dock).getByRole('button', { name: 'Close Changes' }));
    expect(screen.getByRole('tabpanel', { name: 'Files' })).toBe(files);
    fireEvent.keyDown(tab('Files'), { key: 'Delete' });
    expect(screen.queryByRole('tablist', { name: 'Panels' })).toBeNull();
    expect(readWorkspaceTab(id)).toBeNull();
  });
});

describe('Diff panel scope orchestration', () => {
  it('honors the remapped local find shortcut without opening the Files panel', async () => {
    setApp((state) => void (state.settings.shortcuts = { findFile: 'F7', findAll: null }));
    render(<MountedPanel />);
    const contents = await screen.findByTestId('review');
    const search = () => screen.queryByPlaceholderText('Find in changes');
    fireEvent.keyDown(contents, { key: 'f', ctrlKey: true });
    fireEvent.keyDown(contents, { key: 'F', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(contents, { key: 'F7', repeat: true });
    expect(search()).toBeNull();
    fireEvent.keyDown(contents, { key: 'F7' });
    expect(search()).toBe(document.activeElement);
    expect(getApp().sessions[id].panels.files).toBe(false);
  });

  it('switches files, lazy contents, commits, counts and review threads without changing the PR target', async () => {
    render(<MountedPanel />);
    expect(await screen.findByText('branch-base:before:src/app.ts → branch-base:after:src/app.ts')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Commits' }).textContent).toContain('Change app');
    expect(screen.getByTestId('review').getAttribute('data-threads')).toBe(thread.id);
    expect(invoke).toHaveBeenCalledWith('sessions:changeContent', id, 'src/app.ts', null, 'branch-base');
    await pickScope('Last commit');
    await waitFor(() => expect(screen.queryByTestId('review:src/app.ts')).toBeNull());
    expect(await screen.findByTestId('code:dirty.ts')).toBeTruthy();
    expect(screen.getByTestId('code:dirty.ts').textContent).toBe(' → head-base:after:dirty.ts');
    expect(screen.queryByRole('navigation', { name: 'Commits' })).toBeNull();
    expect(screen.getByTestId('review').getAttribute('data-threads')).toBe('');
    await pickScope('Last turn');
    expect(await screen.findByText('turn before → turn after')).toBeTruthy();
    expect(
      invoke.mock.calls.some(([channel, , path]) => channel === 'sessions:changeContent' && path === 'turn.ts'),
    ).toBe(false);
    expect(getApp().sessions[id].meta).toMatchObject({ branch: 'topic', baseBranch: 'main', baseCommit: 'recorded' });
    fireEvent.click(screen.getByRole('button', { name: 'Close Changes' }));
    expect(getApp().sessions[id].diffScope).toBe('lastTurn');
    await addWorkspaceTab('Changes');
    expect(await screen.findByText('turn before → turn after')).toBeTruthy();
    expect(since().textContent).toContain('Last turn');
  });

  it('selects a different branch as a view preference and refreshes its resolved content base', async () => {
    render(<MountedPanel />);
    await screen.findByTestId('code:src/app.ts');
    fireEvent.keyDown(since(), { key: 'Enter' });
    fireEvent.keyDown(await screen.findByRole('menuitem', { name: /^main/ }), { key: 'ArrowRight' });
    fireEvent.click(await screen.findByRole('option', { name: /^release/ }));
    expect(await screen.findByText('release-base:before:release.ts → release-base:after:release.ts')).toBeTruthy();
    expect(getApp().sessions[id]).toMatchObject({
      diffScope: 'branch',
      diffBranch: 'release',
      meta: { baseBranch: 'main' },
    });
    expect(screen.getByTestId('review').getAttribute('data-threads')).toBe('');
    release = { ...release, base: 'new-release-base', files: [change('release.ts')] };
    await panelOption('Refresh');
    expect(
      await screen.findByText('new-release-base:before:release.ts → new-release-base:after:release.ts'),
    ).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('sessions:changeContent', id, 'release.ts', null, 'new-release-base');
  });

  it('loads individual commits and returns to all changes when the commit is toggled off', async () => {
    render(<MountedPanel />);
    const button = await screen.findByRole('button', { name: /Change app/ });
    fireEvent.click(button);
    await screen.findByTestId('code:commit.ts');
    expect(screen.queryByTestId('review:src/app.ts')).toBeNull();
    expect(screen.getByTestId('review').getAttribute('data-threads')).toBe('');
    expect(invoke).toHaveBeenCalledWith('sessions:changeContent', id, 'commit.ts', commit.hash, undefined);
    fireEvent.click(button);
    expect(await screen.findByTestId('code:src/app.ts')).toBeTruthy();
    fireEvent.click(button);
    await screen.findByTestId('code:commit.ts');
    fireEvent.click(screen.getByRole('button', { name: 'All changes' }));
    expect(await screen.findByTestId('code:src/app.ts')).toBeTruthy();
  });

  it('ignores an in-flight commit response after switching the comparison scope', async () => {
    const pending = deferred<FileChange[]>();
    invoke.mockImplementation((channel, ...args) =>
      channel === 'sessions:commitChanges' ? pending.promise : host(channel, ...args),
    );
    render(<MountedPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /Change app/ }));
    await pickScope('Last turn');
    await screen.findByTestId('code:turn.ts');
    await act(async () => pending.resolve(commitFiles));
    expect(screen.queryByTestId('review:commit.ts')).toBeNull();
    expect(screen.getByTestId('code:turn.ts').textContent).toContain('turn before');
  });

  it('shows loading, errors, retry and empty states rather than data from the wrong scope', async () => {
    const pending = deferred<DiffComparison>();
    invoke.mockImplementation((channel, ...args) =>
      channel === 'sessions:diff' ? pending.promise : host(channel, ...args),
    );
    render(<MountedPanel />);
    expect(screen.getByText('Loading changes…')).toBeTruthy();
    await act(async () => pending.reject(new Error('offline')));
    expect(await screen.findByText('Unable to load changes. Try refreshing.')).toBeTruthy();
    invoke.mockImplementation(host);
    await panelOption('Refresh');
    await screen.findByTestId('code:src/app.ts');
    branch = { ...branch, files: [], commits: [] };
    await panelOption('Refresh');
    expect(await screen.findByText(/No changes yet/)).toBeTruthy();
  });

  it('keeps deleted contents available and does not try to render binary files', async () => {
    branch = { ...branch, files: [change('deleted.ts', 'D'), { ...change('image.png'), binary: true }], commits: [] };
    render(<MountedPanel />);
    expect(await screen.findByTestId('code:deleted.ts')).toBeTruthy();
    expect(screen.getByTestId('code:deleted.ts').textContent).toBe('branch-base:before:deleted.ts → ');
    expect(screen.queryByTestId('review:image.png')).toBeNull();
    expect(fileRow('image.png').textContent).toContain('binary');
    fireEvent.click(screen.getByRole('button', { name: 'Snapshot deleted.ts' }));
    fireEvent.click(screen.getByRole('button', { name: 'Snapshot image.png' }));
    expect(
      invoke.mock.calls.filter(([channel, , path]) => channel === 'sessions:changeContent' && path === 'image.png'),
    ).toHaveLength(0);
  });

  it('retains folding and navigation behavior while a changed generated file is reopened on refresh', async () => {
    branch = { ...branch, files: [change('package-lock.json'), change('src/app.ts')], commits: [] };
    render(<MountedPanel />);
    await screen.findByTestId('code:src/app.ts');
    expect(screen.queryByTestId('code:package-lock.json')).toBeNull();
    const generated = screen.getByTestId('review:package-lock.json');
    fireEvent.click(within(generated).getByTitle('Show diff'));
    expect(screen.getByTestId('code:package-lock.json')).toBeTruthy();
    fireEvent.click(within(generated).getByTitle('Hide diff'));
    branch = { ...branch, files: branch.files.map((file) => ({ ...file, rev: 'updated' })) };
    await panelOption('Refresh');
    expect(await screen.findByTestId('code:package-lock.json')).toBeTruthy();
    fireEvent.click(fileRow('src/app.ts'));
    await waitFor(() => expect(review.scrollToItem).toHaveBeenCalledWith('src/app.ts'));
    await panelOption('Collapse all');
    expect(screen.queryByTestId('code:src/app.ts')).toBeNull();
    await panelOption('Expand all');
    expect(screen.getByTestId('code:src/app.ts')).toBeTruthy();
    await panelOption('Flat list');
    expect(screen.getByRole('navigation', { name: 'Changed files' }).getAttribute('data-flat')).toBe('true');
    await panelOption('Tree view');
    expect(screen.getByRole('navigation', { name: 'Changed files' }).getAttribute('data-flat')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Hide changed files' }));
    expect(screen.queryByRole('navigation', { name: 'Changed files' })).toBeNull();
  });

  it('restores the default base before following an explicit file jump', async () => {
    updateSession(id, (s) => {
      s.diffScope = 'lastTurn';
      s.diffBranch = 'release';
    });
    Object.assign(diffTarget, { path: 'src/app.ts', line: 2, side: 'additions' });
    render(<MountedPanel />);
    await waitFor(() => expect(review.scrollToLine).toHaveBeenCalledWith('src/app.ts', 2, 'additions'));
    expect(getApp().sessions[id]).toMatchObject({ diffScope: 'branch', diffBranch: null });
    expect(diffTarget.path).toBeNull();
    expect(screen.getByTestId('review').getAttribute('data-threads')).toBe(thread.id);
  });

  it('uses session snapshots without Git and still offers the latest turn', async () => {
    updateSession(id, (s) => {
      s.meta.baseCommit = null;
      s.sessionChanges = [{ ...change('session.ts'), before: 'session before', after: 'session after' }];
    });
    render(<MountedPanel />);
    expect(screen.getByText('session before → session after')).toBeTruthy();
    expect(invoke.mock.calls.some(([channel]) => channel === 'sessions:diff')).toBe(false);
    expect(since().textContent).toContain('Current session changes');
    await pickScope('Last turn');
    expect(await screen.findByText('turn before → turn after')).toBeTruthy();
  });
});
