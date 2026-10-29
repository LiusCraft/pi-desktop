// The model request log on disk: `<app data>/request-log/<YYYY-MM-DD>.jsonl`, one record per line, appended as
// requests finish. Old days are deleted by the retention setting. Writing must never get in a request's way.
import fs from 'node:fs';
import path from 'node:path';
import { dayKey } from '@shared/activity';
import { tr } from '@shared/i18n/runtime';
import {
  DEFAULT_REQUEST_HOOK_SETTINGS, HOURS_IN_DAY, NO_SESSION_KEY, ORIGIN_OTHER, REQUEST_ORIGIN, REQUEST_STATUS, SUBAGENT_KEY_PREFIX, USAGE_SPLIT, normalizeRedactSettings, normalizeRequestHookSettings,
  type RedactPreview, type RedactSettings, type RequestHookSettings, type RequestQuery, type RequestRecord, type UsageQuery, type UsageSeries, type UsageSummary, type UsageTotals,
} from '@shared/request-log';
import { appRequestHookFile, appRequestLogDir } from '../app-paths';
import type { Origin } from './origin';
import { previewMasking } from './redact';

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
const DAY_MS = 86_400_000;

/** What streaming took: the time after the first token, which is what the output speed is measured over. */
const streamMs = (r: RequestRecord) => r.durationMs - (r.firstTokenMs ?? 0);

function seriesKey(split: UsageQuery['split'], r: RequestRecord): string {
  switch (split) {
    case USAGE_SPLIT.provider: return r.provider;
    case USAGE_SPLIT.modelProvider: return `${r.provider}/${r.model}`;
    case USAGE_SPLIT.session: return r.sessionId ?? NO_SESSION_KEY;
    case USAGE_SPLIT.purpose: return r.origin === REQUEST_ORIGIN.subagent && r.subagent ? SUBAGENT_KEY_PREFIX + r.subagent : r.origin ?? ORIGIN_OTHER;
    default: return r.model;
  }
}

const emptyTotals = (): UsageTotals => ({ requests: 0, failed: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, unpriced: 0, speedTokens: 0, speedMs: 0, timed: 0 });

function addRecord(t: UsageTotals, r: RequestRecord, timed: boolean) {
  t.requests++;
  if (r.status !== REQUEST_STATUS.ok) t.failed++;
  t.input += r.tokens.input;
  t.output += r.tokens.output;
  t.cacheRead += r.tokens.cacheRead;
  t.cacheWrite += r.tokens.cacheWrite;
  t.cost += r.cost;
  if (r.unpriced) t.unpriced++;
  if (timed) {
    t.speedTokens += r.tokens.output;
    t.speedMs += streamMs(r);
    t.timed++;
  }
}

export class RequestLog {
  private settings: RequestHookSettings;
  private prunedOn = '';
  private readonly tagged = new Map<string, Origin>();
  /** Says what a session id belongs to when it was not tagged (the hub's own sessions). */
  resolveSession: (sessionId: string) => Origin | undefined = () => undefined;
  /**
   * Finds the app's session that a stored id belongs to: records made before sessions were tagged hold pi's own id,
   * which is part of the session's file name. Undefined when the id is already the app's, or matches no session.
   */
  findSession: (storedId: string) => Origin | undefined = () => undefined;

  constructor(private readonly dataDir: string) {
    this.settings = this.readSettings();
  }

  private get dir() {
    return appRequestLogDir(this.dataDir);
  }

  private readSettings(): RequestHookSettings {
    try {
      return normalizeRequestHookSettings(JSON.parse(fs.readFileSync(appRequestHookFile(this.dataDir), 'utf8')));
    } catch {
      return { ...DEFAULT_REQUEST_HOOK_SETTINGS };
    }
  }

  /** Requests of this session id belong to `origin` until `untagSession`. */
  tagSession(sessionId: string, origin: Origin) {
    this.tagged.set(sessionId, origin);
  }

  untagSession(sessionId: string) {
    this.tagged.delete(sessionId);
  }

  originOf(sessionId: string | undefined): Origin | undefined {
    return sessionId ? this.tagged.get(sessionId) ?? this.resolveSession(sessionId) : undefined;
  }

  getSettings(): RequestHookSettings {
    return this.settings;
  }

  saveSettings(draft: Partial<RequestHookSettings>): RequestHookSettings {
    const next = normalizeRequestHookSettings({ ...this.settings, ...draft });
    for (const r of next.redact.rules) {
      if (!r.regex) continue;
      try {
        new RegExp(r.pattern);
      } catch {
        throw new Error(tr('privacy.badRule', { rule: r.pattern }));
      }
    }
    this.settings = next;
    const file = appRequestHookFile(this.dataDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(this.settings, null, 2));
    this.prune();
    return this.settings;
  }

