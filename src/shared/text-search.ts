// Finding a string in text: the Files and Diff panels' find bars run it on what they hold,
// and the agent host runs it over the project's files for "search in all files".

/** Matches kept per search; a broader query is reported as truncated rather than flooding the list. */
export const SEARCH_MAX_MATCHES = 500;
/** Longest line shown in a result; a longer one is cut around the match. */
export const SEARCH_SNIPPET_CHARS = 200;
/** How much of the line before the match stays visible when it is cut. */
const SNIPPET_LEAD_CHARS = 40;

/** The first hit on a line of text. */
export interface LineMatch {
  /** 1-based. */
  line: number;
  /** The line, trimmed and cut for display. */
  text: string;
  /** The hit inside `text`. */
  start: number;
  end: number;
}

/** One entry per line that contains `query`, at most `limit` of them. */
export function findInText(text: string, query: string, caseSensitive: boolean, limit = SEARCH_MAX_MATCHES): LineMatch[] {
  if (!query) return [];
  const needle = caseSensitive ? query : query.toLowerCase();
  const out: LineMatch[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length && out.length < limit; i++) {
    const raw = lines[i].replace(/\r$/, '');
    const at = (caseSensitive ? raw : raw.toLowerCase()).indexOf(needle);
    if (at < 0) continue;
    const indent = raw.length - raw.trimStart().length;
    // Keep the hit in view: drop the indentation, then cut a long line around the match.
    let from = Math.min(indent, at);
    if (at - from + needle.length > SEARCH_SNIPPET_CHARS) from = Math.max(from, at - SNIPPET_LEAD_CHARS);
    const text = raw.slice(from, from + SEARCH_SNIPPET_CHARS).trimEnd();
    out.push({ line: i + 1, text, start: at - from, end: Math.min(at - from + needle.length, text.length) });
  }
  return out;
}

/** A hit somewhere in the project. */
export interface SearchMatch extends LineMatch {
  path: string;
}

export interface SearchResult {
  matches: SearchMatch[];
  /** There were more than `SEARCH_MAX_MATCHES`. */
  truncated: boolean;
}
