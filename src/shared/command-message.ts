// A turn started by one of Pi Desktop's own buttons (Commit, Create PR, Fix CI, ...). The model
// gets the full instruction as an ordinary user message in this wrapper; the transcript shows
// it as a command chip (`/commit`) and keeps the instruction behind a click, like a skill.

import type { MessageKey } from './i18n';

export type BuiltinCommand = 'commit' | 'push' | 'create-pr' | 'update-pr' | 'new-pr' | 'fix-conflicts' | 'fix-ci';

/** What each command is for, shown beside the instruction it expands to. */
export const BUILTIN_COMMAND_INFO: Record<BuiltinCommand, MessageKey> = {
  commit: 'cmdinfo.commit',
  push: 'cmdinfo.push',
  'create-pr': 'cmdinfo.create-pr',
  'update-pr': 'cmdinfo.update-pr',
  'new-pr': 'cmdinfo.new-pr',
  'fix-conflicts': 'cmdinfo.fix-conflicts',
  'fix-ci': 'cmdinfo.fix-ci',
};

export interface CommandMessage {
  name: BuiltinCommand;
  /** The instruction the agent received. */
  prompt: string;
}

export const encodeCommandMessage = (name: BuiltinCommand, prompt: string) => `<pi-command name="${name}">\n${prompt}\n</pi-command>`;

export function decodeCommandMessage(wire: string): CommandMessage | null {
  const m = /^<pi-command name="([a-z-]+)">\n([\s\S]*)\n<\/pi-command>$/.exec(wire.trim());
  if (!m || !(m[1] in BUILTIN_COMMAND_INFO)) return null;
  return { name: m[1] as BuiltinCommand, prompt: m[2] };
}

/** Prefix that tells a built-in command apart from a user's command or skill of the same name. */
export const BUILTIN_COMMAND_PREFIX = 'pi:';

/** The name to show: bare, unless the user already has a command called that. */
export const commandLabel = (name: BuiltinCommand, userCommands: Iterable<string>) =>
  new Set(userCommands).has(name) ? `${BUILTIN_COMMAND_PREFIX}${name}` : name;

export const isCommandMessage = (wire: string) => wire.startsWith('<pi-command ');
