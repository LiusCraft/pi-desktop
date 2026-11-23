// @vitest-environment jsdom
import { invoke } from './renderer-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { SessionMeta } from '@shared/protocol';

const { Sidebar } = await import('../src/renderer/src/components/layout/Sidebar');
const { TooltipProvider } = await import('../src/renderer/src/components/ui/tooltip');
const { removeProject, startFromPr } = await import('../src/renderer/src/store/actions');
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
});
