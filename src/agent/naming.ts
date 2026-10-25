// Session naming: one tool-less request to a cheap model of the session's provider.
//
// The request goes straight through the shared ModelRuntime, outside any session,
// so it never enters the conversation's context. The session shows the user's
// first prompt as a placeholder until the generated title arrives.
import type { ModelInfo } from '@shared/protocol';

export const SYSTEM_PROMPT = `You name chat sessions.
Given the user's first message, reply with ONLY a title: 2-5 words, at most 40 characters, in the same language as the message.
No quotes, no markdown, no trailing punctuation, no explanations.`;

const MAX_TITLE = 60;
export const TIMEOUT_MS = 20_000;

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
  title = title.split('\n').map((line) => line.trim()).find(Boolean) || '';
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
  if (/^(?:sorry|i'?m sorry|i can'?t|i cannot|unable to|无法|抱歉|对不起|你好|您好|当然|好的)/i.test(title)) return null;
  return title;
}

/**
 * Pick a cheap model from the same provider as the session. Same provider keeps
 * credentials (and model availability) a given; cost decides which one is small.
 */
export function pickNamingModel(models: (ModelInfo & { type?: string })[], current: string | null | undefined) {
  const list = (models || []).filter((m) => (!m.type || m.type === 'chat') && m.provider !== 'demo');
  if (!list.length) return null;
  const provider = current ? String(current).split('/')[0] : null;
  const same = provider ? list.filter((m) => m.provider === provider) : [];
  const pool = same.length ? same : list;
  const score = (m: ModelInfo) => {
    const input = Number(m.cost?.input) || 0;
    const output = Number(m.cost?.output) || 0;
    // Names like haiku/mini/flash only break ties between equally priced models.
    const small = /(haiku|mini|nano|flash|lite|small|fast|turbo)/i.test(m.id || '') ? -1e-6 : 0;
    return input * 0.25 + output + small;
  };
  const best = [...pool].sort((a, b) => score(a) - score(b) || (a.contextWindow || 0) - (b.contextWindow || 0))[0];
  return best ? `${best.provider}/${best.id}` : null;
}
