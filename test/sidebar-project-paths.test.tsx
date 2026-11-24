// @vitest-environment jsdom
import { invoke } from './renderer-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { SessionMeta } from '@shared/protocol';

const { Sidebar } = await import('../src/renderer/src/components/layout/Sidebar');
const { TooltipProvider } = await import('../src/renderer/src/components/ui/tooltip');
const { handleHostEvent, removeProject, startFromPr } = await import('../src/renderer/src/store/actions');
const { getApp, setApp } = await import('../src/renderer/src/store/app');
const { dialogs } = await import('../src/renderer/src/store/dialogs');
const { emptySession } = await import('../src/renderer/src/store/transcript');

const registered = 'F:\\coding\\app';
const alias = 'F:/coding/app';
const other = 'F:/other/app';
const project = (path: string) => ({ path, name: 'app', addedAt: 1 });

const regular: SessionMeta = {
  id: 'regular',
  kind: 'code',
  title: 'Regular session',
  autoName: false,
  titleLocked: false,
  autoNamed: false,
  nameAttempted: false,
  projectPath: registered,
  cwd: registered,
  branch: 'main',
  baseBranch: 'main',
  baseCommit: null,
  worktree: false,
  mode: 'auto',
  outputStyle: 'default',
  sessionFile: 'regular.jsonl',
  createdAt: 1,
  updatedAt: 1,
  pr: null,
};
const imported: SessionMeta = {
  ...regular,
  id: 'imported-pr',
  title: '#42 · Fix',
  projectPath: alias,
  cwd: 'F:/worktrees/app-pr',
  branch: 'pi-desktop/fix',
  worktree: true,
  sessionFile: 'imported-pr.jsonl',
  parentId: regular.id,
};
const unrelated = { ...regular, id: 'unrelated', title: 'Different repository', projectPath: other, cwd: other };

beforeEach(() => {
  setApp((st) => {
    st.view = 'code';
    st.current = null;
    st.prImport = null;
    st.adopt = null;
    st.prefs.project = null;
    st.projects = [project(registered), project(alias), project(other)];
    st.sessions = Object.fromEntries([regular, imported, unrelated].map((meta) => [meta.id, emptySession(meta)]));
  });
});

it('groups legacy aliases without touching session data or merging another repository with the same name', () => {
  const before = getApp().sessions;
  render(
    <TooltipProvider>
      <Sidebar />
    </TooltipProvider>,
  );
  const folders = screen.getAllByRole('button', { name: 'app' });
  expect(folders).toHaveLength(2);
  expect(screen.getByRole('button', { name: regular.title })).toBeTruthy();
  expect(screen.getByRole('button', { name: imported.title })).toBeTruthy();
  fireEvent.click(folders[0]);
  expect(screen.queryByRole('button', { name: regular.title })).toBeNull();
  expect(screen.queryByRole('button', { name: imported.title })).toBeNull();
  expect(screen.getByRole('button', { name: unrelated.title })).toBeTruthy();
  expect(getApp().sessions).toBe(before);
  expect(invoke).not.toHaveBeenCalled();
});

