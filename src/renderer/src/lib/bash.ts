/**
 * `!command` in the composer runs a command in the shell the session's own `bash` tool uses, like pi's
 * own bash mode: the result joins the conversation. `!!command` keeps it out of the model's context.
 */
export interface ShellCommand {
  command: string;
  excludeFromContext: boolean;
}

/** What the message asks to run, or null when it is an ordinary message. */
export function bashCommand(text: string): ShellCommand | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('!')) return null;
  const excludeFromContext = trimmed.startsWith('!!');
  // Only the space after the prefix goes: the command's own lines are kept exactly as typed.
  const command = trimmed.slice(excludeFromContext ? 2 : 1).replace(/^[ \t]+/, '');
  return { command: command.trimEnd(), excludeFromContext };
}
