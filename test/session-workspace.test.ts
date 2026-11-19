import { expect, it } from 'vitest';
import { sessionWorkspace } from '../src/shared/session-workspace';

it('resolves overrides without mutating the welcome choices or borrowing another project’s base', () => {
  const defaults = { worktree: false, projects: { '/a': { baseRef: 'release', adoptPath: '/existing' } } };
  expect(sessionWorkspace('/a', defaults)).toMatchObject({ adoptPath: '/existing', baseRef: undefined });
  expect(sessionWorkspace('/a', defaults, { baseRef: 'origin/dev' })).toEqual({
    worktree: true,
    baseRef: 'origin/dev',
    adoptPath: undefined,
  });
  expect(sessionWorkspace('/a', defaults, { worktree: true })).toEqual({
    worktree: true,
    baseRef: 'release',
    adoptPath: undefined,
  });
  expect(sessionWorkspace('/a', defaults, { worktree: false })).toEqual({
    worktree: false,
    baseRef: undefined,
    adoptPath: undefined,
  });
  expect(sessionWorkspace('/b', defaults, { worktree: true })).toEqual({
    worktree: true,
    baseRef: undefined,
    adoptPath: undefined,
  });
  expect(sessionWorkspace('/a', defaults).adoptPath).toBe('/existing');
});
