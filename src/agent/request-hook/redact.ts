// Privacy masking for a model request: secrets, personal data and the user's own words leave this computer as
// placeholders such as `{{API_KEY_3fa9c01b}}`, and `restore` puts them back in the reply. The values stay in memory.
// A placeholder is the kind plus eight hex characters of a keyed hash, so a value gets the same placeholder every time
// and the conversation (and the vendor's prompt cache) reads the same turn after turn.
import { createHmac, randomBytes } from 'node:crypto';
import {
  MASK_ACTION, MASK_KIND, PERSONAL_KINDS, SECRET_KINDS,
  type MaskCounts, type MaskKind, type RedactPreview, type RedactSettings,
} from '@shared/request-log';
import { tr } from '@shared/i18n/runtime';

/** `{{KIND_xxxxxxxx}}` */
export const PLACEHOLDER = /\{\{[A-Z_]+_[0-9a-f]{8}\}\}/g;
const PLACEHOLDER_SPLIT = /(\{\{[A-Z_]+_[0-9a-f]{8}\}\})/;
const ID_LENGTH = 8;
/** A value shorter than this is only masked where a rule finds it, not everywhere it turns up as text. */
const MIN_KNOWN_LENGTH = 8;

export class MaskBlocked extends Error {
  constructor(readonly kind: MaskKind, length: number) {
    super(tr('privacy.blocked', { kind, length }));
  }
}

interface Rule {
  kind: MaskKind;
  re: RegExp;
  /** Capture group holding the value, when the match has more around it. Whole match otherwise. */
  group?: number;
  /** Rejects a match that only looks like the kind. */
  accept?: (value: string, text: string, index: number) => boolean;
}

const KEY_PREFIXES = [
  'sk-[A-Za-z0-9_-]{20,}', '(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}', 'github_pat_[A-Za-z0-9_]{40,}', 'glpat-[A-Za-z0-9_-]{20,}',
  'AIza[0-9A-Za-z_-]{35}', 'xox[abprs]-[A-Za-z0-9-]{10,}', 'sk_live_[A-Za-z0-9]{16,}', '(?:AKIA|ASIA)[A-Z0-9]{16}', 'hf_[A-Za-z0-9]{30,}',
  'gsk_[A-Za-z0-9]{40,}', 'xai-[A-Za-z0-9]{40,}', 'npm_[A-Za-z0-9]{36}', 'pypi-[A-Za-z0-9_-]{50,}', 'dop_v1_[a-f0-9]{64}',
  'SG\\.[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}', 'oc_sk_[A-Za-z0-9_-]{16,}',
];

/** Words in a field's name that make its value a secret: `DB_PASSWORD=`, `api_key:`, `"client_secret":`. */
const SECRET_FIELD = '[A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|credential|access[_-]?key|private[_-]?key)[A-Za-z0-9_.-]*';
const SECRET_VALUE_MIN = 8;

/** Text before an 11-digit number that says it is an id, not a phone. */
const NOT_A_PHONE = /(?:订单号|order[_ -]?id|[a-z_]*id)\s*["']?\s*[:=：]?\s*["']?$/i;

const luhn = (digits: string) => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
};

const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const ID_CHECK = '10X98765432';
const idCardValid = (id: string) => {
  const sum = ID_WEIGHTS.reduce((n, w, i) => n + w * Number(id[i]), 0);
  return ID_CHECK[sum % 11] === id[17].toUpperCase();
};

