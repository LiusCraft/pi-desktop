// Reading a pull request for the composer's PR bar: which badge it deserves, how big it is,
// and whether CI leaves it in a state automation may act on. Pure, so the bar stays presentational.
import type { PrStatus } from '@shared/protocol';

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
  if (pr.state === 'merged') return { label: 'Merged', tone: 'merged' };
  if (pr.state === 'closed') return { label: 'Closed', tone: 'closed' };
  if (pr.draft) return { label: 'Draft', tone: 'draft' };
  if (pr.mergeable === 'conflicting') return { label: 'Merge conflicts', tone: 'conflict' };
  if (pr.ci === 'fail') return { label: 'Checks failing', tone: 'fail' };
  if (pr.ci === 'pending') return { label: 'Checks running', tone: 'running' };
  if (pr.review === 'changes') return { label: 'Changes requested', tone: 'review' };
  if (pr.ci === 'pass') return { label: 'Ready to merge', tone: 'ready' };
  return { label: 'Open', tone: 'open' };
}

/** Lines and files the PR touches; null while GitHub has not told us, so the bar can show the working tree instead. */
export function prSize(pr: Pick<PrStatus, 'additions' | 'deletions' | 'files'>): { add: number; del: number; files: number | null } | null {
  if (pr.additions == null && pr.deletions == null) return null;
  return { add: pr.additions ?? 0, del: pr.deletions ?? 0, files: pr.files ?? null };
}

/** GitHub says this can merge and nothing is red, running or waiting on changes: a good moment for auto-merge. */
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
  if (!n) return 'No checks reported yet.';
  const plural = (k: number) => `${k} check${k > 1 ? 's' : ''}`;
  if (pr.ci === 'fail') {
    const failed = checks.filter((c) => c.st === 'fail').length;
    return `${failed} of ${plural(n)} failing`;
  }
  if (pr.ci === 'pending') return `${plural(checks.filter((c) => c.st === 'pending').length || n)} running…`;
  return `All ${plural(n)} passed`;
}

/** `owner/repo` straight from the PR URL, so the card names the repository the way GitHub does. */
export function prRepo(url: string, fallback: string): string {
  const m = /github\.com\/([^/]+)\/([^/]+)/.exec(url);
  return m ? `${m[1]}/${m[2]}` : fallback;
}

/** Thousands separators for the line counts: an 8k-line PR is unreadable as `+8251`. */
export const fmtLines = (n: number) => n.toLocaleString('en-US');
