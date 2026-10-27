// Reading a pull request for the composer's PR bar: which badge it deserves, how big it is,
// and whether CI leaves it in a state automation may act on. Pure, so the bar stays presentational.
import type { PrStatus } from '@shared/protocol';
import { tr } from './i18n/runtime';

/** A PR the bar can read: the full status after a poll, or just the identity persisted with the session. */
export type PrLike = Pick<PrStatus, 'num' | 'url' | 'state' | 'draft'> & Partial<PrStatus>;

/** The parts of a PR each question needs; identity fields may be all we have before the first poll. */
type Status = Pick<PrStatus, 'state' | 'draft'> & Partial<Pick<PrStatus, 'ci' | 'mergeable'>>;

export type PrTone = 'conflict' | 'review' | 'fail' | 'running' | 'ready' | 'draft' | 'open' | 'merged' | 'closed';

export interface PrBadge {
  label: string;
  tone: PrTone;
}

/** A PR is one thing at a glance: what still blocks the merge, else where it stands. */
export function prBadge(pr: Status & Partial<Pick<PrStatus, 'review'>>): PrBadge {
  if (pr.state === 'merged') return { label: tr('pr.merged'), tone: 'merged' };
  if (pr.state === 'closed') return { label: tr('pr.closed'), tone: 'closed' };
  if (pr.draft) return { label: tr('pr.draft'), tone: 'draft' };
  if (pr.mergeable === 'conflicting') return { label: tr('pr.conflicts'), tone: 'conflict' };
  if (pr.ci === 'fail') return { label: tr('pr.checksFailing'), tone: 'fail' };
  if (pr.ci === 'pending') return { label: tr('pr.checksRunning'), tone: 'running' };
  if (pr.review === 'changes') return { label: tr('pr.changesRequested'), tone: 'review' };
  if (pr.ci === 'pass') return { label: tr('pr.ready'), tone: 'ready' };
  return { label: tr('pr.open'), tone: 'open' };
}

/** Lines and files the PR touches; null while the host has not told us, so the bar can show the working tree instead. */
export function prSize(pr: Pick<PrStatus, 'additions' | 'deletions' | 'files'>): { add: number; del: number; files: number | null } | null {
  if (pr.additions == null && pr.deletions == null) return null;
  return { add: pr.additions ?? 0, del: pr.deletions ?? 0, files: pr.files ?? null };
}

/** The host says this can merge and nothing is red, running or waiting on changes: a good moment for auto-merge. */
export function prReady(pr: Status & Partial<Pick<PrStatus, 'review'>>) {
  return pr.state === 'open' && !pr.draft && pr.mergeable === 'clean' && pr.ci !== 'fail' && pr.ci !== 'pending' && pr.review !== 'changes';
}

/** The failing commit a fix belongs to; keyed by commit so the same red run is only fixed once. */
export function prFixKey(pr: Pick<PrStatus, 'num' | 'ci' | 'head'>): string | null {
  if (pr.ci !== 'fail' || !pr.head) return null;
  return `${pr.num}:${pr.head}`;
}

/** One line for the CI panel: how many checks exist and what they are doing. */
export function prCiLine(pr: Pick<PrLike, 'ci'> & Partial<Pick<PrStatus, 'checks'>>): string {
  const checks = pr.checks ?? [];
  const n = checks.length;
  if (!n) return tr('pr.noChecks');
  const plural = (k: number) => tr(k > 1 ? 'pr.checkMany' : 'pr.checkOne', { n: k });
  if (pr.ci === 'fail') {
    const failed = checks.filter((c) => c.st === 'fail').length;
    return tr('pr.checksFailed', { failed, checks: plural(n) });
  }
  if (pr.ci === 'pending') return tr('pr.checksRunningLine', { checks: plural(checks.filter((c) => c.st === 'pending').length || n) });
  return tr('pr.checksAllPassed', { checks: plural(n) });
}

/** `owner/repo` (GitLab: `group/subgroup/project`) straight from the PR URL, so the card names the repository the way the host does. */
export function prRepo(url: string, fallback: string): string {
  const m = /^https?:\/\/(?:github\.com|[^/]*gitlab[^/]*)\/(.+?)\/(?:-\/)?(?:pull|merge_requests)\/\d+/.exec(url);
  return m ? m[1] : fallback;
}

/** Thousands separators for the line counts: an 8k-line PR is unreadable as `+8251`. */
export const fmtLines = (n: number) => n.toLocaleString('en-US');
