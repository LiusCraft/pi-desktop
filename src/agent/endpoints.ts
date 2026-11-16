// Custom endpoints live in pi's models.json, the same file the CLI reads, so a
// provider added here works in both. Keys are not written here: the desktop
// stores them in auth.json through ModelRuntime.login. A keyless local server
// gets the documented `apiKey: "local"` placeholder so pi considers it usable.
import { tr } from '@shared/i18n/runtime';
import fs from 'node:fs';
import path from 'node:path';
import type { EndpointDiscovery, EndpointDraft, EndpointInfo, EndpointModel, ModelMeta } from '@shared/protocol';
import {
  alignModel,
  cleanThinkingLevelMap,
  COST_FIELDS,
  nonNegativePrice,
  positiveLimit,
} from '@shared/model-metadata';

/** pi's documented placeholder for endpoints that ignore the key (Ollama, llama.cpp, vLLM…). */
export const LOCAL_KEY = 'local';
const SCHEMA = 'https://pi.dev/schemas/models.schema.json';

type Json = Record<string, unknown>;
interface ModelsFile extends Json {
  providers?: Record<string, Json>;
}
interface ModelsJsonProvider extends Json {
  name?: string;
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  models?: Json[];
}

export interface EndpointRead {
  data: ModelsFile;
  /** A malformed models.json is never overwritten: saving would lose the user's file. */
  error?: string;
}

