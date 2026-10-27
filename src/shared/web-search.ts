/**
 * Web search and page fetching for the model (`pidesk_web_search`, `pidesk_web_fetch`). The user
 * brings their own API keys; every engine listed here has a free tier, so a key costs nothing to try.
 * Keys live in the agent host's own file and never reach the renderer or the model.
 */

export const SEARCH_ENGINES = ['exa', 'brave', 'tavily', 'serper'] as const;
export type SearchEngine = (typeof SEARCH_ENGINES)[number];

/** "auto": use the configured engines in turn, staying on the one that last worked. */
export const ENGINE_AUTO = 'auto';
export type EngineChoice = typeof ENGINE_AUTO | SearchEngine;

export const ENGINE_INFO: Record<SearchEngine, { label: string; free: string; signup: string }> = {
  exa: { label: 'Exa', free: '注册即送免费额度，结果自带正文高亮', signup: 'https://dashboard.exa.ai/api-keys' },
  brave: { label: 'Brave Search', free: '每月赠送免费额度，独立索引', signup: 'https://api-dashboard.search.brave.com/app/keys' },
  tavily: { label: 'Tavily', free: '每月 1000 次免费，专为 AI 检索设计', signup: 'https://app.tavily.com/home' },
  serper: { label: 'Serper', free: '注册赠送免费额度，Google 搜索结果', signup: 'https://serper.dev/api-keys' },
};

export const SEARCH_FRESHNESS = ['day', 'week', 'month', 'year'] as const;
export type SearchFreshness = (typeof SEARCH_FRESHNESS)[number];

export const WEB_LIMITS = {
  defaultResults: 8,
  maxResults: 20,
  /** One search result's snippet, in characters. */
  snippet: 600,
  /** Characters of a fetched page returned per call; the model continues with `offset`. */
  pageChars: 20_000,
  maxPageChars: 60_000,
  /** Bytes read from one page before giving up on the rest. */
  pageBytes: 3_000_000,
  timeoutMs: 20_000,
  redirects: 5,
};

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  date?: string;
}

/** What the Settings page shows: which engines have a key, never the key itself. */
export interface WebSearchInfo {
  engine: EngineChoice;
  /** The engine the next search in "auto" starts with (the last one that answered). */
  current: SearchEngine | null;
  keys: Record<SearchEngine, boolean>;
}

/** What the Settings page saves. A key left out or empty is kept; `null` removes it. */
export interface WebSearchDraft {
  engine: EngineChoice;
  keys: Partial<Record<SearchEngine, string | null>>;
}

export const WEB_NOT_CONFIGURED = 'Web search is not set up. Ask the user to add an API key for Exa, Brave Search, Tavily or Serper in Settings → 联网搜索 (all have a free tier).';
