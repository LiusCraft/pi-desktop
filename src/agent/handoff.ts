// The handoff card a long-idle session leaves when its context is rebuilt, plus the cache lifetime
// the model catalog declares. Both are pure reads: building the card never calls a model.
import type { SessionManager } from '@earendil-works/pi-coding-agent';
import type { HandoffDetails } from '@shared/idle-reset';
import { formatIdle } from '@shared/idle-reset';

/** pi's own switch between the two prompt-cache tiers; the same value the request used. */
const CACHE_RETENTION_ENV = 'PI_CACHE_RETENTION';

const MODIFY_TOOLS = new Set(['edit', 'write']);
const READ_TOOLS = new Set(['read', 'grep', 'find', 'ls']);

const MAX_REQUESTS = 6;
const MAX_REQUEST_CHARS = 300;
const MAX_CONCLUSION_CHARS = 1200;
const MAX_FILES = 30;

/** Per entry, the message shape we read; pi's own entry types are wider than the card needs. */
interface EntryLike {
  type: string;
  message?: {
    role?: string;
    content?: unknown;
    stopReason?: string;
    errorMessage?: string;
  };
}

interface BlockLike {
  type?: string;
  text?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

const blocksOf = (content: unknown): BlockLike[] => (Array.isArray(content) ? (content as BlockLike[]) : []);

/** The visible text of one message, without tool blocks. */
const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  return blocksOf(content)
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text as string)
    .join('\n');
};

const clip = (text: string, max: number) => {
  const oneLine = text.replace(/\s+/gu, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
};

const pathOf = (args: Record<string, unknown> | undefined): string | undefined => {
  const value = args?.path ?? args?.file_path ?? args?.filePath;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

export interface HandoffInput {
  sessionId: string;
  title: string;
  /** How long the session sat idle, in minutes. */
  idleMinutes: number;
  /** Context tokens that are about to leave the model's context. */
  tokens: number;
}

/**
 * The lifetime the model catalog declares for its prompt cache, in minutes. pi-ai ships it per model
 * (`promptCache.short` / `.long`, in seconds) for the providers that document one; models without
 * it use the global setting instead. `PI_CACHE_RETENTION=long` selects the long tier, exactly as pi
 * does when it decides whether a cache entry is still warm.
 */
export function declaredCacheMinutes(model: { promptCache?: { short?: number; long?: number } }): number | undefined {
  const long = process.env[CACHE_RETENTION_ENV]?.trim().toLowerCase() === 'long';
  const cache = model.promptCache;
  const seconds = long ? cache?.long ?? cache?.short : cache?.short ?? cache?.long;
  return seconds && seconds > 0 ? seconds / 60 : undefined;
}

/**
 * The card that stands in for the conversation that left the context: what was asked, how it ended,
 * which files were touched, and the instruction to look the rest up rather than guess.
 */
export function buildHandoff(manager: SessionManager, input: HandoffInput): { text: string; details: HandoffDetails } {
  // SAFETY: `EntryLike` is a structural subset of pi's `SessionEntry`; every field read below is
  // checked for type and presence, so a wider runtime shape degrades to a shorter card, not a crash.
  const entries = manager.getBranch() as unknown as EntryLike[];
  const requests: string[] = [];
  const changed = new Set<string>();
  const read = new Set<string>();
  let conclusion = '';

  for (const entry of entries) {
    const message = entry.type === 'message' ? entry.message : undefined;
    if (!message) continue;
    if (message.role === 'user') {
      const text = clip(textOf(message.content), MAX_REQUEST_CHARS);
      if (text) requests.push(text);
    } else if (message.role === 'assistant') {
      const text = textOf(message.content).trim();
      if (text) conclusion = text;
      for (const block of blocksOf(message.content)) {
        if (block.type !== 'toolCall' || !block.name) continue;
        const path = pathOf(block.arguments);
        if (!path) continue;
        if (MODIFY_TOOLS.has(block.name)) changed.add(path);
        else if (READ_TOOLS.has(block.name)) read.add(path);
      }
    }
  }

  const recent = requests.slice(-MAX_REQUESTS);
  const lines: string[] = [
    '# Continuing an earlier conversation',
    '',
    `This session (${input.title || 'untitled'}, id ${input.sessionId}) was idle for ${formatIdle(input.idleMinutes)}, ` +
      'so the conversation it had so far was cleared from your context. It is the same session, the same working tree ' +
      'and the same task — only the transcript you can see is new.',
    '',
  ];
  if (recent.length) {
    lines.push('## What was asked, most recent last', ...recent.map((r) => `- ${r}`), '');
  }
  if (conclusion) {
    lines.push('## Where it left off', clip(conclusion, MAX_CONCLUSION_CHARS), '');
    const full = conclusion.replace(/\s+/gu, ' ').trim();
    if (full.length > MAX_CONCLUSION_CHARS) lines.push(`(${full.length - MAX_CONCLUSION_CHARS} more characters were omitted.)`, '');
  }
  if (changed.size) {
    lines.push('## Files changed in that work', ...[...changed].slice(0, MAX_FILES).map((f) => `- ${f}`), '');
  }
  if (read.size) {
    const shown = [...read].filter((f) => !changed.has(f)).slice(0, MAX_FILES);
    if (shown.length) lines.push('## Files it looked at', ...shown.map((f) => `- ${f}`), '');
  }
  lines.push(
    '## Before you answer',
    'The user has not re-read this card for you, and their next message may rely on a decision it does not record. ' +
      'If you are about to guess what was decided, what a file now contains, or what failed earlier, look it up first ' +
      'with `pidesk_search_session` (this session\'s own earlier transcript) or read the file. Say plainly when you ' +
      'could not recover something instead of inventing it.',
  );

  return {
    text: lines.join('\n'),
    details: {
      sessionId: input.sessionId,
      idleMinutes: input.idleMinutes,
      tokensBefore: input.tokens,
      filesChanged: changed.size,
      filesRead: read.size,
    },
  };
}
