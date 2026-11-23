import type { AgentMessage, ContentBlock, ScriptToolResult } from '@shared/protocol';
import type { SessionManager } from '@earendil-works/pi-coding-agent';

export const SCRIPT_TOOL_ENTRY = 'pi-desktop-script-tool';

// Keep bounded UI data outside the model's context. Don't duplicate wholesale tool details
// (e.g. Bash's structured output, edit inputs, or read's redundant truncation content).
const TEXT_LIMIT = 128 * 1024;
const IMAGE_LIMIT = 4 * 1024 * 1024;

export function scriptToolResult(
  event: { toolCallId: string; toolName: string; isError?: boolean; result?: ScriptToolResult['result'] },
  parentToolCallId: string,
  args: Record<string, unknown>,
): ScriptToolResult {
  const { toolCallId, toolName, result, isError } = event;
  const displayArgs: Record<string, string | number> = {};
  for (const key of ['path', 'file_path', 'offset', 'limit', 'command', 'workdir', 'pattern', 'glob', 'query']) {
    const value = args[key];
    if (typeof value === 'string') displayArgs[key] = value.slice(0, TEXT_LIMIT);
    else if (typeof value === 'number') displayArgs[key] = value;
  }
  if (toolName === 'write' && typeof args.content === 'string' && args.content.length <= TEXT_LIMIT)
    displayArgs.content = args.content;

  const content: ContentBlock[] = [];
  let textLeft = TEXT_LIMIT;
  let imageLeft = IMAGE_LIMIT;
  if (Array.isArray(result?.content)) {
    for (const block of result.content) {
      if (block?.type === 'text' && typeof block.text === 'string' && textLeft > 0) {
        const text = block.text.slice(0, textLeft);
        content.push({ type: 'text', text });
        textLeft -= text.length + 1;
      } else if (
        toolName === 'read' &&
        block?.type === 'image' &&
        typeof block.data === 'string' &&
        block.data.length <= imageLeft
      ) {
        content.push({ type: 'image', data: block.data, mimeType: block.mimeType });
        imageLeft -= block.data.length;
      }
    }
  }

  const details: Record<string, unknown> = {};
  if (toolName === 'edit') {
    const { diff, firstChangedLine } = result?.details ?? {};
    if (typeof diff === 'string' && diff.length <= TEXT_LIMIT) details.diff = diff;
    if (typeof firstChangedLine === 'number') details.firstChangedLine = firstChangedLine;
  } else if (toolName === 'read') {
    const truncation = result?.details?.truncation as { firstLineExceedsLimit?: boolean } | undefined;
    if (truncation?.firstLineExceedsLimit) details.truncation = { firstLineExceedsLimit: true };
  } else if (Array.isArray(result?.details?.hits)) {
    // Only the hit count is rendered.
    details.hitCount = result.details.hits.length;
  }
  return {
    parentToolCallId,
    toolCallId,
    toolName,
    args: displayArgs,
    result: { content, details },
    isError: !!isError,
  };
}

/** Join records to the assistant message that launched the script, including in older history pages.
 * The journal is in completion order; use the SDK's per-parent call sequence to restore start order. */
export function withScriptTools(manager: SessionManager, messages: AgentMessage[]): AgentMessage[] {
  const byParent = new Map<string, ScriptToolResult[]>();
  for (const entry of manager.getBranch()) {
    if (entry.type !== 'custom' || entry.customType !== SCRIPT_TOOL_ENTRY) continue;
    const result = entry.data as ScriptToolResult;
    const list = byParent.get(result.parentToolCallId) ?? [];
    list.push(result);
    byParent.set(result.parentToolCallId, list);
  }
  if (!byParent.size) return messages;
  const callOrder = (row: ScriptToolResult) => Number(row.toolCallId.slice(row.parentToolCallId.length + 1));
  return messages.map((message) => {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) return message;
    const scriptTools = message.content.flatMap((block) =>
      block.type === 'toolCall' && block.id
        ? (byParent.get(block.id) ?? []).sort((a, b) => callOrder(a) - callOrder(b))
        : [],
    );
    return scriptTools.length ? { ...message, scriptTools } : message;
  });
}
