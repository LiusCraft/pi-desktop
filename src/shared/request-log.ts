// The model request log: one record per request the app sent to a model vendor, kept on this computer. Written by
// the agent host's request hook, read by Settings. The vendor's key never reaches a record.

/** What a request was for. Subagents also carry their name (`RequestRecord.subagent`). */
export const REQUEST_ORIGIN = {
  code: 'code',
  work: 'work',
  subagent: 'subagent',
  naming: 'naming',
  suggest: 'suggest',
  sideChat: 'sideChat',
  review: 'review',
  ideas: 'ideas',
} as const;
export type RequestOrigin = (typeof REQUEST_ORIGIN)[keyof typeof REQUEST_ORIGIN];
/** The usage view's key for a request that has no origin. */
export const ORIGIN_OTHER = 'other';
/** The usage view's key for a subagent: `subagent:<name>`. */
export const SUBAGENT_KEY_PREFIX = 'subagent:';

export const REQUEST_STATUS = { ok: 'ok', error: 'error', aborted: 'aborted' } as const;
export type RequestStatus = (typeof REQUEST_STATUS)[keyof typeof REQUEST_STATUS];

export interface RequestTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface RequestRecord {
  id: string;
  /** Epoch ms the request started. */
  at: number;
  /** The session it belongs to; absent for requests outside any session (naming, suggestions). */
  /** The session it belongs to (the app's own id); absent for requests outside any session. */
  sessionId?: string;
  provider: string;
  model: string;
  status: RequestStatus;
  /** The vendor's HTTP status, when one answered. */
  httpStatus?: number;
  durationMs: number;
  /** Ms from the start until the first token came back; the output speed counts from there. */
  firstTokenMs?: number;
  /** What the request was for. */
  origin?: RequestOrigin;
  /** The subagent's name, when `origin` is `subagent`. */
  subagent?: string;
  tokens: RequestTokens;
  /** In the model's price currency, from its catalog entry; 0 when the model has no price. */
  cost: number;
  error?: string;
  /** Set when the model has no price, so `cost` is not a real 0. */
  unpriced?: boolean;
  /** Values masked in this request, by kind; absent when none were. */
  masked?: MaskCounts;
  /** The request body as it was sent, only when `RequestHookSettings.logBody` was on. */
  body?: string;
}

export interface RequestHookSettings {
  /** Keep each request's body in its record. Off by default: bodies hold the user's code and prompts. */
  logBody: boolean;
  /** Records older than this many days are deleted. */
  retentionDays: number;
  redact: RedactSettings;
}

export const REQUEST_RETENTION = { min: 1, max: 365, default: 30 } as const;
/** A logged body is cut at this many characters. */
export const REQUEST_BODY_LIMIT = 200_000;

export function normalizeRequestHookSettings(
  raw: Partial<RequestHookSettings> | null | undefined,
): RequestHookSettings {
  const days = Math.round(Number(raw?.retentionDays));
  return {
    logBody: raw?.logBody === true,
    retentionDays: Number.isFinite(days)
      ? Math.min(REQUEST_RETENTION.max, Math.max(REQUEST_RETENTION.min, days))
      : REQUEST_RETENTION.default,
    redact: normalizeRedactSettings(raw?.redact),
  };
}

