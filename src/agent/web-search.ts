/**
 * The model's web access. The user's API keys and engine choice live in `<app data>/web-search.json`
 * (kept private like the object-storage secret). In "auto" the engines with a key are used in turn:
 * a search starts with the one that last answered, and when it fails (free quota used up, bad key,
 * outage) the next one is tried and becomes the starting point for the next search. A fixed engine
 * is used alone, with no fallback.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  ENGINE_AUTO, ENGINE_INFO, SEARCH_ENGINES, WEB_LIMITS, WEB_NOT_CONFIGURED,
  type EngineChoice, type SearchEngine, type SearchFreshness, type SearchHit, type WebSearchDraft, type WebSearchInfo,
} from '@shared/web-search';
import { appWebSearchFile } from './app-paths';
import { fetchPage, type FetchedPage } from './web-fetch';

export interface SearchQuery {
  query: string;
  maxResults: number;
  freshness?: SearchFreshness;
  domains?: string[];
}

export interface SearchOutcome {
  engine: SearchEngine;
  hits: SearchHit[];
  /** Engines tried first that failed, with why (auto mode only). */
  failed: { engine: SearchEngine; reason: string }[];
}

interface Stored {
  engine: EngineChoice;
  current: SearchEngine | null;
  keys: Partial<Record<SearchEngine, string>>;
}

type Adapter = (key: string, q: SearchQuery, signal?: AbortSignal) => Promise<SearchHit[]>;

const FRESHNESS_DAYS: Record<SearchFreshness, number> = { day: 1, week: 7, month: 31, year: 365 };
const DAY_MS = 86_400_000;

const clip = (s: string | undefined, max: number) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

async function send(url: string, init: RequestInit, signal?: AbortSignal): Promise<any> {
  const timeout = AbortSignal.timeout(WEB_LIMITS.timeoutMs);
  const res = await fetch(url, { ...init, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!res.ok) {
    const body = clip(await res.text().catch(() => ''), 200);
    throw new Error(`HTTP ${res.status}${body ? `: ${body}` : ''}`);
  }
  return res.json();
}
const postJson = (url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal) =>
  send(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }, signal);

const ADAPTERS: Record<SearchEngine, Adapter> = {
  async exa(key, q, signal) {
    const body: Record<string, unknown> = {
      query: q.query, numResults: q.maxResults, type: 'auto',
      contents: { highlights: { maxCharacters: WEB_LIMITS.snippet * 2 } },
    };
    if (q.domains?.length) body.includeDomains = q.domains;
    if (q.freshness) body.startPublishedDate = new Date(Date.now() - FRESHNESS_DAYS[q.freshness] * DAY_MS).toISOString();
    const data = await postJson('https://api.exa.ai/search', { 'x-api-key': key }, body, signal);
    return (data.results ?? []).map((r: any): SearchHit => ({
      title: r.title || r.url, url: r.url, date: r.publishedDate?.slice(0, 10),
      snippet: clip(Array.isArray(r.highlights) ? r.highlights.join(' … ') : r.summary ?? r.text, WEB_LIMITS.snippet),
    }));
  },

  async brave(key, q, signal) {
    const sites = q.domains?.length ? ` (${q.domains.map((d) => `site:${d}`).join(' OR ')})` : '';
    const params = new URLSearchParams({ q: q.query + sites, count: String(Math.min(q.maxResults, 20)), extra_snippets: 'true' });
    if (q.freshness) params.set('freshness', { day: 'pd', week: 'pw', month: 'pm', year: 'py' }[q.freshness]);
    const data = await send(`https://api.search.brave.com/res/v1/web/search?${params}`, { headers: { Accept: 'application/json', 'X-Subscription-Token': key } }, signal);
    return (data.web?.results ?? []).map((r: any): SearchHit => ({
      title: clip(r.title, 200) || r.url, url: r.url, date: r.page_age?.slice(0, 10),
      snippet: clip([r.description, ...(r.extra_snippets ?? [])].filter(Boolean).join(' … '), WEB_LIMITS.snippet),
    }));
  },

  async tavily(key, q, signal) {
    const body: Record<string, unknown> = { query: q.query, max_results: Math.min(q.maxResults, 20), search_depth: 'basic' };
    if (q.domains?.length) body.include_domains = q.domains;
    if (q.freshness) body.time_range = q.freshness;
    const data = await postJson('https://api.tavily.com/search', { Authorization: `Bearer ${key}` }, body, signal);
    return (data.results ?? []).map((r: any): SearchHit => ({ title: r.title || r.url, url: r.url, snippet: clip(r.content, WEB_LIMITS.snippet) }));
  },

  async serper(key, q, signal) {
    const sites = q.domains?.length ? ` (${q.domains.map((d) => `site:${d}`).join(' OR ')})` : '';
    const body: Record<string, unknown> = { q: q.query + sites, num: Math.min(q.maxResults, 20) };
    if (q.freshness) body.tbs = `qdr:${{ day: 'd', week: 'w', month: 'm', year: 'y' }[q.freshness]}`;
    const data = await postJson('https://google.serper.dev/search', { 'X-API-KEY': key }, body, signal);
    return (data.organic ?? []).map((r: any): SearchHit => ({ title: r.title || r.link, url: r.link, date: r.date, snippet: clip(r.snippet, WEB_LIMITS.snippet) }));
  },
};

