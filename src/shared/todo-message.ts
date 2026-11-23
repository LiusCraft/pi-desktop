import type { AgentMessage } from './protocol';

export const TODO_TOOL = 'pidesk_todo_write';
export const TODO_ENTRY_TYPE = 'pi-desktop-todos';
export const TODO_STATUSES = ['pending', 'in_progress', 'completed'] as const;

export interface Todo {
  content: string;
  status: (typeof TODO_STATUSES)[number];
  activeForm?: string;
}

/** Project a desktop-only session entry without adding a message to the model's context. */
export function todoMessage(entry: { type: string; customType?: string; data?: unknown }): AgentMessage[] {
  if (entry.type !== 'custom' || entry.customType !== TODO_ENTRY_TYPE || !Array.isArray(entry.data)) return [];
  return [{ role: 'custom', customType: TODO_ENTRY_TYPE, details: { todos: entry.data } }];
}
