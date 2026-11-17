// @vitest-environment jsdom
import { deferred, invoke } from './renderer-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BranchInfo, FileChange } from '../src/shared/protocol';
import type { DiffScope } from '../src/renderer/src/store/types';

const { DiffSince } = await import('../src/renderer/src/components/workspace/DiffSince');
const file = (add: number, del: number): FileChange => ({
  path: 'file.ts',
  add,
  del,
  status: 'M',
  rev: '1',
  binary: false,
});
const branches: BranchInfo[] = ['topic', 'main', 'release'].map((name) => ({
  name,
  author: `Author ${name}`,
  hash: `${name}-full-hash`,
  short: `${name}-short`,
  date: new Date().toISOString(),
  subject: `${name} commit`,
}));
const props = () => ({
  cwd: '/project',
  branch: 'main',
  scope: 'branch' as DiffScope,
  sessionMode: false,
  files: { branch: [file(3, 1), file(2, 1)], lastCommit: [file(1, 0)], lastTurn: [file(4, 2)] },
  onSelect: vi.fn<(scope: DiffScope, branch?: string) => void>(),
  onOpenChange: vi.fn<(open: boolean) => void>(),
});
const trigger = () => screen.getByRole('button', { name: 'Compare against…' });
async function openMenu() {
  fireEvent.keyDown(trigger(), { key: 'Enter' });
  await screen.findByRole('menuitem', { name: /Last turn/ });
}
async function openBranches(label = 'main') {
  fireEvent.keyDown(screen.getByRole('menuitem', { name: new RegExp(`^${label}`) }), { key: 'ArrowRight' });
  return screen.findByPlaceholderText('Search branch bases…');
}

describe('Diff Since picker', () => {
  it('shows totals and closes the menu after selecting Last commit or Last turn', async () => {
    const p = props();
    const { rerender } = render(<DiffSince {...p} />);
    expect(trigger().textContent).toContain('main+5−2');
    await openMenu();
    expect(p.onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('menuitem', { name: /Last commit/ }).textContent).toContain('+1−0');
    fireEvent.click(screen.getByRole('menuitem', { name: /Last commit/ }));
    expect(p.onSelect).toHaveBeenLastCalledWith('lastCommit', undefined);
    expect(p.onOpenChange).toHaveBeenLastCalledWith(false);
    rerender(<DiffSince {...p} scope="lastCommit" />);
    expect(trigger().textContent).toContain('Last commit+1−0');
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Last turn/ }));
    expect(p.onSelect).toHaveBeenLastCalledWith('lastTurn', undefined);
    rerender(<DiffSince {...p} scope="lastTurn" />);
    expect(trigger().textContent).toContain('Last turn+4−2');
  });

  it('loads branch metadata on demand, focuses search, orders the selected branch first and filters options', async () => {
    const pending = deferred<BranchInfo[]>();
    invoke.mockReturnValueOnce(pending.promise);
    const p = props();
    render(<DiffSince {...p} />);
    expect(invoke).not.toHaveBeenCalled();
    await openMenu();
    const search = await openBranches();
    expect(await screen.findByText('Loading branches…')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(invoke).toHaveBeenCalledWith('git:branchBases', '/project');
    await act(async () => pending.resolve(branches));
    const options = screen.getAllByRole('option');
    expect(options[0].textContent).toContain('main');
    expect(options[0].textContent).toContain('Author main · main-short');
    expect(options[0].getAttribute('title')).toBe('main\nmain commit');
    fireEvent.change(search, { target: { value: 'missing-base' } });
    expect(await screen.findByText('No matching branches')).toBeTruthy();
    fireEvent.change(search, { target: { value: 'release' } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    fireEvent.keyDown(search, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(search);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(p.onSelect).toHaveBeenCalledWith('branch', 'release');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('supports session changes without Git and distinguishes unknown totals from an empty diff', async () => {
    const p = props();
    render(
      <DiffSince {...p} branch={null} sessionMode files={{ branch: [], lastCommit: undefined, lastTurn: undefined }} />,
    );
    expect(trigger().textContent).toContain('Current session changes+0−0');
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: /Last commit/ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /Last turn/ }).textContent).toContain('—');
    fireEvent.click(screen.getByRole('menuitem', { name: /Current session changes/ }));
    expect(p.onSelect).toHaveBeenCalledWith('branch', undefined);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('uses the session base fallback label when no branch name is known', () => {
    render(<DiffSince {...props()} branch={null} files={{ branch: undefined, lastCommit: [], lastTurn: [] }} />);
    expect(trigger().textContent).toContain('base—');
  });

  it('shows branch request errors and retries after reopening', async () => {
    invoke.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(branches);
    render(<DiffSince {...props()} />);
    await openMenu();
    const search = await openBranches();
    expect(await screen.findByText('Unable to load branches. Reopen to retry.')).toBeTruthy();
    fireEvent.keyDown(search, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await openMenu();
    await openBranches();
    expect(await screen.findAllByRole('option')).toHaveLength(3);
    expect(screen.queryByText('Unable to load branches. Reopen to retry.')).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('does not apply an old repository response after the cwd changes', async () => {
    const old = deferred<BranchInfo[]>();
    const current = deferred<BranchInfo[]>();
    invoke.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const p = props();
    const { rerender } = render(<DiffSince {...p} scope="lastCommit" />);
    await openMenu();
    await openBranches();
    rerender(<DiffSince {...p} scope="lastCommit" cwd="/new-project" />);
    await act(async () => {
      current.resolve([branches[2]]);
      old.resolve([branches[0]]);
    });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option').textContent).toContain('release');
    expect(screen.queryByText('Author topic · topic-short')).toBeNull();
    expect(invoke).toHaveBeenLastCalledWith('git:branchBases', '/new-project');
  });

  it('ignores late success and failure after the branch menu unmounts', async () => {
    const success = deferred<BranchInfo[]>();
    const failure = deferred<BranchInfo[]>();
    invoke.mockReturnValueOnce(success.promise).mockReturnValueOnce(failure.promise);
    const { unmount } = render(<DiffSince {...props()} />);
    await openMenu();
    let search = await openBranches();
    fireEvent.keyDown(search, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await act(async () => success.resolve(branches));
    await openMenu();
    search = await openBranches();
    expect(search).toBeTruthy();
    unmount();
    await act(async () => failure.reject(new Error('late failure')));
    expect(screen.queryByRole('option')).toBeNull();
  });
});