const SECRET_RULES: Rule[] = [
  { kind: MASK_KIND.privateKey, re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: MASK_KIND.apiKey, re: new RegExp(`(?<![A-Za-z0-9_-])(?:${KEY_PREFIXES.join('|')})`, 'g') },
  { kind: MASK_KIND.jwt, re: /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { kind: MASK_KIND.password, re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:([^\s@/]+)@/gi, group: 1 },
  {
    kind: MASK_KIND.password,
    re: new RegExp(`\\b${SECRET_FIELD}["']?\\s*[:=]\\s*["']?([^\\s"',;]{${SECRET_VALUE_MIN},})`, 'gi'),
    group: 1,
  },
];

const PERSONAL_RULES: Rule[] = [
  { kind: MASK_KIND.email, re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  {
    kind: MASK_KIND.idCard,
    re: /(?<![0-9A-Za-z])[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[0-9Xx](?![0-9A-Za-z])/g,
    accept: idCardValid,
  },
  { kind: MASK_KIND.bankCard, re: /(?<![0-9])[3-6]\d{15,18}(?![0-9])/g, accept: luhn },
  {
    kind: MASK_KIND.phone,
    re: /(?<![0-9])(?:\+?86[- ]?)?1[3-9]\d{9}(?![0-9])/g,
    accept: (_v, text, index) => !NOT_A_PHONE.test(text.slice(Math.max(0, index - 24), index)),
  },
];

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The rules a settings object asks for, in the order they run. Custom rules that don't compile are left out. */
export function compileRules(settings: RedactSettings): Rule[] {
  const rules: Rule[] = [];
  if (settings.secrets) rules.push(...SECRET_RULES);
  if (settings.personal) rules.push(...PERSONAL_RULES);
  for (const r of settings.rules) {
    try {
      rules.push({ kind: MASK_KIND.custom, re: new RegExp(r.regex ? r.pattern : `${escapeRegex(r.pattern)}\\S*`, 'g') });
    } catch {
      // checked when the settings are saved
    }
  }
  if (settings.words.length) {
    const alternatives = [...settings.words].sort((a, b) => b.length - a.length).map(escapeRegex).join('|');
    rules.push({ kind: MASK_KIND.term, re: new RegExp(alternatives, 'gi') });
  }
  return rules;
}

/** The kinds that are being masked, for the known-value pass. */
function activeKinds(settings: RedactSettings): Set<MaskKind> {
  const kinds = new Set<MaskKind>();
  if (settings.secrets) SECRET_KINDS.forEach((k) => kinds.add(k));
  if (settings.personal) PERSONAL_KINDS.forEach((k) => kinds.add(k));
  if (settings.rules.length) kinds.add(MASK_KIND.custom);
  if (settings.words.length) kinds.add(MASK_KIND.term);
  return kinds;
}

export const redactionWanted = (s: RedactSettings) => s.secrets || s.personal || s.words.length > 0 || s.rules.length > 0;

/** Fields whose values are the vendor's, not the user's: ids, names, types, signed or encrypted content, binary data. */
const KEEP_KEYS = new Set([
  'id', 'call_id', 'tool_call_id', 'tool_use_id', 'toolUseId', 'name', 'type', 'role', 'model', 'object', 'finish_reason', 'stop_reason',
  'signature', 'thoughtSignature', 'thought_signature', 'encrypted_content', 'data', 'mime_type', 'mimeType', 'media_type',
  // Reasoning goes back as the vendor wrote it: it is signed.
  'thinking', 'reasoning', 'reasoning_content', 'reasoning_text', 'reasoning_details',
  // Tool schemas are the tool's, not the conversation's.
  'parameters', 'input_schema', 'inputSchema', 'schema', 'json_schema',
]);
/** What a tool was called with or answered: its own fields are free text, so a field called "name" is masked too. */
const FREE_KEYS = new Set(['input', 'arguments', 'args', 'functionCall', 'functionResponse', 'response', 'output']);

type Entry = { kind: MaskKind; value: string; placeholder: string };

/** The values masked since the app started, shared by every request so a placeholder means one value. */
export class Redactor {
  private readonly key = randomBytes(32);
  private readonly values = new Map<string, Entry>();
  private readonly byPlaceholder = new Map<string, Entry>();
  /** Values long enough to match as plain text, longest first. */
  private known: Entry[] = [];

  /** Starts masking one request under `settings`. */
  begin(settings: RedactSettings, dryRun = false): MaskPass {
    return new MaskPass(this, settings, dryRun);
  }

  /** The placeholder for `value`, made the first time it is seen. */
  placeholderFor(kind: MaskKind, value: string): string {
    const id = `${kind}\0${value}`;
    const hit = this.values.get(id);
    if (hit) return hit.placeholder;
    const digest = createHmac('sha256', this.key).update(id).digest('hex');
    let at = 0;
    let placeholder = `{{${kind}_${digest.slice(at, at + ID_LENGTH)}}}`;
    while (this.byPlaceholder.has(placeholder) && at + ID_LENGTH < digest.length) {
      at++;
      placeholder = `{{${kind}_${digest.slice(at, at + ID_LENGTH)}}}`;
    }
    const entry = { kind, value, placeholder };
    this.values.set(id, entry);
    this.byPlaceholder.set(placeholder, entry);
    if (value.length >= MIN_KNOWN_LENGTH) this.known = [...this.known, entry].sort((a, b) => b.value.length - a.value.length);
    return placeholder;
  }

  knownValues(kinds: Set<MaskKind>): Entry[] {
    return this.known.filter((e) => kinds.has(e.kind));
  }

  /** `text` with the placeholders it holds replaced by their values. `escaped` fits them into a JSON string. */
  restore(text: string, escaped = false): string {
    if (!text.includes('{{')) return text;
    return text.replace(PLACEHOLDER, (p) => {
      const value = this.byPlaceholder.get(p)?.value;
      if (value === undefined) return p;
      return escaped ? JSON.stringify(value).slice(1, -1) : value;
    });
  }

  /** Deep `restore` for parsed tool arguments. */
  restoreDeep<T>(value: T): T {
    if (typeof value === 'string') return this.restore(value) as T;
    if (Array.isArray(value)) return value.map((v) => this.restoreDeep(v)) as T;
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.restoreDeep(v)])) as T;
    return value;
  }
}

