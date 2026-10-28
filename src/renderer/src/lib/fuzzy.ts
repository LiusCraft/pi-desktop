// Fuzzy ranking for the composer's / and @ menus. A match is any in-order subsequence of the
// query, scored so that a prefix beats a word start, which beats scattered letters. Entries
// keep their lowercased text, and `fuzzyRank` never sorts the whole list, so a project with
// thousands of paths still ranks in a few milliseconds per keystroke.
export interface FuzzyEntry<T> {
  item: T;
  /** The text as shown. */
  text: string;
  /** `text.toLowerCase()`, computed once when the index is built. */
  lower: string;
}

export interface FuzzyMatch<T> {
  item: T;
  score: number;
}

/** Contiguous hit on the query. */
const SUBSTRING_SCORE = 500;
/** The query opens the text. */
const PREFIX_SCORE = 1000;
/** The query opens a word inside the text (`src/Login.tsx` for "log"). */
const WORD_START_SCORE = 300;
/** Per matched character of a scattered (subsequence) match. */
const CHAR_SCORE = 1;
/** A character right after the previous match. */
const CONSECUTIVE_BONUS = 12;
/** How much a word start is worth inside a scattered match. */
const WORD_START_BONUS = 20;
/** Per skipped character, capped so a long path never drops a good match. */
const GAP_PENALTY = 4;
const MAX_GAP_PENALTY = 40;
/** Long texts lose a little: `a.ts` beats `deep/nested/a.ts` for "a.ts". */
const LENGTH_PENALTY = 0.05;
/** Where a word starts: path separators, spaces and the usual punctuation. */
const WORD_START = /[\s/\\_.-]/;

export const fuzzyEntry = <T>(item: T, text: string): FuzzyEntry<T> => ({ item, text, lower: text.toLowerCase() });

/** 0 when the query does not match; higher is better. Both arguments are lowercased by the caller. */
export function fuzzyScore(query: string, lower: string): number {
  if (!query) return 0;
  const at = lower.indexOf(query);
  if (at >= 0) {
    const wordStart = at === 0 || WORD_START.test(lower[at - 1]);
    return SUBSTRING_SCORE + (at === 0 ? PREFIX_SCORE : wordStart ? WORD_START_SCORE : 0) - Math.min(200, at * 2) - lower.length * LENGTH_PENALTY;
  }
  let score = 0;
  let cursor = 0;
  let previous = -2;
  for (const char of query) {
    const found = lower.indexOf(char, cursor);
    if (found < 0) return 0;
    score += CHAR_SCORE;
    if (found === previous + 1) score += CONSECUTIVE_BONUS;
    else if (found === 0 || WORD_START.test(lower[found - 1])) score += WORD_START_BONUS;
    score -= Math.min(MAX_GAP_PENALTY, (found - cursor) * GAP_PENALTY);
    previous = found;
    cursor = found + 1;
  }
  return score - lower.length * LENGTH_PENALTY;
}

/**
 * The best `limit` entries for `query`, best first. An empty query keeps the caller's order
 * (a freshly opened menu lists what it has, unranked). Ties keep their original order.
 */
export function fuzzyRank<T>(entries: readonly FuzzyEntry<T>[], query: string, limit: number): FuzzyMatch<T>[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries.slice(0, limit).map((entry) => ({ item: entry.item, score: 1 }));
  const best: FuzzyMatch<T>[] = [];
  for (const entry of entries) {
    const score = fuzzyScore(q, entry.lower);
    if (!score) continue;
    if (best.length === limit && score <= best[best.length - 1].score) continue;
    let at = best.length;
    while (at > 0 && best[at - 1].score < score) at--;
    best.splice(at, 0, { item: entry.item, score });
    if (best.length > limit) best.pop();
  }
  return best;
}
