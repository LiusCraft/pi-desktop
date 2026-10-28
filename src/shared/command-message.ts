// A turn started by one of Pi Desktop's own buttons (Commit, Create PR, Fix CI, ...). The model
// gets the full instruction as an ordinary user message in this wrapper; the transcript shows
// it as a command chip (`/commit`) and keeps the instruction behind a click, like a skill.

import type { MessageKey } from './i18n';

export type BuiltinCommand = 'commit' | 'push' | 'create-pr' | 'update-pr' | 'new-pr' | 'fix-conflicts' | 'fix-ci' | 'sync-base';

/** What each command is for, shown beside the instruction it expands to. */
export const BUILTIN_COMMAND_INFO: Record<BuiltinCommand, MessageKey> = {
  commit: 'cmdinfo.commit',
  push: 'cmdinfo.push',
  'create-pr': 'cmdinfo.create-pr',
  'update-pr': 'cmdinfo.update-pr',
  'new-pr': 'cmdinfo.new-pr',
  'fix-conflicts': 'cmdinfo.fix-conflicts',
  'fix-ci': 'cmdinfo.fix-ci',
  'sync-base': 'cmdinfo.sync-base',
};

export interface CommandMessage {
  name: string;
  /** The instruction the agent received. */
  prompt: string;
  /** A prompt template the user wrote, typed as `/name args`; false for one of Pi Desktop's own buttons. */
  user: boolean;
  /** What was typed after `/name` (user commands only). */
  args: string;
}

export const encodeCommandMessage = (name: BuiltinCommand, prompt: string) => `<pi-command name="${name}">\n${prompt}\n</pi-command>`;

/** A prompt template the user typed as `/name args`, already expanded: it shows as a chip like the built-in ones. */
export const encodeUserCommandMessage = (name: string, args: string, prompt: string) => `<pi-command name="${name}" source="user" args=${JSON.stringify(args)}>\n${prompt}\n</pi-command>`;

export function decodeCommandMessage(wire: string): CommandMessage | null {
  const m = /^<pi-command name="([^"\s]+)"(?: source="(user)" args=("(?:[^"\\]|\\.)*"))?>\n([\s\S]*)\n<\/pi-command>$/.exec(wire.trim());
  if (!m) return null;
  if (m[2]) {
    let args = '';
    try { args = JSON.parse(m[3]); } catch { /* keep empty */ }
    return { name: m[1], prompt: m[4], user: true, args };
  }
  if (!(m[1] in BUILTIN_COMMAND_INFO)) return null;
  return { name: m[1] as BuiltinCommand, prompt: m[4], user: false, args: '' };
}

/** Prefix that tells a built-in command apart from a user's command or skill of the same name. */
export const BUILTIN_COMMAND_PREFIX = 'pi:';

/** The name to show: bare, unless the user already has a command called that. */
export const commandLabel = (name: BuiltinCommand, userCommands: Iterable<string>) =>
  new Set(userCommands).has(name) ? `${BUILTIN_COMMAND_PREFIX}${name}` : name;

export const isCommandMessage = (wire: string) => wire.startsWith('<pi-command ');
