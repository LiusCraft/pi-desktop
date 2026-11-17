// @vitest-environment jsdom
import './renderer-dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SessionMeta } from '../src/shared/protocol';

const { PrBar } = await import('../src/renderer/src/components/composer/PrBar');
const { TooltipProvider } = await import('../src/renderer/src/components/ui/tooltip');
const { emptySession } = await import('../src/renderer/src/store/transcript');

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
