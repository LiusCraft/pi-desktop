import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordRequests } from '../src/agent/request-hook/hook';
import { RequestLog } from '../src/agent/request-hook/log';
import { withOrigin } from '../src/agent/request-hook/origin';
import { DEFAULT_REDACT_SETTINGS, REQUEST_STATUS, type RequestRecord } from '../src/shared/request-log';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'request-log-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const DAY = 86_400_000;
const record = (over: Partial<RequestRecord> = {}): RequestRecord => ({
  id: 'r', at: Date.now(), provider: 'p', model: 'm', status: REQUEST_STATUS.ok, durationMs: 5,
  tokens: { input: 10, output: 20, cacheRead: 1, cacheWrite: 2 }, cost: 0.5, ...over,
});

describe('RequestLog', () => {
  it('lists newest first and filters', () => {
    const log = new RequestLog(dir);
    log.append(record({ id: 'a', at: Date.now() - 2000, sessionId: 's1' }));
    log.append(record({ id: 'b', at: Date.now() - 1000, model: 'other' }));
    log.append(record({ id: 'c', at: Date.now() }));
    expect(log.list({ limit: 10 }).map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect(log.list({ limit: 2 }).map((r) => r.id)).toEqual(['c', 'b']);
    expect(log.list({ limit: 10, sessionId: 's1' }).map((r) => r.id)).toEqual(['a']);
    expect(log.list({ limit: 10, model: 'other' }).map((r) => r.id)).toEqual(['b']);
  });

  it('sums usage into series and buckets', () => {
    const log = new RequestLog(dir);
    const now = Date.now();
    log.append(record({ at: now }));
    log.append(record({ at: now, status: REQUEST_STATUS.error, unpriced: true }));
    log.append(record({ at: now - DAY, model: 'other', provider: 'q', durationMs: 2000, tokens: { input: 1, output: 100, cacheRead: 0, cacheWrite: 0 } }));

    const week = log.summary({ days: 7, split: 'model' }, now);
    expect(week.unit).toBe('day');
    expect(week.buckets).toHaveLength(7);
    expect(week.total).toMatchObject({ requests: 3, failed: 1, unpriced: 1, input: 21, output: 140, cacheRead: 2, cacheWrite: 4, cost: 1.5 });
    const m = week.series.find((x) => x.key === 'm')!;
    expect(m.requests.at(-1)).toBe(2);
    expect(m.tokens.at(-1)).toBe(2 * (10 + 20 + 1 + 2));
    // only the request that finished and produced output counts for speed
    expect(m.total).toMatchObject({ speedTokens: 20, speedMs: 5 });

    expect(log.summary({ days: 7, split: 'provider' }, now).series.map((x) => x.key).sort()).toEqual(['p', 'q']);
    expect(log.summary({ days: 7, split: 'modelProvider' }, now).series.map((x) => x.key).sort()).toEqual(['p/m', 'q/other']);
  });

  it('cuts today by hour', () => {
    const log = new RequestLog(dir);
    const now = new Date();
    now.setHours(13, 30, 0, 0);
    log.append(record({ at: now.getTime() }));
    log.append(record({ at: now.getTime() - DAY }));
    const today = log.summary({ days: 1, split: 'model' }, now.getTime());
    expect(today.unit).toBe('hour');
    expect(today.buckets).toHaveLength(24);
    expect(today.total.requests).toBe(1);
    expect(today.series[0].requests[13]).toBe(1);
  });

  it('deletes days past the retention', () => {
    const log = new RequestLog(dir);
    log.saveSettings({ retentionDays: 3 });
    log.append(record({ id: 'old', at: Date.now() - 10 * DAY }));
    log.append(record({ id: 'new' }));
    log.prune();
    expect(log.list({ limit: 10 }).map((r) => r.id)).toEqual(['new']);
  });

  it('keeps settings across instances, bodies off by default', () => {
    expect(new RequestLog(dir).getSettings().logBody).toBe(false);
    new RequestLog(dir).saveSettings({ logBody: true, retentionDays: 9999 });
    expect(new RequestLog(dir).getSettings()).toMatchObject({ logBody: true, retentionDays: 365 });
  });

  it('skips a half-written line', () => {
    const log = new RequestLog(dir);
    log.append(record({ id: 'ok' }));
    const file = fs.readdirSync(path.join(dir, 'request-log'))[0];
    fs.appendFileSync(path.join(dir, 'request-log', file), '{"id":"cut');
    expect(log.list({ limit: 10 }).map((r) => r.id)).toEqual(['ok']);
  });
});

function message(over: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant', content: [], api: 'openai-completions', provider: 'p', model: 'm', stopReason: 'stop', timestamp: Date.now(),
    usage: { input: 3, output: 4, cacheRead: 0, cacheWrite: 0, totalTokens: 7, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.25 } },
    ...over,
  } as AssistantMessage;
}

