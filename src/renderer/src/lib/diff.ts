// Sizing up a change: which diffs are too big to render on open, and how to count
// added / removed lines without re-diffing every file on every change event.
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
function fingerprint(text: string | null | undefined): string {
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
