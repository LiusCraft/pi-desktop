// Next-message prediction, renderer side: after a turn settles, ask the agent host
// for one cheap guess of what the user would type next, and offer it as ghost text
// in the composer. Only the visible session asks, and anything typed, sent or
// switched meanwhile wins over a late reply.
import { SUGGESTION_DEFAULT_CONTEXT, type SuggestionOptions } from '@shared/protocol';
import { call } from '@/lib/api';
import { getApp } from './app';
import { drafts, getDraft, sessionDraftKey } from './drafts';

/** Newest request per session, so a reply from an older turn is dropped. */
const requests = new Map<string, number>();

export async function primeSuggestion(id: string) {
  const key = sessionDraftKey(id);
  const token = (requests.get(id) ?? 0) + 1;
  requests.set(id, token);
  drafts.setSuggestion(key, null);
  if (getApp().settings.suggestions === false) return;
  // A hidden window is not going to type in the next seconds; skip the request.
  if (getApp().current !== id || document.hidden) return;
  const d = getDraft(key);
  if (d.text || d.sending || d.preparing || getApp().sessions[id]?.running) return;
  const settings = getApp().settings;
  const options: SuggestionOptions = {
    model: settings.suggestionModel ?? 'auto',
    modelId: settings.suggestionModelId ?? null,
    context: settings.suggestionFullContext ? 'all' : settings.suggestionContext ?? SUGGESTION_DEFAULT_CONTEXT,
  };
  const result = await call('sessions:suggest', id, options).catch(() => null);
  if (requests.get(id) !== token) return;
  if (getApp().settings.suggestions === false) return;
  if (getApp().current !== id || document.hidden) return;
  const now = getDraft(key);
  if (now.text || now.sending || getApp().sessions[id]?.running) return;
  if (result?.text) drafts.setSuggestion(key, result.text);
}