/** A runtime whose streamSimple walks the request callbacks and then ends with `msg`. */
function fakeRuntime(msg: AssistantMessage, payload: unknown = { messages: ['hi'] }) {
  const models = {
    streamSimple(_model: unknown, _ctx: unknown, options: any) {
      const stream = createAssistantMessageEventStream();
      void (async () => {
        await options?.onPayload?.(payload, _model);
        await options?.onResponse?.({ status: 200, headers: {} }, _model);
        stream.push({ type: 'done', reason: 'stop', message: msg } as never);
        stream.end(msg);
      })();
      return stream;
    },
  };
  return models as unknown as ModelRuntime;
}

const model = { provider: 'p', id: 'm' } as never;
const settle = () => new Promise((r) => setTimeout(r, 20));

describe('recordRequests', () => {
  it('records tokens, cost, status and session, without a body', async () => {
    const log = new RequestLog(dir);
    const models = fakeRuntime(message());
    recordRequests(models, log);
    await models.streamSimple(model, { messages: [] }, { sessionId: 's1' }).result();
    await settle();
    expect(log.list({ limit: 5 })).toMatchObject([
      { sessionId: 's1', provider: 'p', model: 'm', status: 'ok', httpStatus: 200, cost: 0.25, tokens: { input: 3, output: 4 } },
    ]);
    expect(log.list({ limit: 5 })[0].body).toBeUndefined();
  });

  it('keeps the body only when asked, and still calls the caller\'s own callbacks', async () => {
    const log = new RequestLog(dir);
    log.saveSettings({ logBody: true });
    const models = fakeRuntime(message());
    recordRequests(models, log);
    let seen: unknown;
    await models.streamSimple(model, { messages: [] }, { onPayload: (p: unknown) => void (seen = p) } as never).result();
    await settle();
    expect(seen).toEqual({ messages: ['hi'] });
    expect(log.list({ limit: 5 })[0].body).toBe('{"messages":["hi"]}');
  });

  it('marks errors and aborts', async () => {
    const log = new RequestLog(dir);
    const models = fakeRuntime(message({ stopReason: 'error', errorMessage: 'boom' }));
    recordRequests(models, log);
    await models.streamSimple(model, { messages: [] }).result();
    await settle();
    expect(log.list({ limit: 5 })[0]).toMatchObject({ status: 'error', error: 'boom' });
  });

  it('records one message once', async () => {
    const log = new RequestLog(dir);
    const msg = message();
    const models = fakeRuntime(msg);
    recordRequests(models, log);
    await models.streamSimple(model, { messages: [] }).result();
    await models.streamSimple(model, { messages: [] }).result();
    await settle();
    expect(log.list({ limit: 5 })).toHaveLength(1);
  });
});

describe('recordRequests with masking', () => {
  /** A vendor that answers with the user's text, chopped into 3-character chunks. */
  function echoRuntime() {
    const sent: unknown[] = [];
    const models = {
      streamSimple(_model: unknown, _ctx: unknown, options: any) {
        const stream = createAssistantMessageEventStream();
        void (async () => {
          const payload = await options.onPayload({ messages: [{ role: 'user', content: 'mail a@b.com' }] }, _model);
          sent.push(payload);
          const answer: string = payload.messages[0].content;
          let text = '';
          for (let i = 0; i < answer.length; i += 3) {
            const delta = answer.slice(i, i + 3);
            text += delta;
            stream.push({ type: 'text_delta', contentIndex: 0, delta, partial: message({ content: [{ type: 'text', text }] }) } as never);
          }
          const done = message({ content: [{ type: 'text', text: answer }] });
          stream.push({ type: 'text_end', contentIndex: 0, content: answer, partial: done } as never);
          stream.push({ type: 'done', reason: 'stop', message: done } as never);
          stream.end(done);
        })().catch((err) => {
          const failed = message({ stopReason: 'error', errorMessage: String(err.message) });
          stream.push({ type: 'error', reason: 'error', error: failed } as never);
          stream.end(failed);
        });
        return stream;
      },
    };
    return { models: models as unknown as ModelRuntime, sent };
  }

  it('sends placeholders, hands the caller the real values, and logs what was masked', async () => {
    const log = new RequestLog(dir);
    log.saveSettings({ logBody: true, redact: { ...DEFAULT_REDACT_SETTINGS, personal: true } });
    const { models, sent } = echoRuntime();
    recordRequests(models, log);
    const stream = models.streamSimple(model, { messages: [] });
    let streamed = '';
    for await (const e of stream) if (e.type === 'text_delta') streamed += e.delta;
    const result = await stream.result();
    await settle();

    expect(JSON.stringify(sent)).not.toContain('a@b.com');
    expect(JSON.stringify(sent)).toMatch(/\{\{EMAIL_[0-9a-f]{8}\}\}/);
    expect(streamed).toBe('mail a@b.com');
    expect((result.content[0] as { text: string }).text).toBe('mail a@b.com');
    const [rec] = log.list({ limit: 1 });
    expect(rec.masked).toEqual({ EMAIL: 1 });
    expect(rec.body).not.toContain('a@b.com');
  });

  it('holds a request back instead of sending a blocked value', async () => {
    const log = new RequestLog(dir);
    log.saveSettings({ redact: { ...DEFAULT_REDACT_SETTINGS, personal: true, actions: { EMAIL: 'block' } } });
    const { models, sent } = echoRuntime();
    recordRequests(models, log);
    const result = await models.streamSimple(model, { messages: [] }).result();
    await settle();
    expect(sent).toEqual([]);
    expect(result.stopReason).toBe('error');
    expect(result.errorMessage).not.toContain('a@b.com');
    expect(log.list({ limit: 1 })[0].status).toBe('error');
  });
});