export class WebSearch {
  constructor(private readonly dataDir: string) {}

  private read(): Stored {
    try {
      const raw = JSON.parse(fs.readFileSync(appWebSearchFile(this.dataDir), 'utf8')) as Partial<Stored>;
      const engine = raw.engine === ENGINE_AUTO || SEARCH_ENGINES.includes(raw.engine as SearchEngine) ? (raw.engine as EngineChoice) : ENGINE_AUTO;
      const current = SEARCH_ENGINES.includes(raw.current as SearchEngine) ? (raw.current as SearchEngine) : null;
      return { engine, current, keys: raw.keys ?? {} };
    } catch {
      return { engine: ENGINE_AUTO, current: null, keys: {} };
    }
  }

  private write(s: Stored) {
    const file = appWebSearchFile(this.dataDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(s, null, 2), { mode: 0o600 });
  }

  info(): WebSearchInfo {
    const { engine, current, keys } = this.read();
    return { engine, current, keys: Object.fromEntries(SEARCH_ENGINES.map((e) => [e, !!keys[e]])) as WebSearchInfo['keys'] };
  }

  save(draft: WebSearchDraft): WebSearchInfo {
    const stored = this.read();
    const keys = { ...stored.keys };
    for (const e of SEARCH_ENGINES) {
      const next = draft.keys[e];
      if (next === null) delete keys[e];
      else if (typeof next === 'string' && next.trim()) keys[e] = next.trim();
    }
    const engine = draft.engine === ENGINE_AUTO || SEARCH_ENGINES.includes(draft.engine) ? draft.engine : ENGINE_AUTO;
    const current = stored.current && keys[stored.current] ? stored.current : null;
    this.write({ engine, current, keys });
    return this.info();
  }

  /** Runs one search against one engine with a saved key (or an unsaved one), so the Settings page can check it. */
  async test(engine: SearchEngine, key?: string): Promise<void> {
    const k = key?.trim() || this.read().keys[engine];
    if (!k) throw new Error(`No ${ENGINE_INFO[engine].label} key to test`);
    await ADAPTERS[engine](k, { query: 'pi desktop', maxResults: 1 });
  }

  /** Engines in the order a search tries them. */
  private plan(s: Stored): SearchEngine[] {
    if (s.engine !== ENGINE_AUTO) {
      if (!s.keys[s.engine]) throw new Error(`${ENGINE_INFO[s.engine].label} is chosen for web search but has no API key. Ask the user to add it in Settings → 联网搜索.`);
      return [s.engine];
    }
    const ready = SEARCH_ENGINES.filter((e) => s.keys[e]);
    if (!ready.length) throw new Error(WEB_NOT_CONFIGURED);
    const at = s.current ? ready.indexOf(s.current) : -1;
    return at > 0 ? [...ready.slice(at), ...ready.slice(0, at)] : ready;
  }

  async search(q: SearchQuery, signal?: AbortSignal): Promise<SearchOutcome> {
    const stored = this.read();
    const failed: SearchOutcome['failed'] = [];
    for (const engine of this.plan(stored)) {
      try {
        const hits = await ADAPTERS[engine](stored.keys[engine]!, q, signal);
        if (stored.engine === ENGINE_AUTO && stored.current !== engine) this.write({ ...this.read(), current: engine });
        return { engine, hits, failed };
      } catch (err) {
        if (signal?.aborted) throw err;
        failed.push({ engine, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    throw new Error(`Web search failed. ${failed.map((f) => `${ENGINE_INFO[f.engine].label}: ${f.reason}`).join('; ')}`);
  }

  fetchPage(url: string, signal?: AbortSignal): Promise<FetchedPage> {
    return fetchPage(url, signal);
  }
}
