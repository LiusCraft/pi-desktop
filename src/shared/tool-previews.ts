// Native pi tool results normalized without inventing a before-version or line numbers.

export const PREVIEW_LINES = 200;
export const WINDOW_LINES = 1000;

export interface DiffRow {
  t: ' ' | '+' | '-';
  o?: number;
  n?: number;
  s: string;
  /** Changed character range within the line, for word-level highlighting. */
  wd?: [number, number];
}
export type PreviewRow = DiffRow | { gap: true };

export type ToolPreview =
  | { type: 'error' | 'notice'; text: string; firstChangedLine?: number }
  | { type: 'image'; text: string; images: { mimeType: string; src: string }[] }
  | {
      type: 'code';
      lines: string[];
      startLine: number;
      totalLines: number | null;
      footer: string;
      nextOffset: number | null;
    }
  | { type: 'diff'; rows: PreviewRow[]; add: number; del: number; firstChangedLine: number }
  | { type: 'snapshot'; lines: string[]; startLine: number; empty: boolean; note: string };

interface ToolResultLike {
  content?: unknown;
  details?: any;
}

export const positiveLine = (value: unknown, fallback = 1) =>
  Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;

export const textOf = (content: unknown) =>
  typeof content === 'string'
    ? content
    : (Array.isArray(content) ? content : [])
        .filter((b) => b?.type === 'text')
        .map((b) => String(b.text || ''))
        .join('\n');

const linesOf = (text: string) => String(text).split('\n');

const imageOf = (block: any) => {
  if (!block || block.type !== 'image' || !/^image\/(png|jpeg|gif|webp)$/.test(block.mimeType || '')) return null;
  if (
    typeof block.data !== 'string' ||
    !block.data.length ||
    block.data.length > 28 * 1024 * 1024 ||
    !/^[a-zA-Z0-9+/]*={0,2}$/.test(block.data)
  )
    return null;
  return { mimeType: block.mimeType as string, src: `data:${block.mimeType};base64,${block.data}` };
};

export function read(args: Record<string, any> = {}, result: ToolResultLike = {}, isError = false): ToolPreview {
  const text = textOf(result.content);
  if (isError) return { type: 'error', text };
  const blocks: any[] = Array.isArray(result.content) ? result.content : [];
  const images = blocks.map(imageOf).filter((x): x is NonNullable<typeof x> => !!x);
  if (blocks.some((b) => b?.type === 'image') || text.startsWith('Read image file [image/')) {
    return { type: 'image', text, images };
  }
  const truncation = result.details?.truncation;
  if (truncation?.firstLineExceedsLimit) return { type: 'notice', text };
  // Only a native, terminal continuation footer is metadata. File text remains raw.
  const footer = text.match(
    /\n\n(\[(?:Showing lines (\d+)-(\d+) of (\d+)(?: \([^\]\n]+ limit\))?\. Use offset=(\d+) to continue\.|(\d+) more lines in file\. Use offset=(\d+) to continue\.)\])$/,
  );
  let source = footer ? text.slice(0, footer.index) : text;
  if (truncation?.truncated && typeof truncation.content === 'string') source = truncation.content;
  const startLine = positiveLine(args.offset);
  const lines = linesOf(source);
  const totalLines = footer ? (footer[4] ? Number(footer[4]) : startLine + lines.length - 1 + Number(footer[6])) : null;
  return {
    type: 'code',
    lines,
    startLine,
    totalLines,
    footer: footer?.[1] || '',
    nextOffset: footer ? Number(footer[5] || footer[7]) : null,
  };
}

export function parseNativeDiff(diff: unknown): { rows: PreviewRow[]; add: number; del: number } | null {
  if (typeof diff !== 'string') return null;
  const rows: PreviewRow[] = [];
  let add = 0,
    del = 0;
  for (const line of diff.split('\n')) {
    if (/^ +\.\.\.$/.test(line)) {
      rows.push({ gap: true });
      continue;
    }
    if (!line && !diff) continue;
    const match = line.match(/^([ +-]) *(\d+) (.*)$/);
    if (!match || !positiveLine(match[2], 0)) return null;
    const t = match[1] as DiffRow['t'],
      number = Number(match[2]);
    rows.push({ t, ...(t === '-' ? { o: number } : { n: number }), s: match[3] });
    if (t === '+') add++;
    if (t === '-') del++;
  }
  return { rows, add, del };
}

export function edit(_args: Record<string, any> = {}, result: ToolResultLike = {}, isError = false): ToolPreview {
  const text = textOf(result.content);
  if (isError) return { type: 'error', text };
  const parsed = parseNativeDiff(result.details?.diff);
  const changed = parsed?.rows.find((r): r is DiffRow => 't' in r && (r.t === '+' || r.t === '-'));
  const removed = parsed?.rows.find((r): r is DiffRow => 't' in r && r.t === '-');
  const firstChangedLine = positiveLine(result.details?.firstChangedLine, 0) || (changed?.n ?? removed?.o) || 1;
  if (!parsed)
    return {
      type: 'notice',
      text: typeof result.details?.diff === 'string' ? result.details.diff : text,
      firstChangedLine,
    };
  return { type: 'diff', ...parsed, firstChangedLine };
}

