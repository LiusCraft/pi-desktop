// pi session events → transcript items. Pure functions over an immer draft of a
// SessionView; anything that needs IPC or global UI is returned as an Effect.
import { decodeUserContent } from '@shared/attachments';
import { forgeOfUrl } from '@shared/forge';
import { formatIdle, HANDOFF_CUSTOM_TYPE, type HandoffDetails } from '@shared/idle-reset';
import type { AgentMessage, PiEvent, PrSummary, Question, SessionMeta, TaskUpdate, UiRequest } from '@shared/protocol';
import { decodePrEvent } from '@shared/pr-event';
import { typedText } from '@shared/skill-message';
import * as previews from '@shared/tool-previews';
import { fmtDur, fmtTok, relPath } from '@/lib/format';
import { t } from '@/lib/i18n';
import { bareName, CODEMODE_TOOL, nestedCalls, toolFromArgs, toolLabel, type ToolState } from '@/lib/tools';
import type { ViewMode } from '@/lib/constants';
import { readArrangement, readPanels } from './layout';
import type { Item, ItemOf, SessionView, ThinkStep, Todo } from './types';

export interface Effects {
  scheduleChanges?: boolean;
  refreshStats?: boolean;
  /** The turn ended: drop listed files the model has since deleted. */
  pruneOutputs?: boolean;
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
    meta, items: [], loaded: false, running: false, compacting: false, t0: 0, tokens: 0, statusText: '', ctxPct: null, cacheRate: null, cost: null,
    model: meta.model ?? null, thinking: meta.thinking ?? null, levels: [], commands: [], waiting: null, unread: false,
    todosKey: null, lastTodos: [], outputs: [], changes: [], gitState: null, pr: meta.pr, prThreads: [], prHidden: false, files: null, fileTabs: [],
    panels: readPanels(meta.id), arrangement: readArrangement(meta.id), expanded: null, expandedWide: false, detail: null, previewUrl: null,
    pendingUser: [], stopping: false, historyBusy: false, setup: null, hostEpoch: 0, cur: null,
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

/** Result files the model listed join the session's outputs, as write and edit calls do. */
export function addOutputs(s: SessionView, files: string[]) {
  for (const file of files) {
    if (typeof file !== 'string') continue;
    const rel = relPath(s.meta.cwd, file);
    const prev = s.outputs.find((o) => o.path === rel);
    if (prev) prev.t = Date.now();
    else s.outputs.push({ path: rel, kind: 'write', t: Date.now() });
  }
}

export function toolStart(s: SessionView, ev: { toolCallId: string; toolName: string; args?: any }, view: ViewMode, replay = false) {
  if (bareName(ev.toolName) === 'todo_write') return;
  if (bareName(ev.toolName) === 'exit_plan_mode') {
    push(s, { kind: 'plan', key: newKey(), title: ev.args?.title || 'Plan', md: ev.args?.plan || '', toolCallId: ev.toolCallId, requestId: null, resolved: replay ? 'done' : null }, view);
    return;
  }
  if (bareName(ev.toolName) === 'ask_question') {
    const questions: Question[] = (Array.isArray(ev.args?.questions) ? ev.args.questions : [])
      .filter((q: any) => q?.question && Array.isArray(q.options))
      .map((q: any) => ({ question: q.question, header: q.header ?? '', multiSelect: !!q.multiSelect, options: q.options }));
    if (questions.length) {
      const request: UiRequest = { id: '', kind: 'questions', toolCallId: ev.toolCallId, title: '', questions };
      push(s, { kind: 'ask', key: newKey(), requestId: null, request, toolCallId: ev.toolCallId, resolved: replay ? 'cancelled' : null }, view);
    }
    return;
  }
  if (bareName(ev.toolName) === 'suggest_task') {
    const tasks = (Array.isArray(ev.args?.tasks) ? ev.args.tasks : [])
      .filter((t: any) => t?.title && t?.prompt)
      .map(({ code_folder, ...t }: any) => (typeof code_folder === 'string' && code_folder ? { ...t, codeFolder: code_folder } : t));
    if (tasks.length) push(s, { kind: 'suggest', key: newKey(), toolCallId: ev.toolCallId, tasks }, view);
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
  const asked = find(s, 'ask', (a) => a.toolCallId === ev.toolCallId);
  if (asked) {
    const answered = ev.result?.details?.status === 'answered';
    asked.resolved = answered ? 'Answered' : 'cancelled';
    asked.answers = answered ? ev.result?.details?.answers : undefined;
    asked.requestId = null;
    if (s.waiting === asked.key) s.waiting = null;
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
  if (t.kind === 'websearch' && !ev.isError) t.count = ev.result?.details?.hits?.length;
  if (bareName(ev.toolName) === CODEMODE_TOOL) t.calls = nestedCalls(ev.result?.details?.calls);
  // Live, the host pushes these as they happen (also from inside a script); this rebuilds them when a transcript is replayed.
  if (replay && bareName(ev.toolName) === 'present_files' && !ev.isError) addOutputs(s, ev.result?.details?.files ?? []);
  if (replay && bareName(ev.toolName) === CODEMODE_TOOL) {
    for (const call of nestedCalls(ev.result?.details?.calls)) {
      if (bareName(call.name) !== 'present_files' || call.status !== 'ok') continue;
      try { addOutputs(s, JSON.parse(call.args).paths ?? []); } catch { /* the host shortened the arguments */ }
    }
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
    if (!ev.isError && /\b(?:gh\s+pr|glab\s+mr)\s+(?:create|merge|close|reopen|ready|edit|update)\b/i.test(t.cmd)) {
      // gh / glab can take a moment to expose a just-created PR through `pr view`.
      const created = /\b(?:gh\s+pr|glab\s+mr)\s+create\b/i.test(t.cmd) && text.match(/https?:\/\/[^\s<>"'`]+\/(?:pull|merge_requests)\/(\d+)/i);
      if (created) {
        const pr = { num: Number(created[1]), url: created[0], state: 'open', draft: /(?:^|\s)--draft\b/.test(t.cmd) };
        s.pr = { ...pr, forge: forgeOfUrl(pr.url) ?? undefined, ci: 'none', checks: [], comments: 0 };
        s.meta.pr = pr;
        fx.prCreated = pr;
      }
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
      s.statusText = t('status.thinking');
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
      s.statusText = t('status.responding');
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
      s.statusText = t('status.preparing', { name: ame.toolName || 'tool' });
      break;
  }
}

function userFromMessage(s: SessionView, m: AgentMessage, view: ViewMode) {
  const user = decodeUserContent(m.content);
  if (user.text.startsWith('[pi-desktop]')) return;
  const event = decodePrEvent(user.text);
  if (event) {
    // Pi Desktop's own PR watcher started this turn: an event in the conversation, not a user bubble.
    push(s, { kind: 'prEvent', key: newKey(), event, at: m.timestamp || Date.now() }, view);
    return;
  }
  const pending = s.pendingUser
    .map((key) => findByKey(s, key))
    .filter((i): i is ItemOf<'user'> => i?.kind === 'user');
  // pi expands `/skill:name args` into a <skill> block, so compare against what the user typed.
  const typed = typedText(user.text);
  const match = user.clientId
    ? pending.find((p) => p.clientId === user.clientId)
    : pending.find((p) => !p.attachments.length && p.text.trim() === typed);
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
      s.statusText = t('status.thinking');
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
        if (m.stopReason === 'aborted') push(s, { kind: 'note', key: newKey(), text: t('status.interrupted') }, view);
        s.cur = null;
      } else if (m.role === 'custom' && m.display) push(s, customNote(m), view);
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
      } else if (bareName(ev.toolName) === CODEMODE_TOOL) {
        // Nested calls show up as the script makes them, not only once it ends.
        const found = findTool(s, ev.toolCallId);
        if (found) found.tool.calls = nestedCalls(ev.partialResult?.details?.calls);
      }
      return {};
    case 'tool_execution_end':
      return ev.parentToolCallId ? {} : toolEnd(s, ev as any, view);
    case 'auto_retry_start':
      push(s, { kind: 'note', key: newKey(), text: t('status.retrying', { attempt: ev.attempt, max: ev.maxAttempts, error: ev.errorMessage || '' }) }, view);
      return {};
    case 'compaction_start':
      s.compacting = true;
      s.statusText = t('status.compacting');
      return {};
    case 'compaction_end': {
      s.compacting = false;
      if (!ev.aborted) {
        const r = ev.result;
        if (ev.errorMessage) {
          const error = String(ev.errorMessage).replace(/^Compaction failed:\s*/, '');
          push(s, { kind: 'note', key: newKey(), level: 'error', text: t('status.compactionFailed', { error }) }, view);
        } else if (r) {
          push(s, { kind: 'compaction', key: newKey(), summary: String(r.summary ?? ''), tokensBefore: r.tokensBefore, tokensAfter: r.estimatedTokensAfter, open: false, hidden: 0, openSummary: true }, view);
        } else {
          push(s, { kind: 'note', key: newKey(), text: t('status.compacted') }, view);
        }
      }
      return { refreshStats: true };
    }
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
  push(s, { kind: 'foot', key: newKey(), t: Date.now(), usage: t('status.tokens', { dur: fmtDur(Date.now() - s.t0), tokens: fmtTok(s.tokens) }) }, view);
  s.meta.updatedAt = Date.now();
  return { settled: { aborted }, refreshStats: true, pruneOutputs: true, scheduleChanges: true };
}

// ------------------------------------------------------------ questions

export function permissionTitle(tool: ToolState | undefined, raw: string) {
  if (!tool) return raw;
  if (tool.kind === 'bash') return t('perm.runCommand');
  if (tool.kind === 'edit') return t('perm.edit', { path: tool.path ?? '' });
  if (tool.kind === 'write') return t('perm.write', { path: tool.path ?? '' });
  return t('perm.use', { name: tool.name });
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
  const card = req.kind === 'questions' ? find(s, 'ask', (a) => a.toolCallId === req.toolCallId) : undefined;
  if (card) {
    // Reopening a session replays the call as unanswered; the host says it is still waiting.
    card.resolved = null;
    card.answers = undefined;
    card.requestId = req.id;
    s.waiting = card.key;
    return {};
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
  s.cur = null;
  s.waiting = null;
  s.detail = null;
  s.pendingUser = [];
  s.compacting = false;
  appendMessages(s, messages, view);
  for (const i of s.items) if (i.kind === 'group') i.open = verbose(view);
}

/** The items a message list produces, without touching a live transcript (older messages behind a compaction). */
export function transcriptItems(meta: SessionMeta, messages: AgentMessage[], view: ViewMode): Item[] {
  const s = emptySession(meta);
  appendMessages(s, messages, view);
  // These are shown on demand, so their own older summaries stay folded away.
  for (const i of s.items) if (i.kind === 'compaction') {
    i.open = true;
    i.openSummary = false;
  }
  return s.items;
}

/**
 * A handoff card carries a long, model-facing text. The transcript shows one line instead: the text
 * is there for the model, not the reader.
 */
function customNote(m: AgentMessage): ItemOf<'note'> {
  if (m.customType !== HANDOFF_CUSTOM_TYPE) return { kind: 'note', key: newKey(), text: textOf(m.content) };
  const d = (m.details ?? {}) as Partial<HandoffDetails>;
  return {
    kind: 'note', key: newKey(),
    text: t('handoff.card', { idle: formatIdle(d.idleMinutes ?? 0), tokens: fmtTok(d.tokensBefore ?? 0) }),
  };
}

function appendMessages(s: SessionView, messages: AgentMessage[], view: ViewMode) {
  let sawAssistant = false;
  for (const m of messages) {
    if (m.role === 'user') {
      const user = decodeUserContent(m.content);
      if (user.text.startsWith('[pi-desktop]')) continue;
      if (sawAssistant) s.items.push({ kind: 'foot', key: newKey(), t: m.timestamp || Date.now() });
      sawAssistant = false;
      s.todosKey = null;
      const event = decodePrEvent(user.text);
      if (event) {
        s.items.push({ kind: 'prEvent', key: newKey(), event, at: m.timestamp || Date.now() });
        continue;
      }
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
      s.items.push(customNote(m));
    } else if (m.role === 'compactionSummary') {
      const tokensBefore = Number(m.tokensBefore) || undefined;
      s.items.push({ kind: 'compaction', key: newKey(), summary: String(m.summary ?? ''), tokensBefore, open: false, hidden: 0, openSummary: true });
    }
  }
  if (sawAssistant) s.items.push({ kind: 'foot', key: newKey(), t: s.meta.updatedAt });
}

/**
 * Which items a collapsed compaction card hides, and how many sit above each card.
 * A card hides everything since the previous one, so nested compactions fold inside out.
 */
export function collapsedItems(items: Item[]) {
  const hidden = new Set<string>();
  const before = new Map<string, number>();
  let from = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== 'compaction') continue;
    before.set(item.key, i - from);
    if (!item.open) for (let j = from; j < i; j++) hidden.add(items[j].key);
    from = i + 1;
  }
  return { hidden, before };
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
