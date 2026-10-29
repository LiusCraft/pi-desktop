// Puts masked values back into the model's reply while it streams, so the session, the screen and the files the model
// writes hold the real values. Text and tool-call arguments are restored; reasoning is left as the vendor wrote it,
// since it is signed.
import { createAssistantMessageEventStream, type AssistantMessage, type AssistantMessageEvent, type AssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { Redactor } from './redact';

/** A placeholder cut off at the end of a chunk: `{`, `{{`, `{{API_KEY_3f`, `{{API_KEY_3fa9c01b}`. */
const OPEN_PLACEHOLDER = /\{(?:\{[A-Za-z0-9_]{0,24}\}?)?$/;

type Held = 'text' | 'toolcall';

/** `text` split into what can be passed on now and a tail that may still grow into a placeholder. */
export function splitOpenTail(text: string): [string, string] {
  const at = text.search(OPEN_PLACEHOLDER);
  return at < 0 ? [text, ''] : [text.slice(0, at), text.slice(at)];
}

export function restoreMessage(redactor: Redactor, msg: AssistantMessage): AssistantMessage {
  return {
    ...msg,
    content: msg.content.map((block) => {
      if (block.type === 'text') return block.text.includes('{{') ? { ...block, text: redactor.restore(block.text) } : block;
      if (block.type === 'toolCall') return { ...block, arguments: redactor.restoreDeep(block.arguments) };
      return block;
    }),
  };
}

/**
 * `source` with placeholders restored in every event. While `active()` is false the request had nothing masked and
 * events pass through as they are. `observe` sees each event as it comes from `source`.
 */
export function restoreStream(source: AssistantMessageEventStream, redactor: Redactor, active: () => boolean, observe?: (ev: AssistantMessageEvent) => void): AssistantMessageEventStream {
  const out = createAssistantMessageEventStream();
  // The tail of a text or tool-call block that may be a placeholder in the making, by block.
  const held = new Map<string, string>();
  const slot = (kind: Held, index: number) => `${kind}:${index}`;

  const flush = (partial: AssistantMessage, only?: string): AssistantMessageEvent[] => {
    const events: AssistantMessageEvent[] = [];
    for (const [key, tail] of [...held]) {
      if (only && key !== only) continue;
      held.delete(key);
      if (!tail) continue;
      const [kind, index] = key.split(':') as [Held, string];
      const delta = redactor.restore(tail, kind === 'toolcall');
      events.push(kind === 'text'
        ? { type: 'text_delta', contentIndex: Number(index), delta, partial }
        : { type: 'toolcall_delta', contentIndex: Number(index), delta, partial });
    }
    return events;
  };

  const transform = (ev: AssistantMessageEvent): AssistantMessageEvent[] => {
    switch (ev.type) {
      case 'text_delta':
      case 'toolcall_delta': {
        const kind: Held = ev.type === 'text_delta' ? 'text' : 'toolcall';
        const key = slot(kind, ev.contentIndex);
        const [now, tail] = splitOpenTail((held.get(key) ?? '') + ev.delta);
        held.set(key, tail);
        const partial = restoreMessage(redactor, ev.partial);
        return now ? [{ ...ev, delta: redactor.restore(now, kind === 'toolcall'), partial }] : [];
      }
      case 'text_end': {
        const partial = restoreMessage(redactor, ev.partial);
        return [...flush(partial, slot('text', ev.contentIndex)), { ...ev, content: redactor.restore(ev.content), partial }];
      }
      case 'toolcall_end': {
        const partial = restoreMessage(redactor, ev.partial);
        return [...flush(partial, slot('toolcall', ev.contentIndex)), { ...ev, toolCall: { ...ev.toolCall, arguments: redactor.restoreDeep(ev.toolCall.arguments) }, partial }];
      }
      case 'done': {
        const message = restoreMessage(redactor, ev.message);
        return [...flush(message), { ...ev, message }];
      }
      case 'error': {
        const error = restoreMessage(redactor, ev.error);
        return [...flush(error), { ...ev, error }];
      }
      default:
        return [{ ...ev, partial: restoreMessage(redactor, ev.partial) }];
    }
  };

  void (async () => {
    try {
      for await (const ev of source) {
        observe?.(ev);
        for (const e of active() ? transform(ev) : [ev]) out.push(e);
      }
    } finally {
      out.end();
    }
  })();
  return out;
}