const strings = (v: unknown): string[] =>
  Array.isArray(v)
    ? [
        ...new Set(
          v
            .filter((s): s is string => typeof s === 'string')
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ]
    : [];

export function normalizeRedactSettings(raw: Partial<RedactSettings> | null | undefined): RedactSettings {
  const rules = Array.isArray(raw?.rules)
    ? raw.rules.flatMap((r) =>
        r && typeof r.pattern === 'string' && r.pattern.trim()
          ? [{ pattern: r.pattern.trim(), regex: r.regex === true }]
          : [],
      )
    : [];
  const actions: RedactSettings['actions'] = {};
  for (const kind of MASK_KINDS) {
    const a = raw?.actions?.[kind];
    if (a === MASK_ACTION.warn || a === MASK_ACTION.block) actions[kind] = a;
  }
  return {
    secrets: raw?.secrets === true,
    personal: raw?.personal === true,
    words: strings(raw?.words),
    rules,
    allow: strings(raw?.allow),
    actions,
  };
}

export interface RequestQuery {
  /** Newest first; at most this many records. */
  limit: number;
  /** Only records started before this time, to page back. */
  before?: number;
  sessionId?: string;
  model?: string;
}

export const REQUEST_PAGE_SIZE = 100;

/** How a usage summary is cut: one series per model, per model and provider, per provider, per session, or per purpose. */
export const USAGE_SPLIT = {
  model: 'model',
  modelProvider: 'modelProvider',
  provider: 'provider',
  session: 'session',
  purpose: 'purpose',
} as const;
/** The usage view's key for requests that belong to no session. */
export const NO_SESSION_KEY = 'none';
export type UsageSplit = (typeof USAGE_SPLIT)[keyof typeof USAGE_SPLIT];

/** The ranges the usage view offers. 1 is today, cut by hour; the others are cut by day. */
export const USAGE_RANGES = [1, 7, 30, 90] as const;
export type UsageRange = (typeof USAGE_RANGES)[number];
export const HOURS_IN_DAY = 24;
export const DEFAULT_USAGE_RANGE: UsageRange = 7;

export interface UsageQuery {
  days: UsageRange;
  split: UsageSplit;
}

/** What a set of requests used. Speed is `speedTokens` over `speedMs`, from the requests that finished and produced output. */
export interface UsageTotals {
  requests: number;
  failed: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  /** Requests whose model has no price, so `cost` leaves them out. */
  unpriced: number;
  /** Output tokens and time of the requests that count for speed. */
  speedTokens: number;
  speedMs: number;
  /** How many requests those are. */
  timed: number;
}

export interface UsageSeries {
  key: string;
  label: string;
  total: UsageTotals;
  /** One entry per bucket of the summary. */
  requests: number[];
  tokens: number[];
  cost: number[];
  speedTokens: number[];
  speedMs: number[];
}

export interface UsageSummary {
  total: UsageTotals;
  /** What a bucket is: an hour of today, or a day. */
  unit: 'hour' | 'day';
  /** Hour 0..23, or the day's local date. */
  buckets: string[];
  series: UsageSeries[];
}

// ---- privacy masking: what leaves this computer as a placeholder

/** What a masked value was. The placeholder shows it: `{{API_KEY_k3j4h5g6}}`. */
export const MASK_KIND = {
  privateKey: 'PRIVATE_KEY',
  apiKey: 'API_KEY',
  jwt: 'JWT',
  password: 'PASSWORD',
  email: 'EMAIL',
  phone: 'PHONE',
  idCard: 'ID_CARD',
  bankCard: 'BANK_CARD',
  term: 'TERM',
  custom: 'CUSTOM',
} as const;
export type MaskKind = (typeof MASK_KIND)[keyof typeof MASK_KIND];
export const MASK_KINDS = Object.values(MASK_KIND);

/** The kinds the "secrets" switch covers; the "personal" switch covers the next group; words and rules have their own lists. */
export const SECRET_KINDS: readonly MaskKind[] = [
  MASK_KIND.privateKey,
  MASK_KIND.apiKey,
  MASK_KIND.jwt,
  MASK_KIND.password,
];
export const PERSONAL_KINDS: readonly MaskKind[] = [
  MASK_KIND.email,
  MASK_KIND.phone,
  MASK_KIND.idCard,
  MASK_KIND.bankCard,
];

/** What happens when a value of a kind is found. */
export const MASK_ACTION = { mask: 'mask', warn: 'warn', block: 'block' } as const;
export type MaskAction = (typeof MASK_ACTION)[keyof typeof MASK_ACTION];

export interface MaskRule {
  /** A prefix the value starts with, or a regular expression when `regex` is set. */
  pattern: string;
  regex: boolean;
}

export interface RedactSettings {
  secrets: boolean;
  personal: boolean;
  /** Words to keep from vendors, matched whatever the case. */
  words: string[];
  rules: MaskRule[];
  /** Values sent as written wherever they are found whole. */
  allow: string[];
  /** Per kind; a kind not listed is masked. */
  actions: Partial<Record<MaskKind, MaskAction>>;
}

export const DEFAULT_REDACT_SETTINGS: RedactSettings = {
  secrets: false,
  personal: false,
  words: [],
  rules: [],
  allow: [],
  actions: {},
};

export const DEFAULT_REQUEST_HOOK_SETTINGS: RequestHookSettings = {
  logBody: false,
  retentionDays: REQUEST_RETENTION.default,
  redact: DEFAULT_REDACT_SETTINGS,
};

/** Masked kinds counted for one request. */
export type MaskCounts = Partial<Record<MaskKind, number>>;

export interface RedactPreview {
  text: string;
  masked: MaskCounts;
  /** Kinds found but sent as written (action "warn"). */
  warned: MaskCounts;
  /** The kind that would hold the request back, if any. */
  blocked?: MaskKind;
}