export function write(args: Record<string, any> = {}, result: ToolResultLike = {}, isError = false): ToolPreview {
  if (isError) return { type: 'error', text: textOf(result.content) };
  if (typeof args.content !== 'string') return { type: 'notice', text: textOf(result.content) };
  return {
    type: 'snapshot',
    lines: linesOf(args.content),
    startLine: 1,
    empty: args.content === '',
    note: 'Written content · previous version unavailable',
  };
}

export interface LineWindow {
  lines: string[];
  startLine: number;
  endLine: number;
  totalLines: number;
  targetLine: number;
  previous: number | null;
  next: number | null;
}

// A bounded window can include any target, including lines beyond the first 2,000.
export function lineWindow(text: string, target = 1, start?: number, all = false): LineWindow {
  const lines = linesOf(text),
    total = lines.length;
  const requested = positiveLine(target);
  const targetLine = Math.min(requested, total);
  const from = all
    ? 1
    : Math.max(
        1,
        Math.min(
          positiveLine(start, Math.max(1, requested - Math.floor(WINDOW_LINES / 2))),
          Math.max(1, total - WINDOW_LINES + 1),
        ),
      );
  const to = all ? total : Math.min(total, from + WINDOW_LINES - 1);
  return {
    lines: lines.slice(from - 1, to),
    startLine: from,
    endLine: to,
    totalLines: total,
    targetLine,
    previous: from > 1 ? Math.max(1, from - WINDOW_LINES) : null,
    next: to < total ? from + WINDOW_LINES : null,
  };
}

/** Line diff with word-level ranges for paired -/+ lines (used for git changes and permission previews). */
export function lineDiff(a: string | null | undefined, b: string | null | undefined): DiffRow[] {
  const A = a == null ? [] : a.split('\n');
  const B = b == null ? [] : b.split('\n');
  // Untouched head and tail need no table: only the middle is diffed.
  let head = 0;
  while (head < A.length && head < B.length && A[head] === B[head]) head++;
  let tail = 0;
  while (tail < A.length - head && tail < B.length - head && A[A.length - 1 - tail] === B[B.length - 1 - tail]) tail++;
  const n = A.length - head - tail,
    m = B.length - head - tail;
  const out: DiffRow[] = [];
  for (let k = 0; k < head; k++) out.push({ t: ' ', o: k + 1, n: k + 1, s: A[k] });
  // A very large middle falls back to a whole-block replace instead of an O(n·m) table.
  if (n * m > 4e6) {
    for (let i = 0; i < n; i++) out.push({ t: '-', o: head + i + 1, s: A[head + i] });
    for (let j = 0; j < m; j++) out.push({ t: '+', n: head + j + 1, s: B[head + j] });
  } else {
    const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i][j] = A[head + i] === B[head + j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0,
      j = 0;
    while (i < n && j < m) {
      if (A[head + i] === B[head + j]) {
        out.push({ t: ' ', o: head + i + 1, n: head + j + 1, s: A[head + i] });
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        out.push({ t: '-', o: head + i + 1, s: A[head + i] });
        i++;
      } else {
        out.push({ t: '+', n: head + j + 1, s: B[head + j] });
        j++;
      }
    }
    while (i < n) {
      out.push({ t: '-', o: head + i + 1, s: A[head + i] });
      i++;
    }
    while (j < m) {
      out.push({ t: '+', n: head + j + 1, s: B[head + j] });
      j++;
    }
  }
  for (let k = 0; k < tail; k++)
    out.push({ t: ' ', o: A.length - tail + k + 1, n: B.length - tail + k + 1, s: A[A.length - tail + k] });
  for (let k = 0; k < out.length;) {
    if (out[k].t !== '-') {
      k++;
      continue;
    }
    let d = k;
    while (d < out.length && out[d].t === '-') d++;
    let a2 = d;
    while (a2 < out.length && out[a2].t === '+') a2++;
    const dels = out.slice(k, d),
      adds = out.slice(d, a2);
    for (let x = 0; x < Math.min(dels.length, adds.length); x++) {
      const p = dels[x].s,
        q = adds[x].s;
      let pre = 0;
      while (pre < p.length && pre < q.length && p[pre] === q[pre]) pre++;
      let suf = 0;
      while (suf < p.length - pre && suf < q.length - pre && p[p.length - 1 - suf] === q[q.length - 1 - suf]) suf++;
      if (pre + suf > 0) {
        dels[x].wd = [pre, p.length - suf];
        adds[x].wd = [pre, q.length - suf];
      }
    }
    k = a2;
  }
  return out;
}

export function diffStats(a: string | null | undefined, b: string | null | undefined) {
  const d = lineDiff(a, b);
  return { add: d.filter((r) => r.t === '+').length, del: d.filter((r) => r.t === '-').length };
}