/** One request's masking. Counts what it masked, and what it only found when the kind's action is "warn". */
export class MaskPass {
  readonly masked: MaskCounts = {};
  readonly warned: MaskCounts = {};
  blocked?: MaskKind;
  private readonly rules: Rule[];
  private readonly kinds: Set<MaskKind>;
  private readonly allow: Set<string>;

  constructor(private readonly redactor: Redactor, private readonly settings: RedactSettings, private readonly dryRun: boolean) {
    this.rules = compileRules(settings);
    this.kinds = activeKinds(settings);
    this.allow = new Set(settings.allow);
  }

  get total(): number {
    return Object.values(this.masked).reduce((n, c) => n + c, 0);
  }

  /** Decides what to do with a found value; returns the text to put in its place. */
  private handle(kind: MaskKind, value: string): string {
    if (this.allow.has(value)) return value;
    const action = this.settings.actions[kind] ?? MASK_ACTION.mask;
    if (action === MASK_ACTION.warn) {
      this.warned[kind] = (this.warned[kind] ?? 0) + 1;
      return value;
    }
    if (action === MASK_ACTION.block) {
      if (!this.dryRun) throw new MaskBlocked(kind, value.length);
      this.blocked ??= kind;
      return value;
    }
    this.masked[kind] = (this.masked[kind] ?? 0) + 1;
    return this.redactor.placeholderFor(kind, value);
  }

  private applyRule(segment: string, rule: Rule): string {
    let out = '';
    let last = 0;
    for (const m of segment.matchAll(new RegExp(rule.re.source, `${rule.re.flags.replace('d', '')}d`))) {
      const range = rule.group ? (m as RegExpMatchArray & { indices: [number, number][] }).indices[rule.group] : [m.index!, m.index! + m[0].length];
      if (!range) continue;
      const [from, to] = range;
      const value = segment.slice(from, to);
      if (!value || (rule.accept && !rule.accept(value, segment, from))) continue;
      out += segment.slice(last, from) + this.handle(rule.kind, value);
      last = to;
    }
    return out + segment.slice(last);
  }

  /** Values masked before turn up again as plain text (a model repeats a password, the history carries it back). */
  private applyKnown(segment: string): string {
    let out = segment;
    for (const e of this.redactor.knownValues(this.kinds)) {
      if (out.includes(e.value)) out = out.split(e.value).join(this.handle(e.kind, e.value));
    }
    return out;
  }

  maskText(text: string): string {
    if (!text) return text;
    // Placeholders made earlier in this text are left alone, and no rule matches across one.
    const outside = (s: string, fn: (segment: string) => string) =>
      s.split(PLACEHOLDER_SPLIT).map((part, i) => (i % 2 ? part : fn(part))).join('');
    let out = text;
    for (const rule of this.rules) out = outside(out, (seg) => this.applyRule(seg, rule));
    return this.kinds.size ? outside(out, (seg) => this.applyKnown(seg)) : out;
  }

  /** `payload` as a copy with every string of the user's masked, in the shape the vendor takes. */
  maskPayload<T>(payload: T): T {
    return this.walk(payload, true, undefined) as T;
  }

  private walk(value: unknown, keep: boolean, key: string | undefined): unknown {
    if (typeof value === 'string') {
      if ((keep && key && KEEP_KEYS.has(key)) || value.startsWith('data:')) return value;
      return this.maskText(value);
    }
    if (Array.isArray(value)) return value.map((v) => this.walk(v, keep, key));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = keep && KEEP_KEYS.has(k) && typeof v === 'object' ? v : this.walk(v, keep && !FREE_KEYS.has(k), k);
      }
      return out;
    }
    return value;
  }
}

/** What the vendor would get for `text`, for the Settings page's "Try it". Nothing is kept. */
export function previewMasking(text: string, settings: RedactSettings): RedactPreview {
  const pass = new Redactor().begin(settings, true);
  const masked = pass.maskText(text);
  return { text: masked, masked: pass.masked, warned: pass.warned, ...(pass.blocked ? { blocked: pass.blocked } : {}) };
}
