// Session events as the UI receives them: like pi's JSON mode, streaming updates
// drop the accumulated `partial` message so each delta stays small.
import type { PiEvent } from '@shared/protocol';
import { todoMessage } from '@shared/todo-message';

export function toWireEvent(event: any): PiEvent | null {
  // Project committed todo snapshots immediately, without waiting for the script to finish.
  if (event.type === 'entry_appended') {
    const [message] = todoMessage(event.entry);
    return message ? { type: 'message_end', message } : null;
  }
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
