// Code and path context captured in the composer. Serialized into ordinary prompt
// text at send time so CLI sessions and every API family can read it unchanged.
//
// A reference picked with @ also leaves a token in the message text (`@diff`,
// `@term:zsh-1`, `@session:fix-login-bug`); the transcript and the composer draw
// that token as a badge, and the decode below brings the reference back after a reload.
export type ContextKind = 'excerpt' | 'comment' | 'path' | 'quote' | 'diff' | 'terminal' | 'session';

export interface ContextReference {
  id: string;
  kind: ContextKind;
  path: string;
  directory?: boolean;
  startLine?: number;
  endLine?: number;
  side?: 'old' | 'new' | 'mixed';
  text?: string;
  comment?: string;
  /** The token typed in the message. Only @ references have one. */
  token?: string;
  /** session: the other session to read. terminal: the tab's title. */
  sessionId?: string;
  title?: string;
}

export const MAX_CONTEXT_CHARS = 100_000;
export const MAX_CONTEXT_ITEMS = 20;

/** @ tokens that stand for attached context rather than a path. */
export const DIFF_TOKEN = '@diff';
export const TERMINAL_TOKEN_PREFIX = '@term:';
export const SESSION_TOKEN_PREFIX = '@session:';

/** Location strings. They are prompt text (English, like the block headers) and what decode reads back. */
const DIFF_LOCATION = 'changes since the session base';
const TERMINAL_LOCATION = 'terminal: ';
const SESSION_LOCATION = 'session: ';

/** A title folded into one token: words joined by dashes, so the token survives as a word. */
export function tokenSlug(title: string): string {
  const slug = title
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'ref';
}
export const terminalToken = (title: string) => `${TERMINAL_TOKEN_PREFIX}${tokenSlug(title)}`;
export const sessionToken = (title: string) => `${SESSION_TOKEN_PREFIX}${tokenSlug(title)}`;

/** The token a reference is drawn by; undefined for card-only references. */
export function referenceToken(reference: ContextReference): string | undefined {
  if (reference.token) return reference.token;
  if (reference.kind === 'diff') return DIFF_TOKEN;
  if (reference.kind === 'terminal') return terminalToken(reference.title ?? '');
  if (reference.kind === 'session') return sessionToken(reference.title ?? '');
  return undefined;
}

export function referenceLocation(reference: ContextReference): string {
  if (reference.kind === 'diff') return DIFF_LOCATION;
  if (reference.kind === 'terminal') return `${TERMINAL_LOCATION}${reference.title ?? ''}`;
  if (reference.kind === 'session')
    return `${SESSION_LOCATION}${reference.title ?? ''} (id ${reference.sessionId ?? ''})`;
  if (reference.kind === 'quote') return 'conversation';
  const range = reference.startLine
    ? `:${reference.startLine}${reference.endLine && reference.endLine !== reference.startLine ? `–${reference.endLine}` : ''}`
    : '';
  const side =
    reference.side === 'old' ? ' (before change)' : reference.side === 'mixed' ? ' (diff, old/new line numbers)' : '';
  return `${reference.path}${reference.directory && !reference.path.endsWith('/') ? '/' : ''}${range}${side}`;
}

/** One changed file as the @diff block lists it: path and line counts, nothing the model cannot read itself. */
export interface ChangedFileSummary {
  path: string;
  status: 'A' | 'M' | 'D';
  binary: boolean;
  add: number;
  del: number;
}

/** The @diff block body: every changed file with its line counts. */
export function diffSummaryText(files: ChangedFileSummary[]): string {
  if (!files.length) return 'No changes.';
  const total = files.reduce((sum, file) => sum + file.add, 0);
  const removed = files.reduce((sum, file) => sum + file.del, 0);
  const lines = [`${files.length} changed file${files.length === 1 ? '' : 's'}, +${total} −${removed}`];
  for (const file of files) {
    const mark = file.status === 'A' ? ' (new)' : file.status === 'D' ? ' (deleted)' : '';
    lines.push(file.binary ? `${file.path}${mark} (binary)` : `${file.path}${mark}  +${file.add} −${file.del}`);
  }
  return lines.join('\n');
}

