// Session events as the UI receives them: like pi's JSON mode, streaming updates
// drop the accumulated `partial` message so each delta stays small.
import type { PiEvent } from '@shared/protocol';

export function toWireEvent(event: any): PiEvent | null {
  // Entries are persistence bookkeeping; the UI rebuilds from messages instead.
  if (event.type === 'entry_appended') return null;
  if (event.type !== 'message_update') return event;
  const ame = event.assistantMessageEvent;
  let delta = ame;
  if (ame.type === 'toolcall_start') {
    const toolCall = ame.partial?.content?.[ame.contentIndex];
    const { partial: _partial, ...rest } = ame;
    delta = { ...rest, id: toolCall?.id, toolName: toolCall?.name };
  } else if ('partial' in ame) {
    const { partial: _partial, ...rest } = ame;
    delta = rest;
  }
  return { type: 'message_update', usage: event.message?.usage, assistantMessageEvent: delta };
}
