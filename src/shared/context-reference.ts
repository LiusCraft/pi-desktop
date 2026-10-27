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
