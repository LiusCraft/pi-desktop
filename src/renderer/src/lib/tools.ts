import type { SubagentProgress } from '@shared/protocol';
import type { ToolPreview } from '@shared/tool-previews';
import { fname } from './format';

export type ToolKind = 'read' | 'edit' | 'write' | 'bash' | 'grep' | 'glob' | 'ls' | 'agent' | 'other';
export type ToolStatus = 'running' | 'done' | 'err' | 'denied';

export interface ToolState {
  id: string;
  name: string;
  kind: ToolKind;
  args: Record<string, any>;
  status: ToolStatus;
  open: boolean;
  path?: string;
  cmd: string;
  q: string;
  desc: string;
  prompt?: string;
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
  /** Keeps running after its tool call returned (`run_in_background`, `bg_shell`). */
  bg?: boolean;
  /** Background shell command and its output so far. */
  sh?: { command: string; output: string; exitCode?: number | null };
}

const KIND: Record<string, ToolKind> = { read: 'read', edit: 'edit', write: 'write', bash: 'bash', powershell: 'bash', bg_shell: 'agent', grep: 'grep', find: 'glob', ls: 'ls', task: 'agent' };

/** Desktop-owned tools are named `pidesk_*`; older sessions recorded them without the prefix. */
export const bareName = (name: string) => name.replace(/^pidesk_/, '');

export function toolFromArgs(id: string, toolName: string, args: Record<string, any> = {}): ToolState {
  const name = bareName(toolName);
  return {
    id, name: toolName, kind: KIND[name] ?? 'other', args: args ?? {}, status: 'running', open: false,
    path: args?.path || args?.file_path, cmd: args?.command || '', q: args?.pattern || args?.path || '',
    desc: args?.description || (name === 'bg_shell' ? args?.command : '') || 'Subagent', prompt: args?.prompt ?? (name === 'bg_shell' ? args?.command : undefined),
    ...(name === 'bg_shell' ? { sh: { command: args?.command ?? '', output: '' } } : {}),
  };
}

/** Plain-text label, e.g. "Ran npm test" / "Reading date.js". */
export function toolLabel(t: ToolState) {
  const run = t.status === 'running';
  switch (t.kind) {
    case 'read': return `${run ? 'Reading' : 'Read'} ${fname(t.path ?? '')}`;
    case 'edit': return `${run ? 'Editing' : 'Edited'} ${fname(t.path ?? '')}`;
    case 'write': return `${run ? 'Writing' : 'Wrote'} ${fname(t.path ?? '')}`;
    case 'grep': return `Searched for ${t.q}`;
    case 'glob': return `Found ${t.q}`;
    case 'ls': return `Listed ${t.q || '.'}`;
    case 'bash': return `${run ? 'Running' : 'Ran'} ${t.cmd}`;
    case 'agent': return `Agent · ${t.desc}`;
    default: return `${run ? 'Using' : 'Used'} ${t.name}`;
  }
}

/** Scope of a read / search call shown next to its label, e.g. "L100–220" or "in src/agent · *.ts". */
export function toolScope(t: ToolState): string {
  const a = t.args;
  if (t.kind === 'read') {
    const start = Number(a.offset) || 1;
    const count = Number(a.limit);
    if (count > 0) return `L${start}–${start + count - 1}`;
    return a.offset ? `L${start}+` : '';
  }
  if (t.kind === 'grep') return [a.path && `in ${a.path}`, a.glob].filter(Boolean).join(' · ');
  if (t.kind === 'glob') return a.path ? `in ${a.path}` : '';
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
    else if (t.kind === 'grep' || t.kind === 'glob' || t.kind === 'ls') c.search++;
    else if (t.kind === 'agent') c.agent++;
    else c.other++;
  }
  const pl = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);
  const parts: string[] = [];
  if (c.cmd) parts.push(`ran ${pl(c.cmd, 'a command', 'commands')}${c.fail ? ` (${c.fail} failed)` : ''}`);
  if (c.read.size) parts.push(`read ${pl(c.read.size, 'a file', 'files')}`);
  if (c.write.size) parts.push(`wrote ${pl(c.write.size, 'a file', 'files')}`);
  if (c.edit.size) parts.push(`edited ${pl(c.edit.size, 'a file', 'files')}`);
  if (c.search) parts.push(`searched ${pl(c.search, 'once', 'times')}`);
  if (c.agent) parts.push(`used ${pl(c.agent, 'an agent', 'agents')}`);
  if (c.other) parts.push(`used ${pl(c.other, 'a tool', 'tools')}`);
  const s = parts.join(', ') || 'Used tools';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function groupStats(tools: ToolState[]) {
  return tools.reduce((a, t) => (t.add != null ? { add: a.add + t.add, del: a.del + (t.del ?? 0) } : a), { add: 0, del: 0 });
}

export const isFileTool = (t: ToolState) => (t.kind === 'read' || t.kind === 'edit' || t.kind === 'write') && !!t.path;