  /** Never throws: a full disk or a locked file loses a record, not the request. */
  append(record: RequestRecord) {
    try {
      const day = dayKey(record.at);
      fs.mkdirSync(this.dir, { recursive: true });
      fs.appendFileSync(path.join(this.dir, `${day}.jsonl`), JSON.stringify(record) + '\n');
      if (this.prunedOn !== day) this.prune();
    } catch {
      // see above
    }
  }

  /** Deletes the days past the retention. */
  prune(now = Date.now()) {
    this.prunedOn = dayKey(now);
    const oldest = dayKey(now - this.settings.retentionDays * DAY_MS);
    for (const [day, file] of this.days()) {
      if (day < oldest) fs.rmSync(file, { force: true });
    }
  }

  /** Day files, newest first. */
  private days(): [string, string][] {
    let names: string[];
    try {
      names = fs.readdirSync(this.dir);
    } catch {
      return [];
    }
    return names
      .flatMap((n) => {
        const day = DAY_FILE.exec(n)?.[1];
        return day ? [[day, path.join(this.dir, n)] as [string, string]] : [];
      })
      .sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }

  /** A stored record with its session and purpose filled in from what is known now, for records that lack them. */
  private mend(r: RequestRecord): RequestRecord {
    if (!r.sessionId) return r;
    const found = this.findSession(r.sessionId);
    if (!found?.session) return r;
    return { ...r, sessionId: found.session, origin: r.origin ?? found.origin };
  }

  private read(file: string): RequestRecord[] {
    try {
      return fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line) => {
          if (!line) return [];
          try {
            return [this.mend(JSON.parse(line) as RequestRecord)];
          } catch {
            return []; // a half-written last line
          }
        });
    } catch {
      return [];
    }
  }

  /** What the vendor would get for `text`; `settings` are the form's unsaved values, or the saved ones. */
  preview(text: string, settings?: RedactSettings): RedactPreview {
    return previewMasking(text, normalizeRedactSettings(settings ?? this.settings.redact));
  }

  list(query: RequestQuery): RequestRecord[] {
    const out: RequestRecord[] = [];
    for (const [, file] of this.days()) {
      const records = this.read(file).reverse();
      for (const r of records) {
        if (query.before !== undefined && r.at >= query.before) continue;
        if (query.sessionId && r.sessionId !== query.sessionId) continue;
        if (query.model && r.model !== query.model) continue;
        out.push(r);
        if (out.length >= query.limit) return out;
      }
    }
    return out;
  }

  /** What the requests of the last `days` local days used, cut into hours (today) or days, one series per `split` key. */
  summary({ days, split }: UsageQuery, now = Date.now()): UsageSummary {
    const hourly = days === 1;
    const buckets = hourly
      ? Array.from({ length: HOURS_IN_DAY }, (_, h) => String(h))
      : Array.from({ length: days }, (_, i) => dayKey(now - (days - 1 - i) * DAY_MS));
    const at = new Map(buckets.map((b, i) => [b, i]));
    const total = emptyTotals();
    const series = new Map<string, UsageSeries>();
    const since = dayKey(now - (days - 1) * DAY_MS);
    for (const [day, file] of this.days()) {
      if (day < since) break;
      for (const r of this.read(file)) {
        const i = at.get(hourly ? String(new Date(r.at).getHours()) : day);
        if (i === undefined) continue;
        const key = seriesKey(split, r);
        let line = series.get(key);
        if (!line) {
          const zeros = () => Array<number>(buckets.length).fill(0);
          line = { key, label: key, total: emptyTotals(), requests: zeros(), tokens: zeros(), cost: zeros(), speedTokens: zeros(), speedMs: zeros() };
          series.set(key, line);
        }
        const used = r.tokens.input + r.tokens.output + r.tokens.cacheRead + r.tokens.cacheWrite;
        const timed = r.status === REQUEST_STATUS.ok && r.tokens.output > 0 && streamMs(r) > 0;
        line.requests[i]++;
        line.tokens[i] += used;
        line.cost[i] += r.cost;
        if (timed) {
          line.speedTokens[i] += r.tokens.output;
          line.speedMs[i] += streamMs(r);
        }
        for (const t of [total, line.total]) addRecord(t, r, timed);
      }
    }
    const sum = (l: UsageSeries) => l.tokens.reduce((n, v) => n + v, 0);
    return { total, unit: hourly ? 'hour' : 'day', buckets, series: [...series.values()].sort((x, y) => sum(y) - sum(x)) };
  }
}
