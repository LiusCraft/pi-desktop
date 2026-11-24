import type { SessionView } from './types';

export const SESSION_GROUPS = ['attention', 'recent', 'merged'] as const;

export function isSessionMerged(s: SessionView): boolean {
  return (s.pr ?? s.meta.pr)?.state === 'merged';
}

export function sessionGroup(s: SessionView): (typeof SESSION_GROUPS)[number] {
  if (isSessionMerged(s)) return 'merged';
  if (s.waiting || s.unread || s.pr?.ci === 'fail' || s.pr?.review === 'changes' || s.pr?.mergeable === 'conflicting') {
    return 'attention';
  }
  return 'recent';
}

export function switcherSessions(sessions: Record<string, SessionView>, query: string) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return Object.values(sessions)
    .filter(
      ({ meta }) =>
        !meta.archived &&
        words.every((w) => `${meta.title} ${meta.kind} ${meta.projectPath}`.toLowerCase().includes(w)),
    )
    .sort((a, b) => (b.meta.lastResponseAt ?? 0) - (a.meta.lastResponseAt ?? 0) || b.meta.createdAt - a.meta.createdAt);
}
