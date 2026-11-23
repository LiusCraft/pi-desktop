/** A script's ordinary operations can use the same rows as direct calls. Interactive
 * tools keep their own lifecycle, and script-only operations stay in the script trace. */
export const CODEMODE_TOOL = 'codemode';

const ROW_TOOLS = new Set(['read', 'edit', 'write', 'bash', 'powershell', 'grep', 'find', 'ls', 'web_search']);

export const hasScriptToolRow = (name: string) => ROW_TOOLS.has(name.replace(/^pidesk_/, ''));
