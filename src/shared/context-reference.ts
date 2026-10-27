// Code and path context captured in the composer. Serialized into ordinary prompt
// text at send time so CLI sessions and every API family can read it unchanged.
export interface ContextReference {
  id: string;
  kind: 'excerpt' | 'comment' | 'path' | 'quote';
  path: string;
  directory?: boolean;
  startLine?: number;
  endLine?: number;
  side?: 'old' | 'new' | 'mixed';
  text?: string;
  comment?: string;
}

export const MAX_CONTEXT_CHARS = 100_000;
export const MAX_CONTEXT_ITEMS = 20;

export function referenceLocation(reference: ContextReference): string {
  if (reference.kind === 'quote') return 'conversation';
  const range = reference.startLine ? `:${reference.startLine}${reference.endLine && reference.endLine !== reference.startLine ? `–${reference.endLine}` : ''}` : '';
  const side = reference.side === 'old' ? ' (before change)' : reference.side === 'mixed' ? ' (diff, old/new line numbers)' : '';
  return `${reference.path}${reference.directory && !reference.path.endsWith('/') ? '/' : ''}${range}${side}`;
}

export function referencePrompt(text: string, references: ContextReference[]): string {
  if (!references.length) return text;
  const blocks = references.map((reference) => {
    const location = referenceLocation(reference);
    const lines = [`${reference.kind === 'comment' ? 'Comment on' : reference.kind === 'quote' ? 'Reply to a passage of the' : 'Context from'} ${JSON.stringify(location)}`];
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
const HEAD_KINDS: Record<string, ContextReference['kind']> = { 'Comment on': 'comment', 'Reply to a passage of the': 'quote', 'Context from': 'excerpt' };

/** The inverse of `referencePrompt`, for showing a sent message as text plus cards; null when it carries no context. */
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
    try { location = JSON.parse(head[2]); } catch { return null; }
    const reference: ContextReference = { id: `sent-${references.length}`, kind: HEAD_KINDS[head[1]], path: location };
    if (reference.kind !== 'quote') {
      // Undo `referenceLocation`: "<path>[/][:start[–end]][ (side note)]".
      const parts = LOCATION.exec(location);
      if (parts) {
        reference.path = parts[1];
        if (parts[2]) reference.startLine = Number(parts[2]);
        if (parts[3]) reference.endLine = Number(parts[3]);
        if (parts[4]) reference.side = parts[4].includes('before') ? 'old' : 'mixed';
      }
    } else reference.path = '';
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
