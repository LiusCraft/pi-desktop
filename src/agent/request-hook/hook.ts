// The one place every model request passes: the shared ModelRuntime's streamSimple. Main sessions, subagents,
// compaction and the side calls (naming, suggestions, side chat) all go through it, which pi's extension events
// can't promise. It records each request when it ends, and masks what the privacy settings ask for on the way out
// and restores it on the way back. Masking fails closed: a request that can't be masked is not sent.
import { randomUUID } from 'node:crypto';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { REQUEST_BODY_LIMIT, REQUEST_STATUS, type RequestRecord, type RequestStatus } from '@shared/request-log';
import type { RequestLog } from './log';
import { Redactor, redactionWanted, type MaskPass } from './redact';
import { currentOrigin } from './origin';
import { restoreStream } from './restore';

type StreamSimple = ModelRuntime['streamSimple'];

const STATUS_BY_STOP: Partial<Record<AssistantMessage['stopReason'], RequestStatus>> = {
  error: REQUEST_STATUS.error,
  aborted: REQUEST_STATUS.aborted,
};

/** The events that carry the model's own output, the first of which ends the wait. */
const FIRST_TOKEN_EVENTS = new Set(['text_delta', 'thinking_delta', 'toolcall_delta']);

const clip = (s: string) => (s.length > REQUEST_BODY_LIMIT ? s.slice(0, REQUEST_BODY_LIMIT) : s);

function bodyOf(payload: unknown): string | undefined {
  try {
    return clip(typeof payload === 'string' ? payload : JSON.stringify(payload));
  } catch {
    return undefined;
  }
}

/** Patches `models` in place so each streamSimple request is masked as asked and ends up in `log`. */
export function recordRequests(models: ModelRuntime, log: RequestLog, redactor = new Redactor()) {
  const original: StreamSimple = models.streamSimple.bind(models);
  // A virtual model's request is routed through streamSimple again; both ends see the same message.
  const recorded = new WeakSet<AssistantMessage>();

  models.streamSimple = (model, context, options) => {
    const startedAt = Date.now();
    let httpStatus: number | undefined;
    let body: string | undefined;
    let pass: MaskPass | undefined;
    let firstTokenMs: number | undefined;
    const origin = currentOrigin() ?? log.originOf(options?.sessionId);
    const settings = log.getSettings();
    const masking = redactionWanted(settings.redact);
    const wrapped: typeof options = {
      ...options,
      onPayload: async (payload, m) => {
        const changed = await options?.onPayload?.(payload, m);
        let sent = changed === undefined ? payload : changed;
        if (masking) {
          pass = redactor.begin(settings.redact);
          sent = pass.maskPayload(sent);
        }
        if (settings.logBody) body = bodyOf(sent);
        return masking ? sent : changed;
      },
      onResponse: async (response, m) => {
        httpStatus = response.status;
        await options?.onResponse?.(response, m);
      },
    };

    const source = original(model, context, wrapped);
    const stream = restoreStream(
      source,
      redactor,
      () => (pass?.total ?? 0) > 0,
      (ev) => {
        if (firstTokenMs === undefined && FIRST_TOKEN_EVENTS.has(ev.type)) firstTokenMs = Date.now() - startedAt;
      },
    );
    const { input, output, cacheRead, cacheWrite } = model.cost ?? {};
    const unpriced = !(input || output || cacheRead || cacheWrite);
    const base = {
      id: randomUUID(),
      at: startedAt,
      sessionId: origin?.session ?? options?.sessionId,
      provider: model.provider,
      model: model.id,
    };
    const write = (
      rec: Omit<
        RequestRecord,
        | 'id'
        | 'at'
        | 'sessionId'
        | 'provider'
        | 'model'
        | 'httpStatus'
        | 'body'
        | 'masked'
        | 'firstTokenMs'
        | 'origin'
        | 'subagent'
      >,
    ) =>
      log.append({
        ...base,
        ...rec,
        httpStatus,
        ...(firstTokenMs === undefined ? {} : { firstTokenMs }),
        ...(origin ? { origin: origin.origin, ...(origin.subagent ? { subagent: origin.subagent } : {}) } : {}),
        ...(pass && pass.total > 0 ? { masked: pass.masked } : {}),
        ...(body === undefined ? {} : { body }),
      });

    stream.result().then(
      (msg) => {
        if (recorded.has(msg)) return;
        recorded.add(msg);
        write({
          status: STATUS_BY_STOP[msg.stopReason] ?? REQUEST_STATUS.ok,
          durationMs: msg.durationMs ?? Date.now() - startedAt,
          tokens: {
            input: msg.usage.input,
            output: msg.usage.output,
            cacheRead: msg.usage.cacheRead,
            cacheWrite: msg.usage.cacheWrite,
          },
          cost: msg.usage.cost.total,
          ...(unpriced ? { unpriced } : {}),
          error: msg.errorMessage,
        });
      },
      (err: unknown) =>
        write({
          status: REQUEST_STATUS.error,
          durationMs: Date.now() - startedAt,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          cost: 0,
          error: err instanceof Error ? err.message : String(err),
        }),
    );
    return stream;
  };
}