it('expands the combined session list and keeps an older active session visible', () => {
  const older = Array.from({ length: 4 }, (_, i) => ({
    ...regular,
    id: `older-${i}`,
    title: `Older session ${i}`,
    projectPath: i % 2 ? registered : alias,
    updatedAt: -i,
  }));
  const hidden = older[3];
  setApp((st) => {
    st.projects = [project(other)]; // Sessions must still group even without a registered project.
    for (const meta of older) st.sessions[meta.id] = emptySession(meta);
    st.current = hidden.id;
    st.sessions[unrelated.id].meta.pinned = true;
  });
  render(
    <TooltipProvider>
      <Sidebar />
    </TooltipProvider>,
  );

  expect(screen.getByRole('button', { name: hidden.title })).toBeTruthy();
  act(() => setApp((st) => void (st.current = null)));
  expect(screen.queryByRole('button', { name: hidden.title })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
  expect(screen.getByRole('button', { name: hidden.title })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
});

it('moves a newly merged session below unfinished sessions before applying the folder limit', async () => {
  const pr = { num: 42, url: 'https://github.com/acme/app/pull/42', state: 'open', draft: false };
  const merging = { ...imported, parentId: undefined, pr, updatedAt: 10 };
  const older = Array.from({ length: 4 }, (_, i) => ({
    ...regular,
    id: `unfinished-${i}`,
    title: `Unfinished session ${i}`,
    updatedAt: -i,
  }));
  const last = older[3];
  setApp((st) => {
    st.sessions[merging.id] = emptySession(merging);
    for (const meta of older) st.sessions[meta.id] = emptySession(meta);
  });
  render(
    <TooltipProvider>
      <Sidebar />
    </TooltipProvider>,
  );

  expect(screen.getByRole('button', { name: merging.title })).toBeTruthy();
  expect(screen.queryByRole('button', { name: last.title })).toBeNull();

  act(() => {
    handleHostEvent({
      type: 'pr',
      sessionId: merging.id,
      status: { ...pr, state: 'merged', ci: 'pass', checks: [], comments: 0 },
    });
  });
  expect(await screen.findByRole('button', { name: last.title })).toBeTruthy();
  expect(screen.queryByRole('button', { name: merging.title })).toBeNull();

  act(() => handleHostEvent({ type: 'pr', sessionId: merging.id, status: null }));
  await waitFor(() => expect(getApp().sessions[merging.id].pr).toBeNull());
  expect(screen.queryByRole('button', { name: merging.title })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
  const rows = screen.getAllByRole('button', {
    name: (name) => [regular, ...older, merging].some((meta) => meta.title === name),
  });
  expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(
    [regular, ...older, merging].map((meta) => meta.title),
  );
});

it('keeps pinned sessions on top and separates forks with a different merge state', () => {
  const mergedPr = { num: 42, url: 'https://github.com/acme/app/pull/42', state: 'merged', draft: false };
  const parent = { ...regular, pr: mergedPr, updatedAt: 10 };
  const pinned = { ...unrelated, pinned: true, pr: mergedPr };
  setApp((st) => {
    st.sessions[parent.id] = emptySession(parent);
    st.sessions[pinned.id] = emptySession(pinned);
  });
  render(
    <TooltipProvider>
      <Sidebar />
    </TooltipProvider>,
  );

  const titles = [pinned.title, imported.title, parent.title];
  const rows = screen.getAllByRole('button', { name: (name) => titles.includes(name) });
  expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(titles);
  expect(rows[1].closest('[draggable="true"]')).not.toBeNull();
});

it('allows manual ordering within a merge group, but not across groups', () => {
  const first = { ...regular, id: 'drag-first', title: 'First unfinished', updatedAt: 2 };
  const second = { ...regular, id: 'drag-second', title: 'Second unfinished' };
  const merged = {
    ...regular,
    id: 'drag-merged',
    title: 'Merged session',
    pr: { num: 42, url: 'https://github.com/acme/app/pull/42', state: 'merged', draft: false },
  };
  setApp((st) => {
    st.sessions = Object.fromEntries([first, second, merged].map((meta) => [meta.id, emptySession(meta)]));
  });
  render(
    <TooltipProvider>
      <Sidebar />
    </TooltipProvider>,
  );

  const row = (name: string) => screen.getByRole('button', { name }).closest('[draggable="true"]')!;
  fireEvent.dragStart(row(first.title), { dataTransfer: { setData: vi.fn() } });
  fireEvent.drop(row(merged.title));
  expect(localStorage.getItem('pi.sidebar.order')).toBeNull();
  fireEvent.drop(row(second.title));
  const titles = [second.title, first.title, merged.title];
  expect(
    screen
      .getAllByRole('button', { name: (name) => titles.includes(name) })
      .map((row) => row.getAttribute('aria-label')),
  ).toEqual(titles);
});

it('reopens an existing PR session without registering its legacy project path again', async () => {
  setApp((st) => {
    st.projects = [project(registered)];
    st.sessions[imported.id].loaded = true;
  });
  vi.spyOn(dialogs, 'prompt').mockResolvedValue('https://github.com/acme/app/pull/42');
  invoke.mockImplementation(async (channel) => {
    if (channel === 'sessions:fromPr') return { kind: 'session', meta: imported };
    if (channel === 'work:resolveCode') return 'linked';
    return null;
  });

  await startFromPr();

  expect(invoke).toHaveBeenCalledWith(
    'sessions:fromPr',
    expect.any(String),
    [registered],
    null,
    expect.any(Object),
    expect.any(String),
  );
  expect(invoke.mock.calls.some(([channel]) => channel === 'projects:addPath')).toBe(false);
  expect(getApp().current).toBe(imported.id);
  expect(getApp().sessions[imported.id].meta).toEqual(imported);
});

it('only archives sessions under the grouped path when removal is explicitly confirmed', async () => {
  setApp((st) => {
    st.current = imported.id;
    st.prefs.project = alias;
    st.adopt = { mainRoot: alias, path: imported.cwd, branch: imported.branch };
    const archived = { ...regular, id: 'archived', archived: true };
    const work = { ...regular, id: 'work', kind: 'work' } satisfies SessionMeta;
    st.sessions[archived.id] = emptySession(archived);
    st.sessions[work.id] = emptySession(work);
  });
  const confirm = vi.spyOn(dialogs, 'confirm').mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  invoke.mockImplementation(async (channel) => (channel === 'projects:remove' ? [project(other)] : null));

  await removeProject(registered);
  expect(confirm).toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();

  await removeProject(registered);
  expect(invoke.mock.calls).toEqual([
    ['sessions:archive', regular.id],
    ['sessions:archive', imported.id],
    ['projects:remove', registered],
  ]);
  expect(getApp().sessions[unrelated.id].meta).toEqual(unrelated);
  expect(getApp().current).toBeNull();
  expect(getApp().prefs.project).toBe(other);
  expect(getApp().adopt).toBeNull();
});

it('keeps the session and worktree selection of a different project when removing an alias', async () => {
  const adopt = { mainRoot: other, path: 'F:/worktrees/other', branch: 'feature' };
  setApp((st) => {
    st.current = unrelated.id;
    st.prefs.project = other;
    st.adopt = adopt;
  });
  vi.spyOn(dialogs, 'confirm').mockResolvedValue(true);
  invoke.mockImplementation(async (channel) => (channel === 'projects:remove' ? [project(other)] : null));

  await removeProject(alias);
  expect(getApp().current).toBe(unrelated.id);
  expect(getApp().prefs.project).toBe(other);
  expect(getApp().adopt).toEqual(adopt);
});
