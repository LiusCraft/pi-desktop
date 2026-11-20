// Session metadata is derived from short excerpts, not attachments, tool output or peer turns.
import { decodeUserContent } from '@shared/attachments';
import { decodeCommandMessage, isCommandMessage } from '@shared/command-message';
import { decodeReferencePrompt } from '@shared/context-reference';
import { isPeerMessage } from '@shared/peer-message';
import { isPrEvent } from '@shared/pr-event';
import { MAX_SESSION_DESCRIPTION } from '@shared/protocol';
import { decodeTaskMessage } from '@shared/task-message';

const MAX_TITLE = 60;
const MAX_EXCERPT = 2_000;
export const TIMEOUT_MS = 20_000;
/** A longer turn can report one intermediate checkpoint before settling. */
export const CHECKPOINT_AFTER_MS = 30_000;

export function requestText(content: unknown): string {
  const wire = decodeUserContent(content).text.trim();
  if (!wire || wire.startsWith('/') || isPeerMessage(wire) || isPrEvent(wire)) return '';
  const command = isCommandMessage(wire) ? decodeCommandMessage(wire) : null;
  if (isCommandMessage(wire) && !command?.user) return '';
  const text = decodeTaskMessage(wire)?.prompt ?? command?.prompt ?? wire;
  const task = decodeReferencePrompt(text)?.text ?? text;
  return titleFromPrompt(task, MAX_EXCERPT);
}

export function progressText(text: string): string {
  return flat(text.replace(/```[\s\S]*?```/g, ' ')).slice(-MAX_EXCERPT);
}

const flat = (text: string) => text.replace(/\s+/g, ' ').trim();

export function parseDigest(raw: string): { title: string | null; description: string } | null {
  try {
    const value = JSON.parse(
      raw
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, ''),
    );
    if (typeof value?.description !== 'string') return null;
    const description = flat(value.description);
    if (!description || description.length > MAX_SESSION_DESCRIPTION) return null;
    return { title: typeof value.title === 'string' ? cleanTitle(value.title) : null, description };
  } catch {
    return null;
  }
}

/**
 * Placeholder shown until the model names the session: the user's own words,
 * with @file mentions, code fences and line breaks removed.
 */
export function titleFromPrompt(message: unknown, max = MAX_TITLE) {
  const text = String(message ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/@\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/**
 * Model replies are usually clean, but a few strip-worthy things happen:
 * "Title: ...", quotes, markdown, a full sentence, or a refusal.
 */
export function cleanTitle(raw: unknown) {
  let title = String(raw ?? '').trim();
  if (!title) return null;
  title =
    title
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) || '';
  title = title
    .replace(/^(?:title|name|标题|名称)\s*[:：]\s*/i, '')
    .replace(/[\s"'“”‘’`*#_>~-]+$/g, '')
    .replace(/^[\s"'“”‘’`*#_>~-]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[。．.!！?？；;：:]+$/, '')
    .trim();
  if (!title || title.length > 64) return null;
  // Sentence punctuation means the model answered instead of titling.
  if (/[，。！？；：,;]/.test(title)) return null;
  if (title.split(/\s+/).length > 10) return null;
  if (/^(?:sorry|i'?m sorry|i can'?t|i cannot|unable to|无法|抱歉|对不起|你好|您好|当然|好的)/i.test(title))
    return null;
  return title;
}