export function referencePrompt(text: string, references: ContextReference[]): string {
  if (!references.length) return text;
  const blocks = references.map((reference) => {
    const location = referenceLocation(reference);
    const lines = [
      `${reference.kind === 'comment' ? 'Comment on' : reference.kind === 'quote' ? 'Reply to a passage of the' : 'Context from'} ${JSON.stringify(location)}`,
    ];
    if (reference.kind === 'session') {
      lines.push(
        'Another session of this project, attached as a pointer only: its messages are not included. ' +
          `Read them with pidesk_read_session(session_id: "${reference.sessionId ?? ''}") when they matter.`,
      );
    }
    if (reference.text !== undefined) {
      const longest = Math.max(2, ...Array.from(reference.text.matchAll(/`+/g), (match) => match[0].length));
      const fence = '`'.repeat(longest + 1);
      lines.push(`${fence}\n${reference.text}\n${fence}`);
    }
    if (reference.comment?.trim()) lines.push(reference.comment.trim());
    return lines.join('\n\n');
  });
  return [text.trimEnd(), 'Attached context:', ...blocks].filter(Boolean).join('\n\n');
}

const ATTACHED_MARK = 'Attached context:';
const BLOCK_HEAD = /^(Comment on|Reply to a passage of the|Context from) ("(?:[^"\\]|\\.)*")/;
const LOCATION = /^(.*?)(?::(\d+)(?:–(\d+))?)?( \(before change\)| \(diff, old\/new line numbers\))?$/;
const HEAD_KINDS: Record<string, ContextReference['kind']> = {
  'Comment on': 'comment',
  'Reply to a passage of the': 'quote',
  'Context from': 'excerpt',
};
const SESSION_LOCATION_BACK = /^session: (.*) \(id ([^()]*)\)$/;

/** The reference an @ block stands for, read back from its location; null for cards and paths. */
function tokenReference(id: string, location: string): ContextReference | null {
  if (location === DIFF_LOCATION) return { id, kind: 'diff', path: '', token: DIFF_TOKEN };
  if (location.startsWith(TERMINAL_LOCATION)) {
    const title = location.slice(TERMINAL_LOCATION.length);
    return { id, kind: 'terminal', path: '', title, token: terminalToken(title) };
  }
  const session = SESSION_LOCATION_BACK.exec(location);
  if (session)
    return { id, kind: 'session', path: '', title: session[1], sessionId: session[2], token: sessionToken(session[1]) };
  return null;
}

/** The inverse of `referencePrompt`, for showing a sent message as text plus badges; null when it carries no context. */
export function decodeReferencePrompt(prompt: string): { text: string; references: ContextReference[] } | null {
  const at = prompt.startsWith(`${ATTACHED_MARK}\n\n`) ? 0 : prompt.indexOf(`\n\n${ATTACHED_MARK}\n\n`) + 2;
  if (at < 2 && at !== 0) return null;
  const text = prompt.slice(0, Math.max(0, at - 2));
  const references: ContextReference[] = [];
  let rest = prompt.slice(at + ATTACHED_MARK.length + 2);
  while (rest) {
    const head = BLOCK_HEAD.exec(rest);
    if (!head) return null;
    let location: string;
    try {
      location = JSON.parse(head[2]);
    } catch {
      return null;
    }
    const id = `sent-${references.length}`;
    const special = tokenReference(id, location);
    const reference: ContextReference = special ?? { id, kind: HEAD_KINDS[head[1]], path: location };
    if (!special && reference.kind !== 'quote') {
      // Undo `referenceLocation`: "<path>[/][:start[–end]][ (side note)]".
      const parts = LOCATION.exec(location);
      if (parts) {
        reference.path = parts[1];
        if (parts[2]) reference.startLine = Number(parts[2]);
        if (parts[3]) reference.endLine = Number(parts[3]);
        if (parts[4]) reference.side = parts[4].includes('before') ? 'old' : 'mixed';
      }
    } else if (reference.kind === 'quote') reference.path = '';
    rest = rest.slice(head[0].length).replace(/^\n\n/, '');
    const fence = /^(`{3,})\n/.exec(rest);
    if (fence) {
      const close = rest.indexOf(`\n${fence[1]}`, fence[0].length - 1);
      if (close < 0) return null;
      reference.text = rest.slice(fence[0].length, close);
      rest = rest.slice(close + 1 + fence[1].length).replace(/^\n\n/, '');
    }
    const next = rest.search(/\n\n(?:Comment on|Reply to a passage of the|Context from) "/);
    const comment = (next < 0 ? rest : rest.slice(0, next)).trim();
    if (comment) reference.comment = comment;
    if (reference.kind === 'excerpt' && reference.text === undefined) {
      // "Context from" with no excerpt is a file or folder.
      reference.kind = 'path';
      reference.directory = reference.path.endsWith('/');
      if (reference.directory) reference.path = reference.path.slice(0, -1);
    }
    references.push(reference);
    rest = next < 0 ? '' : rest.slice(next + 2);
  }
  return references.length ? { text, references } : null;
}

/** A message split into what is drawn as text and what becomes a badge. */
export type MessageSegment =
  | { kind: 'text'; text: string }
  | { kind: 'command'; token: string }
  /** `reference` is null for a path the user typed without picking it: the badge still opens the file. */
  | { kind: 'reference'; token: string; reference: ContextReference | null };

export interface SegmentOptions {
  /**
   * Whether a hand-typed `@path` names something real. Given, only a real path becomes a
   * badge; without it every path-shaped token does (sent messages, older transcripts).
   */
  isKnownPath?: (path: string) => boolean;
}

/** A segment plus where it sits in the text. */
export interface MessageSpan {
  start: number;
  end: number;
  segment: MessageSegment;
}

const COMMAND_TOKEN = /^\/[A-Za-z][\w:.-]*/;
const PATH_TOKEN = /^@[\p{L}\p{N}_./-]+/u;
/** @ tokens that only mean something with a captured reference; typed by hand they stay text. */
const RESERVED_TOKEN = /^@(?:diff$|term:|session:)/;
/** Characters a token continues with: a known token followed by one of them is a longer word, not a match. */
const TOKEN_CHAR = /[\p{L}\p{N}_./:@-]/u;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

/**
 * Split a composed or sent message into text and badges: a leading /command, @ paths, and
 * the tokens of the @ context references. Cheap enough to run on every keystroke.
 */
export function messageSegments(
  text: string,
  references: ContextReference[] = [],
  options: SegmentOptions = {},
): MessageSegment[] {
  if (!text) return [];
  const known = new Map<string, ContextReference>();
  for (const reference of references) {
    const token = referenceToken(reference);
    if (token) known.set(token, reference);
  }
  const tokens = [...known.keys()].sort((a, b) => b.length - a.length);
  const out: MessageSegment[] = [];
  let plain = '';
  const flush = () => {
    if (!plain) return;
    out.push({ kind: 'text', text: plain });
    plain = '';
  };
  let at = 0;
  while (at < text.length) {
    const char = text[at];
    const startsWord = at === 0 || /\s/.test(text[at - 1]);
    if (char === '/' && at === 0) {
      const command = COMMAND_TOKEN.exec(text);
      if (command) {
        flush();
        out.push({ kind: 'command', token: command[0] });
        at += command[0].length;
        continue;
      }
    }
    if (char === '@' && startsWord) {
      const token = tokens.find(
        (candidate) => text.startsWith(candidate, at) && !TOKEN_CHAR.test(text[at + candidate.length] ?? ''),
      );
      if (token) {
        flush();
        out.push({ kind: 'reference', token, reference: known.get(token)! });
        at += token.length;
        continue;
      }
      const path = PATH_TOKEN.exec(text.slice(at));
      const raw = path?.[0].replace(TRAILING_PUNCTUATION, '');
      // A `@term:` / `@session:` typed by hand has nothing captured behind it: keep it text.
      const reserved = !!raw && (RESERVED_TOKEN.test(raw) || text[at + raw.length] === ':');
      const exists = !options.isKnownPath || (!!raw && options.isKnownPath(raw.slice(1)));
      if (raw && !reserved && exists) {
        flush();
        out.push({ kind: 'reference', token: raw, reference: null });
        at += raw.length;
        continue;
      }
    }
    plain += char;
    at++;
  }
  flush();
  return out;
}

/** The segments with their offsets, for clicks on a badge and for deleting one whole. */
export function messageSpans(
  text: string,
  references: ContextReference[] = [],
  options: SegmentOptions = {},
): MessageSpan[] {
  let at = 0;
  return messageSegments(text, references, options).map((segment) => {
    const start = at;
    at += segment.kind === 'text' ? segment.text.length : segment.token.length;
    return { start, end: at, segment };
  });
}

/**
 * What a Backspace or Delete removes when it touches a badge: the whole badge, so a
 * token never degrades into a partial word. Null when the edit is plain text.
 */
export function badgeDeletion(
  text: string,
  references: ContextReference[] = [],
  selection: [number, number],
  forward = false,
  options: SegmentOptions = {},
): { start: number; end: number } | null {
  const badges = messageSpans(text, references, options).filter((span) => span.segment.kind === 'reference');
  if (!badges.length) return null;
  const [from, to] = selection;
  if (from === to) {
    const hit = badges.filter((badge) => {
      if (forward) return from >= badge.start && from < badge.end;
      if (from > badge.start && from <= badge.end) return true;
      // The space a token is inserted with belongs to it: one Backspace takes both.
      return from === badge.end + 1 && text[badge.end] === ' ';
    });
    if (!hit.length) return null;
    const badge = hit[0];
    return { start: badge.start, end: forward ? badge.end : Math.max(from, badge.end) };
  }
  const hit = badges.filter((badge) => badge.start < to && badge.end > from);
  if (!hit.length) return null;
  // Widen the selection to whole badges; never delete less than what was selected.
  return { start: Math.min(from, hit[0].start), end: Math.max(to, hit[hit.length - 1].end) };
}
