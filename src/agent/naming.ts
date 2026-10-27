// Session naming: one tool-less request to the session's own model.
//
// The request goes straight through the shared ModelRuntime, outside any session,
// so it never enters the conversation's context. The session shows the user's
// first prompt as a placeholder until the generated title arrives.

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