describe('records made before sessions were tagged', () => {
  it("are given the app's session and its kind when pi's id is part of the session file's name", () => {
    const log = new RequestLog(dir);
    log.findSession = (id) => (id === 'pi-id' ? { origin: 'work', session: 'hub-9' } : undefined);
    log.append(record({ id: 'old', sessionId: 'pi-id' }));
    log.append(record({ id: 'known', sessionId: 'hub-9', origin: 'code' }));
    log.append(record({ id: 'none', sessionId: 'elsewhere' }));
    const byId = Object.fromEntries(log.list({ limit: 10 }).map((r) => [r.id, [r.sessionId, r.origin]]));
    expect(byId).toEqual({ old: ['hub-9', 'work'], known: ['hub-9', 'code'], none: ['elsewhere', undefined] });
    expect(log.summary({ days: 1, split: 'session' }).series.map((s) => [s.key, s.total.requests]).sort()).toEqual([['elsewhere', 1], ['hub-9', 2]]);
  });
});

describe('first token and origin', () => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** A model that thinks for a while, streams a bit, then ends. */
  function slowRuntime() {
    const models = {
      streamSimple() {
        const stream = createAssistantMessageEventStream();
        void (async () => {
          await wait(40);
          stream.push({ type: 'text_delta', contentIndex: 0, delta: 'hi', partial: message() } as never);
          await wait(40);
          const done = message();
          stream.push({ type: 'done', reason: 'stop', message: done } as never);
          stream.end(done);
        })();
        return stream;
      },
    };
    return models as unknown as ModelRuntime;
  }

  it('records when the first token came back, and speed counts from there', async () => {
    const log = new RequestLog(dir);
    const models = slowRuntime();
    recordRequests(models, log);
    await models.streamSimple(model, { messages: [] }).result();
    await settle();
    const [rec] = log.list({ limit: 1 });
    expect(rec.firstTokenMs).toBeGreaterThanOrEqual(30);
    const { total } = log.summary({ days: 1, split: 'model' });
    expect(total.speedMs).toBeLessThan(rec.durationMs);
    expect(total.speedMs).toBe(rec.durationMs - rec.firstTokenMs!);
  });

  it('files a request under the call that made it, the tagged session, or the session kind', async () => {
    const log = new RequestLog(dir);
    log.resolveSession = (id) => (id === 'main' ? { origin: 'code', session: 'hub-1' } : undefined);
    log.tagSession('sub', { origin: 'subagent', subagent: 'explorer', session: 'hub-1' });
    // A new message each time: one message is recorded once.
    const models = {
      streamSimple() {
        const stream = createAssistantMessageEventStream();
        const done = message();
        stream.push({ type: 'done', reason: 'stop', message: done } as never);
        stream.end(done);
        return stream;
      },
    } as unknown as ModelRuntime;
    recordRequests(models, log);
    const ask = (sessionId: string) => models.streamSimple(model, { messages: [] }, { sessionId }).result();
    await ask('main');
    await ask('sub');
    await withOrigin({ origin: 'naming' }, () => ask('main'));
    await models.streamSimple(model, { messages: [] }).result();
    await settle();
    const all = log.list({ limit: 10 }).reverse();
    expect(all.map((r) => [r.origin, r.subagent])).toEqual([['code', undefined], ['subagent', 'explorer'], ['naming', undefined], [undefined, undefined]]);
    expect(log.summary({ days: 1, split: 'purpose' }).series.map((s) => s.key).sort()).toEqual(['code', 'naming', 'other', 'subagent:explorer']);
    // the app's own session id replaces pi's; a side call keeps the id it was made with; no session is its own series
    expect(all.map((r) => r.sessionId)).toEqual(['hub-1', 'hub-1', 'main', undefined]);
    expect(log.summary({ days: 1, split: 'session' }).series.map((s) => [s.key, s.total.requests]).sort()).toEqual([['hub-1', 2], ['main', 1], ['none', 1]]);
  });
});
