// models.dev metadata for custom endpoints: a model id is matched against the
// public catalog to inherit its context window, output limit and prices, which
// pi otherwise defaults to 128K/16K and zero cost. The catalog is cached in the
// app data directory for a day; a failure to refresh keeps the previous copy.
import fs from 'node:fs';
import type { ModelMeta } from '@shared/protocol';
import { positiveLimit } from '@shared/model-metadata';

const API_URL = 'https://models.dev/api.json';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 30_000;

/** Official catalogs win over resellers/gateways when the same model id appears twice. */
const PRIORITY = [
  'anthropic', 'openai', 'google', 'google-vertex', 'azure', 'amazon-bedrock',
  'deepseek', 'mistral', 'xai', 'meta', 'moonshotai', 'moonshotai-cn', 'minimax', 'minimax-cn',
  'zai', 'zai-coding-cn', 'qwen', 'alibaba', 'nvidia', 'groq', 'cerebras', 'cohere',
];

interface RawModel {
  id?: unknown;
  name?: unknown;
  reasoning?: unknown;
  attachment?: unknown;
  modalities?: { input?: unknown };
  limit?: { context?: unknown; output?: unknown };
  cost?: { input?: unknown; output?: unknown; cache_read?: unknown; cache_write?: unknown };
  canonical_model_id?: unknown;
}

interface RawProvider {
  models?: Record<string, RawModel>;
}

interface CachedModel {
  id: string;
  name?: string;
  context?: number;
  output?: number;
  reasoning?: boolean;
  image?: boolean;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
}

interface CacheFile {
  fetchedAt: number;
  providers: Record<string, CachedModel[]>;
}

interface Entry {
  provider: string;
  meta: ModelMeta;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Keys a model id is looked up under, most specific first. */
export function lookupKeys(id: string): string[] {
  const keys = new Set<string>();
  const add = (value: string) => {
    const key = value.trim().toLowerCase();
    if (key) keys.add(key);
  };
  const stripped = id
    .trim()
    .toLowerCase()
    .replace(/:\s*(free|nitro|extended|online|thinking|floor|beta)$/u, '')
    .replace(/@\d+$/u, '')
    .replace(/-latest$/u, '');
  for (const value of [id, stripped]) {
    add(value);
    const slash = value.lastIndexOf('/');
    if (slash >= 0) add(value.slice(slash + 1));
  }
  return [...keys];
}

function metaOf(model: RawModel, fallbackId: string): CachedModel | null {
  const id = str(model.id) ?? fallbackId;
  if (!id) return null;
  const context = positiveLimit(model.limit?.context);
  const output = positiveLimit(model.limit?.output);
  const input = Array.isArray(model.modalities?.input) ? model.modalities.input : [];
  const image = model.attachment === true || input.includes('image');
  const cost = {
    input: num(model.cost?.input),
    output: num(model.cost?.output),
    cacheRead: num(model.cost?.cache_read),
    cacheWrite: num(model.cost?.cache_write),
  };
  const hasCost = Object.values(cost).some((v) => v !== undefined);
  return {
    id,
    name: str(model.name),
    context,
    output,
    reasoning: model.reasoning === true || undefined,
    image: image || undefined,
    cost: hasCost ? cost : undefined,
  };
}

export class ModelsDevCatalog {
  private index = new Map<string, Entry>();
  private perProvider = new Map<string, ModelMeta>();
  private fetchedAt: number | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(private readonly file: string) {}

  get lastFetched(): number | null {
    return this.fetchedAt;
  }

  /** Read the cache and refresh it in the background when it is stale or missing. Never throws. */
  ensure(): void {
    if (!this.index.size) this.read();
    if (this.fetchedAt == null || Date.now() - this.fetchedAt > MAX_AGE_MS) void this.refresh().catch(() => {});
  }

