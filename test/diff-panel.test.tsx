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
  ResizablePanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
  PathTree: ({ label, paths, selected, decorate, onOpen, snapshotOf }: ComponentProps<typeof PathTree>) => (
    <nav aria-label={label}>
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

const { DiffPanel } = await import('../src/renderer/src/components/workspace/Panels');
const { TooltipProvider } = await import('../src/renderer/src/components/ui/tooltip');
const { emptySession } = await import('../src/renderer/src/store/transcript');
const { getApp, setApp, updateSession, useApp } = await import('../src/renderer/src/store/app');
const { diffTarget, togglePanel } = await import('../src/renderer/src/store/actions');

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
  if (channel === 'app:openTargets') return [];
  throw new Error(`Unexpected host call: ${channel}`);
};

function MountedPanel() {
  const s = useApp((state) => state.sessions[id]);
  return (
    <TooltipProvider>
      {s.panels.diff ? (
        <DiffPanel s={s} expanded={false} onExpand={() => {}} />
      ) : (
        <button onClick={() => togglePanel(id, 'diff', true)}>Reopen Diff</button>
      )}
    </TooltipProvider>
  );
}
const since = () => screen.getByRole('button', { name: 'Compare against…' });
const fileRow = (path: string) =>
  within(screen.getByRole('navigation', { name: 'Changed files' })).getByRole('button', {
    name: new RegExp(`^${path} `),
  });
async function pickScope(name: 'Last commit' | 'Last turn') {
  fireEvent.keyDown(since(), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: new RegExp(name) }));
  await waitFor(() => expect(since().textContent).toContain(name));
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
  });
});

describe('Diff panel scope orchestration', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(getApp().sessions[id].diffScope).toBe('lastTurn');
    fireEvent.click(screen.getByRole('button', { name: 'Reopen Diff' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByTestId('code:src/app.ts');
    branch = { ...branch, files: [], commits: [] };
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByTestId('code:package-lock.json')).toBeTruthy();
    fireEvent.click(fileRow('src/app.ts'));
    await waitFor(() => expect(review.scrollToItem).toHaveBeenCalledWith('src/app.ts'));
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(screen.queryByTestId('code:src/app.ts')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getByTestId('code:src/app.ts')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Flat list' }));
    expect(screen.getByRole('button', { name: 'Tree view' }).getAttribute('aria-pressed')).toBe('true');
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
