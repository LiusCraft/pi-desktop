// Sizing up a change: which diffs are too big to render on open, and how to count
// added / removed lines without re-diffing every file on every change event.
import type { PrThread } from '@shared/protocol';
import { diffStats } from '@shared/tool-previews';

/** Changed lines (added and removed) from which a file's diff starts folded. */
export const FOLD_LINES = 400;
/** File bytes (old side + new side) from which a diff starts folded, even with few changes. */
export const FOLD_BYTES = 200_000;

export interface ChangeSize {
  add: number;
  del: number;
  before?: string | null;
  after?: string | null;
}

/**
 * A change big enough that rendering its rows would stall the window: either many
 * changed lines, or a large file (where the line diff itself is expensive).
 */
export function isLargeDiff(change: ChangeSize): boolean {
  if (change.add + change.del >= FOLD_LINES) return true;
  return (change.before?.length ?? 0) + (change.after?.length ?? 0) >= FOLD_BYTES;
}

/** FNV-1a over the text plus its length: cheap, and enough to tell revisions apart. */
export function fingerprint(text: string | null | undefined): string {
  if (!text) return '0';
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(36)}:${text.length}`;
}

const CACHE_LIMIT = 500;
const cache = new Map<string, { add: number; del: number }>();

/**
 * `diffStats`, but remembered by content: the agent host reports every changed file on
 * each refresh, and a full line diff is O(lines²) — far more work than a fingerprint.
 */
export function changeStats(path: string, before: string | null, after: string | null) {
  const key = `${path}\u0000${fingerprint(before)}\u0000${fingerprint(after)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const stats = diffStats(before, after);
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, stats);
  return stats;
}

/** The review thread the PR bar's comment chip lands on: first in the order the Diff panel lists files, then by line. */
export function firstThread(files: { path: string }[], threads: PrThread[]): PrThread | undefined {
  for (const f of files) {
    const found = threads.filter((t) => t.path === f.path).sort((a, b) => (a.line ?? 0) - (b.line ?? 0))[0];
    if (found) return found;
  }
  return undefined;
}

/** Which diff row each thread hangs under (its side and line number); the rest have lost their line. */
export function placeThreads(rows: { t: string; o?: number; n?: number }[], threads: PrThread[]) {
  const placed = new Map<number, PrThread[]>();
  const lost: PrThread[] = [];
  for (const t of threads) {
    const k = rows.findIndex((r) => (t.side === 'old' ? r.t === '-' && r.o === t.line : r.t !== '-' && r.n === t.line));
    if (k < 0) lost.push(t);
    else placed.set(k, [...(placed.get(k) ?? []), t]);
  }
  return { placed, lost };
}
