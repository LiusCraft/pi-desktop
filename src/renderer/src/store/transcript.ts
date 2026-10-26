// pi session events → transcript items. Pure functions over an immer draft of a
// SessionView; anything that needs IPC or global UI is returned as an Effect.
import { decodeUserContent } from '@shared/attachments';
import type { AgentMessage, PiEvent, PrSummary, SessionMeta, TaskUpdate, UiRequest } from '@shared/protocol';
import * as previews from '@shared/tool-previews';
import { fmtDur, fmtTok, relPath } from '@/lib/format';
import { bareName, toolFromArgs, toolLabel, type ToolState } from '@/lib/tools';
import type { ViewMode } from '@/lib/constants';
import type { Item, ItemOf, SessionView, ThinkStep, Todo } from './types';

export interface Effects {
  scheduleChanges?: boolean;
  refreshStats?: boolean;
  pollPr?: number;
  prCreated?: PrSummary;
  settled?: { aborted: boolean };
  waiting?: boolean;
  toast?: string;
  editorText?: string;
}

let seq = 0;
export const newKey = () => `i${++seq}`;

export function emptySession(meta: SessionMeta): SessionView {
  return {
    meta, items: [], loaded: false, running: false, t0: 0, tokens: 0, statusText: '', ctxPct: null,
    model: meta.model ?? null, thinking: meta.thinking ?? null, levels: [], commands: [], waiting: null, unread: false,
    todosKey: null, lastTodos: [], outputs: [], term: [], changes: [], gitState: null, pr: meta.pr, prHidden: false, files: null,
    panels: { diff: false, preview: false, files: false, terminal: false, progress: true, tasks: false }, detail: null, previewUrl: null,
    pendingUser: [], stopping: false, historyBusy: false, hostEpoch: 0, cur: null,
  };
}

const textOf = (c: unknown) =>
  typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x?.type === 'text').map((x) => x.text).join('') : '';

export const find = <K extends Item['kind']>(s: SessionView, kind: K, pred: (item: ItemOf<K>) => boolean) =>
  s.items.find((i): i is ItemOf<K> => i.kind === kind && pred(i as ItemOf<K>));
export const findByKey = (s: SessionView, key: string | null | undefined) => (key ? s.items.find((i) => i.key === key) : undefined);

/** The group and tool for a tool call id, newest first. */
export function findTool(s: SessionView, id: string) {
  for (let i = s.items.length - 1; i >= 0; i--) {
    const g = s.items[i];
    if (g.kind !== 'group') continue;
    const tool = g.tools.find((t) => t.id === id);
    if (tool) return { group: g, tool };
  }
  return null;
}

const verbose = (v: ViewMode) => v === 'verbose';

/** Append an item; a finished, untouched tool group folds itself away first (except in Verbose). */
export function push<T extends Item>(s: SessionView, item: T, view: ViewMode): T {
  const last = s.items.at(-1);
  if (!verbose(view) && item.kind !== 'group' && item.kind !== 'perm' && last?.kind === 'group' && last.open && !last.userToggled && !last.tools.some((t) => t.status === 'running')) {
    last.open = false;
  }
  s.items.push(item);
  return s.items.at(-1) as T;
}

function currentGroup(s: SessionView, view: ViewMode) {
  const last = s.items.at(-1);
  if (last?.kind === 'group') return last;
  return push<ItemOf<'group'>>(s, { kind: 'group', key: newKey(), thoughts: [], tools: [], open: verbose(view) }, view);
}

function finishThought(step: ThinkStep, view: ViewMode) {
  step.done = true;
  step.secs = Math.max(1, Math.round((Date.now() - step.t0) / 1000));
  if (!step.userToggled) step.open = verbose(view);
}

// ------------------------------------------------------------ tools

export function toolStart(s: SessionView, ev: { toolCallId: string; toolName: string; args?: any }, view: ViewMode, replay = false) {
  if (bareName(ev.toolName) === 'todo_write') return;
  if (bareName(ev.toolName) === 'exit_plan_mode') {
    push(s, { kind: 'plan', key: newKey(), title: ev.args?.title || 'Plan', md: ev.args?.plan || '', toolCallId: ev.toolCallId, requestId: null, resolved: replay ? 'done' : null }, view);
    return;
  }
  const g = currentGroup(s, view);
  const tool = toolFromArgs(ev.toolCallId, ev.toolName, ev.args);
  if (tool.kind === 'agent' && !replay) tool.sub = { startedAt: Date.now(), tokens: 0, toolUses: 0, activity: 'Starting', steps: [] };
  g.tools.push(tool);
  if (!replay) s.statusText = `${toolLabel(tool)}…`;
}

