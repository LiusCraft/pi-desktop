// API keys saved in the desktop app: encrypted at rest when the OS supports it and
// handed to the agent host, which applies them as runtime keys (never written to pi's auth.json).
import { safeStorage } from 'electron';
import type { KeyStatus } from '@shared/protocol';
import type { Store } from '../agent/store';

/** Environment variables pi reads for each provider's API key (shown for reference). */
export const KEY_ENV: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  opencode: 'OPENCODE_API_KEY',
  'opencode-go': 'OPENCODE_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  xai: 'XAI_API_KEY',
  groq: 'GROQ_API_KEY',
  mistral: 'MISTRAL_API_KEY',
};

type Saved = Record<string, { enc: boolean; value: string }>;

export function readKeys(store: Store): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [provider, v] of Object.entries(store.get<Saved>('keys', {}))) {
    try {
      out[provider] = v.enc && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(v.value, 'base64')) : v.value;
    } catch {}
  }
  return out;
}

export function writeKey(store: Store, provider: string, key: string) {
  if (!Object.hasOwn(KEY_ENV, provider)) throw new Error(`Unknown provider: ${provider}`);
  const raw = store.get<Saved>('keys', {});
  if (!key) delete raw[provider];
  else if (safeStorage.isEncryptionAvailable()) raw[provider] = { enc: true, value: safeStorage.encryptString(key).toString('base64') };
  else raw[provider] = { enc: false, value: key };
  store.set('keys', raw);
}

export function keyStatus(store: Store): Record<string, KeyStatus> {
  const saved = readKeys(store);
  return Object.fromEntries(Object.entries(KEY_ENV).map(([provider, env]) => [provider, { env, saved: Boolean(saved[provider]), envSet: Boolean(process.env[env]) }]));
}