  /** Force a network refresh (deduplicated). Rejects when nothing usable is cached. */
  async refresh(): Promise<void> {
    this.inFlight ??= this.download().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /**
   * Wait for a usable index: immediate when a cache (or a finished download)
   * exists, otherwise one bounded download attempt. Never throws.
   */
  async ready(): Promise<void> {
    if (!this.index.size) this.read();
    if (this.index.size) {
      this.ensure();
      return;
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.refresh(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 20_000);
        }),
      ]);
    } catch {
      // Alignment is best effort; models keep pi's defaults.
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Metadata for a model id, preferring `providerHint`'s own catalog entry. */
  lookup(id: string, providerHint?: string): ModelMeta | undefined {
    if (!id.trim()) return undefined;
    const keys = lookupKeys(id);
    if (providerHint) {
      for (const key of keys) {
        const hit = this.perProvider.get(`${providerHint}\u0000${key}`);
        if (hit) return { ...hit, source: 'models.dev' };
      }
    }
    for (const key of keys) {
      const hit = this.index.get(key);
      if (hit) return { ...hit.meta, source: 'models.dev' };
    }
    return undefined;
  }

  private read() {
    let cached: CacheFile;
    try {
      cached = JSON.parse(fs.readFileSync(this.file, 'utf8')) as CacheFile;
    } catch {
      return;
    }
    if (!cached?.providers || typeof cached.providers !== 'object') return;
    this.build(cached.providers);
    this.fetchedAt = Number(cached.fetchedAt) || null;
  }

  private write(providers: Record<string, CachedModel[]>) {
    const body: CacheFile = { fetchedAt: this.fetchedAt ?? Date.now(), providers };
    try {
      fs.writeFileSync(this.file, JSON.stringify(body));
    } catch {
      // The cache is an optimization: the in-memory index still serves this run.
    }
  }

  private async download() {
    const res = await fetch(API_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`models.dev responded ${res.status}`);
    const data = (await res.json()) as Record<string, RawProvider>;
    if (!data || typeof data !== 'object') throw new Error('models.dev returned an unexpected payload');
    const providers: Record<string, CachedModel[]> = {};
    for (const [providerId, provider] of Object.entries(data)) {
      const models: CachedModel[] = [];
      for (const [key, raw] of Object.entries(provider?.models ?? {})) {
        if (!raw || typeof raw !== 'object') continue;
        const model = metaOf(raw, key);
        if (model) models.push(model);
      }
      if (models.length) providers[providerId] = models;
    }
    this.build(providers);
    this.fetchedAt = Date.now();
    this.write(providers);
  }

  private build(providers: Record<string, CachedModel[]>) {
    this.index.clear();
    this.perProvider.clear();
    const priority = (id: string) => {
      const i = PRIORITY.indexOf(id);
      return i < 0 ? PRIORITY.length : i;
    };
    const ids = Object.keys(providers).sort((a, b) => priority(a) - priority(b) || a.localeCompare(b));
    for (const providerId of ids) {
      for (const model of providers[providerId] ?? []) {
        const meta: ModelMeta = {
          name: model.name,
          contextWindow: positiveLimit(model.context),
          maxTokens: positiveLimit(model.output),
          reasoning: model.reasoning,
          input: model.image ? ['text', 'image'] : undefined,
          cost: model.cost && {
            input: model.cost.input,
            output: model.cost.output,
            cacheRead: model.cost.cacheRead,
            cacheWrite: model.cost.cacheWrite,
          },
        };
        const keys = new Set(lookupKeys(model.id));
        // The canonical id is how models.dev names a model across gateways.
        if (model.id.includes('/')) keys.add(model.id.slice(model.id.lastIndexOf('/') + 1));
        for (const key of keys) {
          if (!this.index.has(key)) this.index.set(key, { provider: providerId, meta });
          const perKey = `${providerId}\u0000${key}`;
          if (!this.perProvider.has(perKey)) this.perProvider.set(perKey, meta);
        }
      }
    }
  }
}