/** Strip // and /* *\/ comments and dangling commas, like pi's models.json loader. */
export function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (c === '\n') {
        inLine = false;
        out += c;
      }
      continue;
    }
    if (inBlock) {
      if (c === '*' && next === '/') {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += c;
      if (c === '\\') {
        out += next ?? '';
        i++;
      } else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && next === '/') {
      inLine = true;
      i++;
    } else if (c === '/' && next === '*') {
      inBlock = true;
      i++;
    } else {
      out += c;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = positiveLimit;

/** A loopback or private-network URL almost never needs a real credential. */
export function isLocalUrl(baseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  if (['localhost', '::1', '0.0.0.0'].includes(host) || host.endsWith('.local') || host.endsWith('.localhost'))
    return true;
  if (host.startsWith('127.')) return true;
  if (host.startsWith('10.')) return true;
  if (host.startsWith('192.168.')) return true;
  const m = /^172\.(\d+)\./.exec(host);
  return Boolean(m && Number(m[1]) >= 16 && Number(m[1]) <= 31);
}

export function validProviderId(id: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*$/.test(id);
}

/**
 * pi's schema requires all four cost fields, while models.dev omits unknown
 * ones; fill the gaps with 0 so a saved endpoint always loads in pi.
 */
function costEntry(cost: EndpointModel['cost']): Json | undefined {
  if (!cost) return undefined;
  const value = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0);
  return {
    input: value(cost.input),
    output: value(cost.output),
    cacheRead: value(cost.cacheRead),
    cacheWrite: value(cost.cacheWrite),
  };
}

/**
 * models.json holds a list of models; the editor only owns `id`, `name`,
 * `contextWindow`, `maxTokens`, `reasoning`, `thinkingLevelMap`, `input` and
 * `cost`, and keeps any other field the user (or pi) put on the same model.
 */
function modelEntry(model: EndpointModel, previous: Json | undefined): Json {
  const out: Json = { ...previous, id: model.id };
  for (const key of ['name', 'contextWindow', 'maxTokens', 'reasoning', 'thinkingLevelMap', 'input'] as const) {
    const value = model[key];
    if (value !== undefined) out[key] = value;
    else delete out[key];
  }
  const cost = costEntry(model.cost);
  if (cost) out.cost = { ...(previous?.cost as Json | undefined), ...cost };
  else delete out.cost;
  return out;
}

function cleanModels(list: unknown): EndpointModel[] {
  const out: EndpointModel[] = [];
  for (const entry of Array.isArray(list) ? list : []) {
    if (!entry || typeof entry !== 'object') continue;
    const model = entry as Json;
    const id = str(model.id);
    if (!id) continue;
    out.push({
      id,
      name: str(model.name),
      contextWindow: num(model.contextWindow),
      maxTokens: num(model.maxTokens),
      reasoning: typeof model.reasoning === 'boolean' ? model.reasoning : undefined,
      thinkingLevelMap: cleanThinkingLevelMap(model.thinkingLevelMap),
      input: Array.isArray(model.input) ? model.input.filter((v): v is string => typeof v === 'string') : undefined,
      cost:
        model.cost && typeof model.cost === 'object'
          ? {
              input: nonNegativePrice((model.cost as Json).input),
              output: nonNegativePrice((model.cost as Json).output),
              cacheRead: nonNegativePrice((model.cost as Json).cacheRead),
              cacheWrite: nonNegativePrice((model.cost as Json).cacheWrite),
            }
          : undefined,
      source: 'manual',
    });
  }
  return out;
}

export class EndpointStore {
  constructor(readonly file: string) {}

  read(): EndpointRead {
    let text: string;
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { data: { providers: {} } };
      return { data: { providers: {} }, error: tr('ag.modelsReadFail', { error: (error as Error).message }) };
    }
    try {
      const data = JSON.parse(stripJsonComments(text.replace(/^\uFEFF/, ''))) as ModelsFile;
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(tr('ag.modelsTopLevel'));
      if (
        data.providers !== undefined &&
        (typeof data.providers !== 'object' || data.providers === null || Array.isArray(data.providers))
      ) {
        throw new Error(tr('ag.modelsProviders'));
      }
      return { data };
    } catch (error) {
      return { data: { providers: {} }, error: tr('ag.modelsFormat', { error: (error as Error).message }) };
    }
  }

  /** Provider ids this file declares (custom endpoints plus built-in overrides). */
  ids(): Set<string> {
    return new Set(Object.keys(this.read().data.providers ?? {}));
  }

  list(
    builtinIds: Set<string>,
    status: (id: string) => { keySet: boolean; keySource?: string },
    align: (id: string, providerId: string) => ModelMeta | undefined,
  ): EndpointInfo[] {
    const { data } = this.read();
    const out: EndpointInfo[] = [];
    for (const [id, raw] of Object.entries(data.providers ?? {})) {
      if (!raw || typeof raw !== 'object') continue;
      const provider = raw as ModelsJsonProvider;
      const models = cleanModels(provider.models).map((model) => alignModel(model, align(model.id, id)));
      const { keySet, keySource } = status(id);
      out.push({
        id,
        name: str(provider.name) ?? id,
        baseUrl: str(provider.baseUrl) ?? '',
        api: str(provider.api) ?? '',
        builtin: builtinIds.has(id),
        keySet: keySet || Boolean(str(provider.apiKey)),
        keySource: keySource ?? (str(provider.apiKey) ? 'models.json' : undefined),
        models,
        extra: Object.keys(provider).filter((k) => !['name', 'baseUrl', 'api', 'apiKey', 'models'].includes(k)),
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Write one provider entry, preserving everything else in the file. Throws before writing when invalid or unreadable. */
  save(draft: EndpointDraft) {
    const id = draft.id.trim().toLowerCase();
    if (!validProviderId(id)) throw new Error(tr('ag.providerId'));
    const baseUrl = draft.baseUrl.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(baseUrl)) throw new Error(tr('ag.apiUrl'));
    const api = draft.api.trim();

    const { data, error } = this.read();
    if (error) throw new Error(tr('ag.fixFirst', { error }));
    const providers = { ...data.providers };
    const previous = (providers[id] && typeof providers[id] === 'object' ? providers[id] : {}) as ModelsJsonProvider;

    // Keep hand-edited fields on models that stay, and the editor's values on the rest.
    const existing = new Map<string, Json>();
    for (const model of Array.isArray(previous.models) ? previous.models : []) {
      const modelId = model && typeof model === 'object' ? str((model as Json).id) : undefined;
      if (modelId) existing.set(modelId, model as Json);
    }
    const models: Json[] = [];
    const seen = new Set<string>();
    for (const model of draft.models) {
      const modelId = model.id.trim();
      if (!modelId || seen.has(modelId)) continue;
      for (const key of ['contextWindow', 'maxTokens'] as const) {
        if (model[key] !== undefined && positiveLimit(model[key]) === undefined) {
          throw new Error(tr('ag.modelPositive', { id: modelId, key }));
        }
      }
      for (const key of COST_FIELDS) {
        if (model.cost?.[key] !== undefined && nonNegativePrice(model.cost[key]) === undefined) {
          throw new Error(tr('ag.modelPrice', { id: modelId, key }));
        }
      }
      seen.add(modelId);
      models.push(modelEntry({ ...model, id: modelId }, existing.get(modelId)));
    }

    const next: ModelsJsonProvider = { ...previous, baseUrl, api, models };
    const name = draft.name?.trim();
    if (name && name !== id) next.name = name;
    else delete next.name;

    // Credentials: a stored key wins over an inline one, so only manage the placeholder.
    if (draft.apiKey?.trim()) {
      if (previous.apiKey === LOCAL_KEY) delete next.apiKey;
    } else if (!previous.apiKey && isLocalUrl(baseUrl)) {
      next.apiKey = LOCAL_KEY;
    } else if (previous.apiKey === LOCAL_KEY && !isLocalUrl(baseUrl)) {
      delete next.apiKey;
    }

    // Empty optional fields keep the file readable.
    if (!next.api) delete next.api;
    if (!next.baseUrl) delete next.baseUrl;

    providers[id] = next;
    this.write({ ...data, $schema: typeof data.$schema === 'string' ? data.$schema : SCHEMA, providers });
  }

  remove(id: string) {
    const { data, error } = this.read();
    if (error) throw new Error(tr('ag.fixFirst', { error }));
    const providers = { ...data.providers };
    if (!(id in providers)) return;
    delete providers[id];
    this.write({ ...data, providers });
  }

  private write(data: ModelsFile) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}

// ------------------------------------------------------------ model discovery

/** One model as the endpoint itself describes it, before models.dev fills the gaps. */
export interface DiscoveredModel extends EndpointModel {}

const listAt = (payload: unknown): unknown[] => {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const obj = payload as Json;
    for (const key of ['data', 'models', 'result']) {
      const value = obj[key];
      if (Array.isArray(value)) return value;
      if (value && typeof value === 'object' && Array.isArray((value as Json).data))
        return (value as Json).data as unknown[];
    }
  }
  return [];
};

/** Normalize OpenAI, Anthropic and Google model-list payloads into ids plus any metadata they carry. */
export function parseModelList(payload: unknown): DiscoveredModel[] {
  const out: DiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const item of listAt(payload)) {
    const raw = typeof item === 'string' ? { id: item } : (item as Json);
    if (!raw || typeof raw !== 'object') continue;
    const id = str(raw.id) ?? str(raw.model);
    const nameFromGoogle = str(raw.name);
    const idValue = id ?? nameFromGoogle;
    if (!idValue) continue;
    const modelId = idValue.replace(/^models\//, '').trim();
    if (!modelId || seen.has(modelId)) continue;
    seen.add(modelId);
    const top = raw.top_provider && typeof raw.top_provider === 'object' ? (raw.top_provider as Json) : {};
    const limit = raw.limit && typeof raw.limit === 'object' ? (raw.limit as Json) : {};
    const display = str(raw.display_name) ?? str(raw.displayName);
    const name = display ?? (nameFromGoogle && nameFromGoogle !== modelId ? nameFromGoogle : undefined);
    out.push({
      id: modelId,
      name,
      contextWindow:
        num(raw.context_length) ??
        num(raw.context_window) ??
        num(raw.max_model_len) ??
        num(raw.max_context_length) ??
        num(raw.max_input_tokens) ??
        num(raw.inputTokenLimit) ??
        num(top.context_length) ??
        num(limit.context),
      maxTokens:
        num(raw.max_completion_tokens) ??
        num(raw.max_output_tokens) ??
        num(raw.output_token_limit) ??
        num(raw.outputTokenLimit) ??
        num(top.max_completion_tokens) ??
        num(limit.output),
      source: 'endpoint',
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export interface DiscoverOptions {
  baseUrl: string;
  api: string;
  apiKey?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** URLs worth trying for a model list, most likely first. */
export function discoveryUrls(baseUrl: string, api: string): string[] {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (!base) return [];
  const urls = [`${base}/models`];
  const hasVersion = /\/v\d+[a-z0-9]*$/i.test(base);
  if (!hasVersion) urls.unshift(`${base}/v1/models`);
  if (api === 'anthropic-messages' && /\/v1$/i.test(base)) urls.reverse();
  if (api === 'google-generative-ai') return [`${base}/models`];
  return [...new Set(urls)];
}

function authHeaders(api: string, apiKey: string | undefined, extra: Record<string, string> | undefined) {
  const headers: Record<string, string> = { accept: 'application/json', ...extra };
  if (api === 'anthropic-messages') headers['anthropic-version'] = '2023-06-01';
  if (!apiKey) return headers;
  if (api === 'anthropic-messages') headers['x-api-key'] = apiKey;
  else if (api === 'google-generative-ai') headers['x-goog-api-key'] = apiKey;
  else headers.authorization = `Bearer ${apiKey}`;
  return headers;
}

export async function discoverModels(options: DiscoverOptions): Promise<EndpointDiscovery> {
  const urls = discoveryUrls(options.baseUrl, options.api);
  if (!urls.length) return { models: [], error: tr('ag.needApiUrl') };
  const failures: string[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: authHeaders(options.api, options.apiKey, options.headers),
        signal: options.signal ?? AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        failures.push(`GET ${url} → ${res.status}`);
        continue;
      }
      const models = parseModelList(await res.json());
      if (!models.length) {
        failures.push(`GET ${url} → ${tr('ag.noModels')}`);
        continue;
      }
      return { models };
    } catch (error) {
      failures.push(`GET ${url} → ${(error as Error).message}`);
    }
  }
  return { models: [], error: tr('ag.discoverFail', { failures: failures.join(tr('ag.discoverSep')) }) };
}
