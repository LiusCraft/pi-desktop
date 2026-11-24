// OpenAI's published Fast pricing and Codex speed docs list these model IDs.
// https://developers.openai.com/api/docs/pricing#fast
// https://learn.chatgpt.com/docs/agent-configuration/speed#fast-mode
const FAST_MODELS = new Set([
  'gpt-6.2-astra',
  'gpt-6.2-sol',
  'gpt-6.1-sol',
  'gpt-6.1-terra',
  'gpt-6-astra',
  'gpt-6-sol',
  'gpt-6-luna',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
]);

const modelName = (id: string) => id.slice(id.lastIndexOf('/') + 1).toLowerCase();

export const knownFastModel = (id: string) => FAST_MODELS.has(modelName(id));
export const isGptModel = (id: string) => /^gpt-\d/.test(modelName(id));

/** API adapters where the Fast service tier is an OpenAI-compatible request field. */
export function canSendFast(api: string) {
  return (
    api === 'openai-responses' ||
    api === 'openai-codex-responses' ||
    api === 'openai-completions' ||
    api === 'azure-openai-responses'
  );
}

export const modelKey = (model: { provider: string; id: string }) => `${model.provider}/${model.id}`;
