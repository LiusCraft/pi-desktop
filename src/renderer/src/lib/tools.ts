import type { SubagentProgress } from '@shared/protocol';
import type { ToolPreview } from '@shared/tool-previews';
import { fname } from './format';
import { t } from './i18n';

export type ToolKind = 'read' | 'edit' | 'write' | 'bash' | 'grep' | 'glob' | 'ls' | 'agent' | 'websearch' | 'other';
export type ToolStatus = 'running' | 'done' | 'err' | 'denied';

/** The tool that runs a JavaScript script calling other tools. */
export const CODEMODE_TOOL = 'codemode';

/** One tool a codemode script called, from the tool result's `details.calls`. */
export interface NestedToolCall {
  name: string;
  /** Compact JSON of the arguments, already shortened by the host. */
  args: string;
  status: 'running' | 'ok' | 'error' | 'cancelled';
  durationMs?: number;
  error?: string;
  /** Cost in USD of a `models.*` call that reported usage. */
  cost?: number;
}

const CALL_STATUSES: ReadonlySet<string> = new Set<NestedToolCall['status']>(['running', 'ok', 'error', 'cancelled']);

/** `details.calls` of a codemode result; anything malformed is dropped rather than shown. */
export function nestedCalls(raw: unknown): NestedToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((call): NestedToolCall[] => {
    if (!call || typeof call !== 'object') return [];
    const c = call as Record<string, unknown>;
    if (typeof c.name !== 'string') return [];
    return [{
      name: c.name,
      args: typeof c.args === 'string' ? c.args : '',
      status: CALL_STATUSES.has(c.status as string) ? (c.status as NestedToolCall['status']) : 'ok',
      ...(typeof c.durationMs === 'number' ? { durationMs: c.durationMs } : {}),
      ...(typeof c.error === 'string' && c.error ? { error: c.error } : {}),
      ...(typeof c.cost === 'number' && c.cost ? { cost: c.cost } : {}),
    }];
  });
}

export interface ToolState {
  id: string;
  name: string;
  kind: ToolKind;
  args: Record<string, any>;
  status: ToolStatus;
  open: boolean;
  path?: string;
  cmd: string;
  /** Folder a shell command was told to run in (`workdir`), when it is not the session folder. */
  dir?: string;
  q: string;
  desc: string;
  prompt?: string;
  /** Number of hits a web search returned. */
  count?: number;
  /** Read / edit / write result normalised for display. */
  preview?: ToolPreview;
  /** Text output for bash and generic tools. */
  output?: string;
  add?: number;
  del?: number;
  firstChangedLine?: number;
  /** Subagent report and progress. */
  md?: string;
  summary?: string;
  /** Subagent transcript, tokens and current activity (Background tasks panel). */
  sub?: SubagentProgress;
  /** Tools a codemode script called, as its result reports them. */
  calls?: NestedToolCall[];
  /** Keeps running after its tool call returned (`run_in_background`, `bg_shell`). */
  bg?: boolean;
  /** Background shell command and its output so far. */
  sh?: { command: string; output: string; exitCode?: number | null };
}

const KIND: Record<string, ToolKind> = { read: 'read', edit: 'edit', write: 'write', bash: 'bash', powershell: 'bash', bg_shell: 'agent', grep: 'grep', find: 'glob', ls: 'ls', task: 'agent', web_search: 'websearch' };

/** Desktop-owned tools are named `pidesk_*`; older sessions recorded them without the prefix. */
export const bareName = (name: string) => name.replace(/^pidesk_/, '');

export function toolFromArgs(id: string, toolName: string, args: Record<string, any> = {}): ToolState {
  const name = bareName(toolName);
  return {
    id, name: toolName, kind: KIND[name] ?? 'other', args: args ?? {}, status: 'running', open: false,
    path: args?.path || args?.file_path, cmd: args?.command || '', q: args?.pattern || args?.path || args?.query || '',
    ...(args?.workdir ? { dir: String(args.workdir) } : {}),
    desc: args?.description || (name === 'bg_shell' ? args?.command : '') || t('toolLabel.subagent'), prompt: args?.prompt ?? (name === 'bg_shell' ? args?.command : undefined),
    ...(name === 'bg_shell' ? { sh: { command: args?.command ?? '', output: '' } } : {}),
  };
}

