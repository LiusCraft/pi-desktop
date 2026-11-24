// @vitest-environment jsdom
import { invoke } from './renderer-dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionMeta } from '../src/shared/protocol';
import { DEFAULT_PR_BAR } from '../src/shared/pr-bar-settings';

const { PrBar } = await import('../src/renderer/src/components/composer/PrBar');
const { TooltipProvider } = await import('../src/renderer/src/components/ui/tooltip');
const { emptySession } = await import('../src/renderer/src/store/transcript');
const { setApp } = await import('../src/renderer/src/store/app');
const { SessionOverview } = await import('../src/renderer/src/components/workspace/SessionOverview');

beforeEach(() => setApp((st) => void (st.settings = {})));

function session(state = 'merged') {
  const meta: SessionMeta = {
    id: 'pr-bar',
    kind: 'code',
    title: 'Update app',
    autoName: false,
    titleLocked: false,
    autoNamed: false,
    nameAttempted: false,
    projectPath: '/project',
    cwd: '/project',
    branch: 'feature',
    baseBranch: 'main',
    baseCommit: 'recorded',
    worktree: true,
    mode: 'auto',
    outputStyle: 'default',
    sessionFile: null,
    createdAt: 0,
    updatedAt: 0,
    pr: { num: 27, url: 'https://github.com/owner/repo/pull/27', state, draft: false },
  };
  const s = emptySession(meta);
  s.pr = { ...meta.pr!, ci: 'pass', checks: [], comments: 1, additions: 180, deletions: 37, files: 5 };
  s.changes = [{ path: 'app.ts', status: 'M', add: 180, del: 37, binary: false, rev: 'head' }];
  // Stale or ongoing local work must not revive actions on a completed PR.
  s.gitState = {
    dirty: ['app.ts'],
    ahead: 1,
    behind: 0,
    baseBehind: 2,
    base: 'main',
    upstream: 'origin/feature',
    hasRemote: true,
  };
  return s;
}

const bar = (s: ReturnType<typeof session>) => (
  <TooltipProvider>
    <PrBar s={s} />
  </TooltipProvider>
);

it('exposes the pre-armed CI switch before a PR or diff exists', async () => {
  const s = session();
  s.pr = s.meta.pr = null;
  s.meta.autoFixCi = true;
  s.changes = [];
  invoke.mockResolvedValue({ ...s.meta, autoFixCi: false });
  render(bar(s));
  fireEvent.click(screen.getByRole('button', { name: 'CI' }));
  const toggle = await screen.findByRole('checkbox', { name: 'Auto-fix CI, resolve conflicts & address comments' });
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  expect(screen.getByRole('checkbox', { name: 'Auto-merge when ready' }).getAttribute('aria-checked')).toBe('false');
  fireEvent.click(toggle);
  expect(invoke).toHaveBeenCalledWith('sessions:update', s.meta.id, { prAuto: { fixCi: false } });
});

it('shows live check details and keeps one-off fixing separate from automation', async () => {
  const s = session('open');
  const log = 'https://github.com/owner/repo/actions/runs/17';
  s.pr = { ...s.pr!, forge: 'github', ci: 'pending', checks: [{ n: 'build', st: 'pending', url: log }] };
  const view = render(bar(s));
  fireEvent.click(screen.getByRole('button', { name: 'CI' }));
  expect(await screen.findByText('1 check pending…')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'build' }));
  expect(invoke).toHaveBeenCalledWith('app:openExternal', log);
  expect(screen.queryByRole('button', { name: 'Let Pi handle it now, once' })).toBeNull();

  s.pr = { ...s.pr, ci: 'fail', checks: [{ n: 'build', st: 'fail', url: log }] };
  view.rerender(bar(s));
  expect(screen.getByRole('button', { name: 'Let Pi handle it now, once' })).toBeTruthy();
  s.meta.autoFixCi = true;
  view.rerender(bar(s));
  expect(screen.queryByRole('button', { name: 'Let Pi handle it now, once' })).toBeNull();
  expect(screen.getByText(/Watching in the background/)).toBeTruthy();
});

it('hides an empty branch bar unless either automation switch is armed', () => {
  const s = session();
  s.pr = s.meta.pr = null;
  s.changes = [];
  const view = render(bar(s));
  expect(screen.queryByRole('region')).toBeNull();
  s.meta.autoMerge = true;
  view.rerender(bar(s));
  expect(screen.getByRole('button', { name: 'CI' }).title).toMatch(/Waiting for a pull request/);
});

it('moves the same PR controls into the overview and can turn them off live', async () => {
  invoke.mockResolvedValue([]);
  const s = session('open');
  s.pr = { ...s.pr!, title: 'Update app', ci: 'pending', checks: [{ n: 'build', st: 'pending' }] };
  render(
    <TooltipProvider>
      <PrBar s={s} />
      <SessionOverview s={s} />
    </TooltipProvider>,
  );
  expect(screen.getByRole('region', { name: 'Branch status' })).toBeTruthy();
  act(() => setApp((st) => void (st.settings.prBar = { ...DEFAULT_PR_BAR, placement: 'overview', autoMerge: false })));
  expect(screen.queryByRole('region', { name: 'Branch status' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Session overview' }));
  const overview = screen.getByRole('dialog', { name: 'Session overview' });
  const branch = within(overview).getByRole('region', { name: 'Branch status' });
  expect(within(branch).getByText('Update app')).toBeTruthy();
  expect(within(branch).getByRole('button', { name: 'Update PR' })).toBeTruthy();
  expect(within(branch).getByRole('button', { name: '5 files · view diff' })).toBeTruthy();
  fireEvent.click(within(branch).getByRole('button', { name: 'CI' }));
  expect(await screen.findByText('build')).toBeTruthy();
  expect(screen.queryByRole('checkbox', { name: 'Auto-merge when ready' })).toBeNull();
  act(() => setApp((st) => void (st.settings.prBar = { ...DEFAULT_PR_BAR, enabled: false })));
  expect(screen.queryByRole('region', { name: 'Branch status' })).toBeNull();
  expect(within(overview).getByRole('region', { name: 'Changes' })).toBeTruthy();
});

describe('merged PR bar', () => {
  it('keeps PR status, diff, comments and CI without the action button or dropdown', () => {
    render(bar(session()));
    expect(screen.getByRole('region', { name: 'Branch status' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '#27' }).title).toContain('Merged');
    expect(screen.getByText('main')).toBeTruthy();
    expect(screen.getByText('feature')).toBeTruthy();
    expect(screen.getByRole('button', { name: '5 files · view diff' }).textContent).toBe('+180−37');
    expect(screen.getByRole('button', { name: '1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'CI' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide the branch bar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New PR' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Choose what to submit' })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(5);
  });

  it('removes actions as soon as an open PR becomes merged', () => {
    const view = render(bar(session('open')));
    expect(screen.getByRole('button', { name: 'Update PR' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose what to submit' })).toBeTruthy();

    view.rerender(bar(session('merged')));
    expect(screen.queryByRole('button', { name: /Update PR|New PR|Merge main/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Choose what to submit' })).toBeNull();
    expect(screen.getByRole('button', { name: '#27' }).title).toContain('Merged');
  });
});
