import type { SpawnTask, WorkspaceDefaults } from './protocol';

/** A branch choice always means a fresh worktree, never checking out a branch in-place. */
export function sessionWorkspace(
  project: string,
  defaults?: WorkspaceDefaults,
  task?: Pick<SpawnTask, 'worktree' | 'baseRef'>,
) {
  const choice = defaults?.projects[project];
  const worktree = task?.worktree ?? (task?.baseRef ? true : (defaults?.worktree ?? true));
  const adoptPath = task?.worktree === undefined && !task?.baseRef ? choice?.adoptPath : undefined;
  return {
    worktree,
    adoptPath,
    baseRef: worktree && !adoptPath ? (task?.baseRef ?? choice?.baseRef) : undefined,
  };
}
