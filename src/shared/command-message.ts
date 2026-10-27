// A turn started by one of Pi Desktop's own buttons (Commit, Create PR, Fix CI, ...). The model
// gets the full instruction as an ordinary user message in this wrapper; the transcript shows
// it as a command chip (`/commit`) and keeps the instruction behind a click, like a skill.

export type BuiltinCommand = 'commit' | 'push' | 'create-pr' | 'update-pr' | 'new-pr' | 'fix-conflicts' | 'fix-ci';

/** What each command is for, shown beside the instruction it expands to. */
export const BUILTIN_COMMAND_INFO: Record<BuiltinCommand, string> = {
  commit: '提交当前所有改动',
  push: '推送当前分支',
  'create-pr': '提交、推送并创建 PR',
  'update-pr': '推送并更新已有的 PR',
  'new-pr': '为已结束的 PR 重新提一个',
  'fix-conflicts': '合并目标分支并解决冲突',
  'fix-ci': '修复失败的检查与评审意见',
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