export function toolEnd(
  s: SessionView,
  ev: { toolCallId: string; toolName: string; result?: { content?: unknown; details?: any }; isError?: boolean },
  view: ViewMode,
  replay = false,
): Effects {
  const fx: Effects = {};
  const text = textOf(ev.result?.content);
  if (bareName(ev.toolName) === 'todo_write') {
    const items = ev.result?.details?.todos as Todo[] | undefined;
    if (!items) return fx;
    const current = findByKey(s, s.todosKey);
    if (current?.kind === 'todos') current.items = items;
    else s.todosKey = push(s, { kind: 'todos', key: newKey(), items }, view).key;
    s.lastTodos = items;
    return fx;
  }
  const plan = find(s, 'plan', (p) => p.toolCallId === ev.toolCallId);
  if (plan) {
    const st = ev.result?.details?.status;
    plan.resolved = st === 'approved' ? 'approved' : st === 'keep' ? 'Keep planning' : plan.resolved || 'done';
    return fx;
  }
  const found = findTool(s, ev.toolCallId);
  if (!found) return fx;
  const t = found.tool;
  const blocked = !!ev.isError && /denied|Plan mode|blocked|not approved|no UI|nobody answered/i.test(text);
  t.status = blocked ? 'denied' : ev.isError ? 'err' : 'done';
  if (t.kind === 'read' || t.kind === 'edit' || t.kind === 'write') {
    const preview = previews[t.kind](t.args, ev.result ?? {}, !!ev.isError);
    t.preview = preview;
    if ('firstChangedLine' in preview) t.firstChangedLine = preview.firstChangedLine;
    if (preview.type === 'diff') { t.add = preview.add; t.del = preview.del; }
  }
  if (t.kind === 'bash') t.output = text;
  else if (t.kind === 'edit' || t.kind === 'write') {
    if (!ev.isError && t.path) {
      const rel = relPath(s.meta.cwd, t.path);
      const prev = s.outputs.find((o) => o.path === rel);
      if (prev) prev.t = Date.now();
      else s.outputs.push({ path: rel, kind: t.kind, t: Date.now() });
    }
    if (!replay) fx.scheduleChanges = true;
  } else if (t.kind === 'agent' && ev.result?.details?.background) {
    // The call only started the task; its real end arrives as a `task` event.
    t.bg = true;
    t.summary = '';
    if (replay) t.sub = undefined;
    else if (!blocked && !ev.isError) t.status = 'running';
  } else if (t.kind === 'agent') {
    t.md = ev.result?.details?.text || text;
    t.summary = ev.result?.details?.summary || '';
    if (ev.result?.details?.progress) t.sub = ev.result.details.progress;
    else if (t.sub && !t.sub.endedAt) t.sub = { ...t.sub, endedAt: Date.now(), activity: ev.isError ? 'Stopped' : 'Done' };
  } else if (t.kind !== 'read') t.output = text.slice(0, 8000);

  if (t.kind === 'bash' && !replay) {
    s.term.push({ cmd: t.cmd, out: text });
    if (!ev.isError && /\bgh\s+pr\s+(?:create|merge|close|reopen|ready|edit)\b/i.test(t.cmd)) {
      // gh can take a moment to expose a just-created PR through `pr view`.
      const created = /\bgh\s+pr\s+create\b/i.test(t.cmd) && text.match(/https?:\/\/[^\s<>"'`]+\/pull\/(\d+)/i);
      if (created) {
        const pr = { num: Number(created[1]), url: created[0], state: 'open', draft: /(?:^|\s)--draft\b/.test(t.cmd) };
        s.pr = { ...pr, ci: 'none', checks: [], comments: 0 };
        s.meta.pr = pr;
        fx.prCreated = pr;
      }
      fx.pollPr = 3;
    }
  }
  return fx;
}

/** A background subagent or shell command moved on after its tool call returned. */
export function applyTaskUpdate(s: SessionView, u: TaskUpdate) {
  const t = findTool(s, u.toolCallId)?.tool;
  if (!t) return;
  t.bg = true;
  t.sub = u.progress;
  t.summary = u.summary;
  if (u.shell) t.sh = { command: t.sh?.command ?? t.cmd, ...u.shell };
  if (u.state === 'running') {
    t.status = 'running';
    return;
  }
  t.status = u.state === 'done' ? 'done' : u.state === 'stopped' ? 'denied' : 'err';
  if (u.text !== undefined) t.md = u.text;
}

// ------------------------------------------------------------ streaming

function assistantDelta(s: SessionView, ame: any, view: ViewMode) {
  const c = (s.cur ??= { thinkGroup: null, thinkIndex: -1, text: null });
  const thought = () => {
    const g = findByKey(s, c.thinkGroup);
    return g?.kind === 'group' ? g.thoughts[c.thinkIndex] : undefined;
  };
  const addThought = () => {
    const g = currentGroup(s, view);
    g.thoughts.push({ text: '', done: false, t0: Date.now(), open: true });
    c.thinkGroup = g.key;
    c.thinkIndex = g.thoughts.length - 1;
  };
  const liveText = () => {
    const t = findByKey(s, c.text);
    return t?.kind === 'text' ? t : undefined;
  };
  switch (ame.type) {
    case 'thinking_start':
      addThought();
      s.statusText = 'Thinking…';
      break;
    case 'thinking_delta':
      if (!thought()) addThought();
      thought()!.text += ame.delta;
      break;
    case 'thinking_end': {
      const step = thought();
      if (step) {
        step.text = ame.content ?? step.text;
        finishThought(step, view);
      }
      break;
    }
    case 'text_start':
      c.text = push(s, { kind: 'text', key: newKey(), text: '', live: true }, view).key;
      s.statusText = 'Responding…';
      break;
    case 'text_delta': {
      if (!liveText()) c.text = push(s, { kind: 'text', key: newKey(), text: '', live: true }, view).key;
      liveText()!.text += ame.delta;
      s.tokens += Math.ceil(String(ame.delta).length / 3);
      break;
    }
    case 'text_end': {
      const t = liveText();
      if (t) {
        t.text = ame.content ?? t.text;
        t.live = false;
        c.text = null;
      }
      break;
    }
    case 'toolcall_start':
      s.statusText = `Preparing ${ame.toolName || 'tool'}…`;
      break;
  }
}

function userFromMessage(s: SessionView, m: AgentMessage, view: ViewMode) {
  const user = decodeUserContent(m.content);
  if (user.text.startsWith('[pi-desktop]')) return;
  const pending = s.pendingUser
    .map((key) => findByKey(s, key))
    .filter((i): i is ItemOf<'user'> => i?.kind === 'user');
  const match = user.clientId
    ? pending.find((p) => p.clientId === user.clientId)
    : pending.find((p) => !p.attachments.length && p.text === user.text);
  if (match) {
    s.pendingUser = s.pendingUser.filter((k) => k !== match.key);
    Object.assign(match, user, { entryId: m.entryId, timestamp: m.timestamp, queued: false, delivered: true, failed: false });
  } else if (!user.clientId || !s.items.some((i) => i.kind === 'user' && i.clientId === user.clientId)) {
    push(s, { kind: 'user', key: newKey(), ...user, entryId: m.entryId, timestamp: m.timestamp, delivered: true }, view);
  }
}

export function applyPiEvent(s: SessionView, ev: PiEvent, view: ViewMode): Effects {
  switch (ev.type) {
    case 'agent_start':
      if (!s.running) {
        s.running = true;
        s.t0 = Date.now();
        s.tokens = 0;
      }
      s.todosKey = null;
      s.statusText = 'Thinking…';
      return {};
    case 'message_start':
      if (ev.message?.role === 'assistant') s.cur = { thinkGroup: null, thinkIndex: -1, text: null };
      return {};
    case 'message_update':
      if (ev.assistantMessageEvent) assistantDelta(s, ev.assistantMessageEvent, view);
      return {};
    case 'message_end': {
      const m = (ev.message ?? {}) as AgentMessage;
      if (m.role === 'user') userFromMessage(s, m, view);
      else if (m.role === 'assistant') {
        const c = s.cur;
        // message_end is authoritative: reconcile streamed text/thinking with the final content.
        const finalText = (Array.isArray(m.content) ? m.content : []).filter((b) => b.type === 'text').map((b) => b.text).join('');
        const live = findByKey(s, c?.text);
        if (live?.kind === 'text') {
          live.text = finalText || live.text;
          live.live = false;
        } else if (finalText && !s.items.some((i) => i.kind === 'text' && i.msgTs === m.timestamp)) {
          const last = s.items.at(-1);
          if (!(last?.kind === 'text' && last.text === finalText)) push(s, { kind: 'text', key: newKey(), text: finalText, live: false, msgTs: m.timestamp }, view);
        }
        const g = findByKey(s, c?.thinkGroup);
        const step = g?.kind === 'group' ? g.thoughts[c!.thinkIndex] : undefined;
        if (step && !step.done) finishThought(step, view);
        if (m.usage?.output) s.tokens += Number(m.usage.output) || 0;
        if (m.stopReason === 'error' && m.errorMessage) push(s, { kind: 'note', key: newKey(), level: 'error', text: `Error: ${m.errorMessage}` }, view);
        if (m.stopReason === 'aborted') push(s, { kind: 'note', key: newKey(), text: 'Interrupted · 告诉 Claude 接下来该怎么做' }, view);
        s.cur = null;
      } else if (m.role === 'custom' && m.display) push(s, { kind: 'note', key: newKey(), text: textOf(m.content) }, view);
      return {};
    }
    case 'tool_execution_start':
      if (!ev.parentToolCallId) toolStart(s, ev as any, view);
      return {};
    case 'tool_execution_update':
      if (bareName(ev.toolName) === 'task') {
        const found = findTool(s, ev.toolCallId);
        if (found) {
          found.tool.summary = textOf(ev.partialResult?.content);
          if (ev.partialResult?.details?.progress) found.tool.sub = ev.partialResult.details.progress;
        }
      }
      return {};
    case 'tool_execution_end':
      return ev.parentToolCallId ? {} : toolEnd(s, ev as any, view);
    case 'auto_retry_start':
      push(s, { kind: 'note', key: newKey(), text: `Retrying (${ev.attempt}/${ev.maxAttempts}) — ${ev.errorMessage || ''}` }, view);
      return {};
    case 'compaction_start':
      s.statusText = 'Compacting context…';
      return {};
    case 'compaction_end':
      if (!ev.aborted) push(s, { kind: 'note', key: newKey(), text: ev.errorMessage ? `Compaction failed: ${ev.errorMessage}` : 'Context compacted' }, view);
      return { refreshStats: true };
    case 'thinking_level_changed':
      s.thinking = ev.level;
      return {};
    case 'agent_settled':
      return settle(s, !!ev.aborted, view);
    default:
      return {};
  }
}

/** The run is over (or the host died): close everything that was still live. */
export function settle(s: SessionView, aborted: boolean, view: ViewMode): Effects {
  if (!s.running) return {};
  s.running = false;
  s.cur = null;
  for (const item of s.items) {
    if (item.kind === 'text' && item.live) item.live = false;
    if (item.kind === 'group') {
      for (const step of item.thoughts) if (!step.done) finishThought(step, view);
      for (const t of item.tools) {
        if (t.bg) continue; // background tasks outlive the turn
        if (t.status === 'running') t.status = 'denied';
        if (t.sub && !t.sub.endedAt) t.sub = { ...t.sub, endedAt: Date.now(), activity: 'Stopped' };
      }
    }
  }
  // Only authoritative user events or clear_queue confirm consumption/cancellation.
  for (const key of s.pendingUser) {
    const p = findByKey(s, key);
    if (p?.kind === 'user' && !p.queued && !p.delivered) p.failed = true;
  }
  push(s, { kind: 'foot', key: newKey(), t: Date.now(), usage: `${fmtDur(Date.now() - s.t0)} · ${fmtTok(s.tokens)} tokens` }, view);
  s.meta.updatedAt = Date.now();
  return { settled: { aborted }, refreshStats: true, scheduleChanges: true, pollPr: 0 };
}

// ------------------------------------------------------------ questions

export function permissionTitle(tool: ToolState | undefined, raw: string) {
  if (!tool) return raw;
  if (tool.kind === 'bash') return 'Allow Claude to run this command?';
  if (tool.kind === 'edit') return `Allow Claude to edit ${tool.path}?`;
  if (tool.kind === 'write') return `Allow Claude to write ${tool.path}?`;
  return `Allow Claude to use ${tool.name}?`;
}

export function addUiRequest(s: SessionView, req: UiRequest, view: ViewMode): { openPlan?: string } {
  if (s.items.some((i) => 'requestId' in i && i.requestId === req.id)) return {};
  if (req.kind === 'permission') {
    s.waiting = push(s, { kind: 'perm', key: newKey(), requestId: req.id, toolCallId: req.toolCallId, title: req.title, resolved: null }, view).key;
    return {};
  }
  if (req.kind === 'plan') {
    let plan = find(s, 'plan', (p) => p.toolCallId === req.toolCallId);
    if (!plan) plan = push(s, { kind: 'plan', key: newKey(), toolCallId: req.toolCallId, title: req.title, md: '', requestId: null, resolved: null }, view);
    plan.requestId = req.id;
    s.waiting = plan.key;
    return { openPlan: plan.key };
  }
  s.waiting = push(s, { kind: 'ask', key: newKey(), requestId: req.id, request: req, resolved: null }, view).key;
  return {};
}

export function resolveUi(s: SessionView, requestId: string, label: string) {
  const item = s.items.find((i) => 'requestId' in i && i.requestId === requestId) as ItemOf<'perm' | 'ask' | 'plan'> | undefined;
  if (!item) return;
  item.resolved = item.resolved && item.kind === 'plan' ? item.resolved : label;
  item.requestId = null;
  if (s.waiting === item.key) s.waiting = null;
}

// ------------------------------------------------------------ history

/** Rebuild the transcript from pi's message list (session resume). */
export function replay(s: SessionView, messages: AgentMessage[], view: ViewMode) {
  s.items = [];
  s.todosKey = null;
  s.lastTodos = [];
  s.outputs = [];
  s.term = [];
  s.cur = null;
  s.waiting = null;
  s.detail = null;
  s.pendingUser = [];
  let sawAssistant = false;
  for (const m of messages) {
    if (m.role === 'user') {
      const user = decodeUserContent(m.content);
      if (user.text.startsWith('[pi-desktop]')) continue;
      if (sawAssistant) s.items.push({ kind: 'foot', key: newKey(), t: m.timestamp || Date.now() });
      sawAssistant = false;
      s.todosKey = null;
      s.items.push({ kind: 'user', key: newKey(), ...user, entryId: m.entryId, timestamp: m.timestamp, delivered: true });
    } else if (m.role === 'assistant') {
      sawAssistant = true;
      for (const b of Array.isArray(m.content) ? m.content : []) {
        if (b.type === 'thinking' && b.thinking) {
          let g = s.items.at(-1);
          if (g?.kind !== 'group') {
            g = { kind: 'group', key: newKey(), thoughts: [], tools: [], open: verbose(view) };
            s.items.push(g);
          }
          g.thoughts.push({ text: b.thinking, done: true, t0: 0, open: verbose(view) });
        } else if (b.type === 'text' && b.text) s.items.push({ kind: 'text', key: newKey(), text: b.text, live: false });
        else if (b.type === 'toolCall') toolStart(s, { toolCallId: b.id!, toolName: b.name!, args: b.arguments }, view, true);
      }
      if (m.stopReason === 'error' && m.errorMessage) s.items.push({ kind: 'note', key: newKey(), level: 'error', text: `Error: ${m.errorMessage}` });
    } else if (m.role === 'toolResult') {
      toolEnd(s, { toolCallId: m.toolCallId!, toolName: m.toolName!, result: { content: m.content, details: m.details }, isError: m.isError }, view, true);
    } else if (m.role === 'custom' && m.display) {
      s.items.push({ kind: 'note', key: newKey(), text: textOf(m.content) });
    }
  }
  if (sawAssistant) s.items.push({ kind: 'foot', key: newKey(), t: s.meta.updatedAt });
  for (const i of s.items) if (i.kind === 'group') i.open = verbose(view);
}

/** Re-fold groups and thoughts for a new transcript view, keeping what the user toggled. */
export function applyViewMode(s: SessionView, view: ViewMode) {
  for (const i of s.items) {
    if (i.kind !== 'group') continue;
    if (!i.userToggled) i.open = verbose(view);
    for (const step of i.thoughts) if (!step.userToggled) step.open = verbose(view);
  }
}

export const hasThinking = (s: SessionView | undefined) => !!s?.items.some((i) => i.kind === 'group' && i.thoughts.length > 0);
