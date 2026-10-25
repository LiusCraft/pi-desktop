// One-time upgrade path: keys the desktop used to keep in its own encrypted
// store move into pi's auth.json, so this build and the pi CLI share one
// credential store. Nothing is deleted until auth.json was written successfully.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { safeStorage } from 'electron';
import type { Store } from '../agent/store';

interface Saved {
  enc: boolean;
  value: string;
}

export function agentDir(): string {
  const env = process.env.PI_CODING_AGENT_DIR;
  if (env) return env.startsWith('~') ? path.join(os.homedir(), env.slice(1)) : path.resolve(env);
  return path.join(os.homedir(), '.pi', 'agent');
}

function decrypt(saved: Saved): string | null {
  if (!saved.enc) return saved.value;
  try {
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(saved.value, 'base64')) : null;
  } catch {
    return null;
  }
}

/** Move legacy `keys` from the app store into auth.json; returns the moved provider ids. */
export function migrateLegacyKeys(store: Store, authPath = path.join(agentDir(), 'auth.json')): string[] {
  const legacy = store.get<Record<string, Saved>>('keys', {});
  const entries = Object.entries(legacy ?? {}).filter(([, saved]) => saved && typeof saved.value === 'string');
  if (!entries.length) return [];

  let auth: Record<string, unknown> = {};
  if (fs.existsSync(authPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(authPath, 'utf8')) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
      auth = parsed as Record<string, unknown>;
    } catch {
      // A hand-edited file in an unknown format is never overwritten.
      console.error('[main] auth.json is not valid JSON; legacy API keys were left in the app store');
      return [];
    }
  }

  const moved: string[] = [];
  let undecryptable = 0;
  for (const [provider, saved] of entries) {
    if (auth[provider]) continue; // pi's own credential wins
    const key = decrypt(saved);
    if (!key) {
      undecryptable++;
      continue;
    }
    auth[provider] = { type: 'api_key', key };
    moved.push(provider);
  }
  const done = () => {
    // Keep undecryptable entries for a later run (e.g. when the keychain unlocks).
    if (!undecryptable) store.set('keys', {});
  };
  if (!moved.length) {
    done();
    return [];
  }
  fs.mkdirSync(path.dirname(authPath), { recursive: true });
  const tmp = `${authPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, authPath);
  done();
  console.log(`[main] moved ${moved.length} API key(s) into ${authPath}: ${moved.join(', ')}`);
  return moved;
}