/** Plain-text label, e.g. "Ran npm test" / "Reading date.js". */
export function toolLabel(tool: ToolState) {
  const run = tool.status === 'running';
  switch (tool.kind) {
    case 'read': return t(run ? 'toolLabel.reading' : 'toolLabel.read', { name: fname(tool.path ?? '') });
    case 'edit': return t(run ? 'toolLabel.editing' : 'toolLabel.edited', { name: fname(tool.path ?? '') });
    case 'write': return t(run ? 'toolLabel.writing' : 'toolLabel.wrote', { name: fname(tool.path ?? '') });
    case 'grep': return t('toolLabel.searched', { q: tool.q });
    case 'glob': return t('toolLabel.found', { q: tool.q });
    case 'ls': return t('toolLabel.listed', { q: tool.q || '.' });
    case 'bash': return t(run ? 'toolLabel.running' : 'toolLabel.ran', { cmd: tool.cmd });
    case 'agent': return t('toolLabel.agent', { desc: tool.desc });
    case 'websearch': return t(run ? 'toolLabel.webSearching' : 'toolLabel.webSearched', { q: tool.q });
    default: return t(run ? 'toolLabel.using' : 'toolLabel.used', { name: tool.name });
  }
}

/** Scope of a read / search call shown next to its label, e.g. "L100–220" or "in src/agent · *.ts". */
export function toolScope(tool: ToolState): string {
  const a = tool.args;
  if (tool.kind === 'read') {
    const start = Number(a.offset) || 1;
    const count = Number(a.limit);
    if (count > 0) return `L${start}–${start + count - 1}`;
    return a.offset ? `L${start}+` : '';
  }
  if (tool.kind === 'grep') return [a.path && t('toolScope.in', { path: a.path }), a.glob].filter(Boolean).join(' · ');
  if (tool.kind === 'glob') return a.path ? t('toolScope.in', { path: a.path }) : '';
  return '';
}

/** "Ran 2 commands, read 3 files, edited a file". */
export function groupSummary(tools: ToolState[]) {
  const c = { cmd: 0, fail: 0, read: new Set<string>(), edit: new Set<string>(), write: new Set<string>(), search: 0, agent: 0, other: 0 };
  for (const t of tools) {
    if (t.kind === 'bash') { c.cmd++; if (t.status === 'err') c.fail++; }
    else if (t.kind === 'read') c.read.add(t.path ?? '');
    else if (t.kind === 'edit') c.edit.add(t.path ?? '');
    else if (t.kind === 'write') c.write.add(t.path ?? '');
    else if (t.kind === 'grep' || t.kind === 'glob' || t.kind === 'ls' || t.kind === 'websearch') c.search++;
    else if (t.kind === 'agent') c.agent++;
    else c.other++;
  }
  const parts: string[] = [];
  if (c.cmd) parts.push((c.cmd === 1 ? t('group.ranCommand') : t('group.ranCommands', { n: c.cmd })) + (c.fail ? t('group.failed', { n: c.fail }) : ''));
  if (c.read.size) parts.push(c.read.size === 1 ? t('group.readFile') : t('group.readFiles', { n: c.read.size }));
  if (c.write.size) parts.push(c.write.size === 1 ? t('group.wroteFile') : t('group.wroteFiles', { n: c.write.size }));
  if (c.edit.size) parts.push(c.edit.size === 1 ? t('group.editedFile') : t('group.editedFiles', { n: c.edit.size }));
  if (c.search) parts.push(c.search === 1 ? t('group.searchedOnce') : t('group.searchedTimes', { n: c.search }));
  if (c.agent) parts.push(c.agent === 1 ? t('group.usedAgent') : t('group.usedAgents', { n: c.agent }));
  if (c.other) parts.push(c.other === 1 ? t('group.usedTool') : t('group.usedTools', { n: c.other }));
  const s = parts.join(t('group.separator')) || t('group.usedToolsFallback');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function groupStats(tools: ToolState[]) {
  return tools.reduce((a, t) => (t.add != null ? { add: a.add + t.add, del: a.del + (t.del ?? 0) } : a), { add: 0, del: 0 });
}

export const isFileTool = (t: ToolState) => (t.kind === 'read' || t.kind === 'edit' || t.kind === 'write') && !!t.path;
