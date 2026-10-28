// Tool output shown in the transcript: plain text plus ```fenced code blocks, which are worth
// highlighting instead of dumping them into one wrapped monospace wall.

/** One run of a tool output: prose, or a fenced code block. */
export type OutputSegment = { kind: 'text'; text: string } | { kind: 'code'; lang: string; code: string };

const FENCE = /^```([\w+#.-]*)$/;
const FENCE_END = '```';
const BLANK_EDGES = /^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/;

/** Index of the line closing a fence opened just before `from`, or -1. */
function closingFence(lines: string[], from: number): number {
  for (let i = from; i < lines.length; i++) if (lines[i].trim() === FENCE_END) return i;
  return -1;
}

/** Split output into text and ```fenced code; a fence that is never closed stays text. */
export function splitFences(output: string): OutputSegment[] {
  const lines = output.split('\n');
  const segments: OutputSegment[] = [];
  let pending: string[] = [];
  const flush = () => {
    const text = pending.join('\n').replace(BLANK_EDGES, '');
    if (text) segments.push({ kind: 'text', text });
    pending = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE.exec(lines[i].trim());
    const close = open ? closingFence(lines, i + 1) : -1;
    if (!open || close < 0) {
      pending.push(lines[i]);
      continue;
    }
    flush();
    segments.push({ kind: 'code', lang: open[1], code: lines.slice(i + 1, close).join('\n') });
    i = close;
  }
  flush();
  return segments;
}

/** The first lines the codemode tool puts before a script's output. */
const SCRIPT_HEADER = /^Script (completed|failed)\nWall time ([\d.]+) seconds\nOutput:\n/;

/** The header codemode prints above a script's output, so the panel can show it as one meta line. */
export function splitScriptHeader(output: string): { ok: boolean; secs: string; body: string } | null {
  const m = SCRIPT_HEADER.exec(output);
  return m ? { ok: m[1] === 'completed', secs: m[2], body: output.slice(m[0].length) } : null;
}

/** Longest text worth parsing as JSON; tool output in the transcript is capped well below this. */
const MAX_JSON_CHARS = 100_000;

/**
 * A tool that returned one JSON object or array, so the panel can lay it out as data. A bare
 * number or string is not structured information and stays text.
 */
export function parseJsonOutput(text: string): { value: object } | null {
  const body = text.trim();
  const bracketed = /^[{[][\s\S]*[}\]]$/.test(body);
  if (!bracketed || body.length > MAX_JSON_CHARS) return null;
  try {
    const value = JSON.parse(body);
    return typeof value === 'object' && value !== null ? { value } : null;
  } catch {
    return null;
  }
}
