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
  if (prReady(pr)) return { label: tr('pr.ready'), tone: 'ready' };
  return { label: tr('pr.open'), tone: 'open' };
}

/** Lines and files the PR touches; null while the host has not told us, so the bar can show the working tree instead. */
export function prSize(
  pr: Pick<PrStatus, 'additions' | 'deletions' | 'files'>,
): { add: number; del: number; files: number | null } | null {
  if (pr.additions == null && pr.deletions == null) return null;
  return { add: pr.additions ?? 0, del: pr.deletions ?? 0, files: pr.files ?? null };
}

/** No checks reported yet is not a green build: jobs may not even have been scheduled. */
export function prReady(pr: Status & Partial<Pick<PrStatus, 'review'>>) {
  return pr.state === 'open' && !pr.draft && pr.mergeable === 'clean' && pr.ci === 'pass' && pr.review !== 'changes';
}

/** CI results belong to a particular head of a particular PR. */
export function prHeadKey(pr: Pick<PrStatus, 'num' | 'head'>): string | null {
  return pr.head ? `${pr.num}:${pr.head}` : null;
}

export function prFixKey(pr: Pick<PrStatus, 'num' | 'ci' | 'head'>): string | null {
  return pr.ci === 'fail' ? prHeadKey(pr) : null;
}

/** One line for the CI panel: how many checks exist and what they are doing. */
export function prCiLine(pr: Pick<PrLike, 'ci'> & Partial<Pick<PrStatus, 'checks'>>): string {
  const checks = pr.checks ?? [];
  const n = checks.length;
  const plural = (k: number) => tr(k > 1 ? 'pr.checkMany' : 'pr.checkOne', { n: k });
  if (pr.ci === 'fail') {
    const failed = checks.filter((c) => c.st === 'fail').length;
    return failed ? tr('pr.checksFailed', { failed, checks: plural(n) }) : tr('pr.checksFailing');
  }
  if (pr.ci === 'pending') {
    const pending = checks.filter((c) => c.st === 'pending').length;
    return pending ? tr('pr.checksRunningLine', { checks: plural(pending) }) : tr('pr.waitingForCi');
  }
  return n ? tr('pr.checksAllPassed', { checks: plural(n) }) : tr('pr.noChecks');
}

/** `owner/repo` (GitLab: `group/subgroup/project`) straight from the PR URL, so the card names the repository the way the host does. */
export function prRepo(url: string, fallback: string): string {
  const m = /^https?:\/\/(?:github\.com|[^/]*gitlab[^/]*)\/(.+?)\/(?:-\/)?(?:pull|merge_requests)\/\d+/.exec(url);
  return m ? m[1] : fallback;
}

/** Thousands separators for the line counts: an 8k-line PR is unreadable as `+8251`. */
export const fmtLines = (n: number) => n.toLocaleString('en-US');
