// pi session events → transcript items. Pure functions over an immer draft of a
// SessionView; anything that needs IPC or global UI is returned as an Effect.
import { decodeUserContent } from '@shared/attachments';
import { forgeOfUrl } from '@shared/forge';
import { formatIdle, HANDOFF_CUSTOM_TYPE, type HandoffDetails } from '@shared/idle-reset';
import type {
  AgentMessage,
  NestedFileOutput,
  PiEvent,
  PrSummary,
  Question,
  SessionMeta,
  SpawnTask,
  TaskUpdate,
  UiRequest,
} from '@shared/protocol';
import { decodePeerMessage, peerMessageBody, queuedPeerMessages, SEND_MESSAGE_TOOL } from '@shared/peer-message';
import { TASK_NOTIFICATION_TYPE, taskNotificationText } from '@shared/task-message';
import { decodePrEvent } from '@shared/pr-event';
import { typedText } from '@shared/skill-message';
import * as previews from '@shared/tool-previews';
import { fmtDur, fmtTok, relPath } from '@/lib/format';
import { t } from '@/lib/i18n';
import { bareName, CODEMODE_TOOL, nestedCalls, toolFromArgs, toolLabel, type ToolState } from '@/lib/tools';
import type { ViewMode } from '@/lib/constants';
import { readPanels, readWorkspaceTab } from './layout';
import type { Item, ItemOf, SessionChange, SessionView, ThinkStep, Todo } from './types';

export interface Effects {
  scheduleChanges?: boolean;
  refreshStats?: boolean;
  /** The turn ended: drop listed files the model has since deleted. */
  pruneOutputs?: boolean;
  prCreated?: PrSummary;
  settled?: { aborted: boolean };
  waiting?: UiRequest;
  toast?: string;
  editorText?: string;
}

let seq = 0;
const ESTIMATED_CHARS_PER_TOKEN = 3;
export const newKey = () => `i${++seq}`;

export function emptySession(meta: SessionMeta): SessionView {
  return {
    meta,
    items: [],
    queuedPeers: [],
    loaded: false,
    running: false,
    compacting: false,
    t0: 0,
    tokens: 0,
    streamTokens: 0,
    streamMs: 0,
    sessionTokens: 0,
    sessionStreamMs: 0,
    statusText: '',
    ctxPct: null,
    cacheRate: null,
    cost: null,
    model: meta.model ?? null,
    thinking: meta.thinking ?? null,
    levels: [],
    commands: [],
    waiting: null,
    unread: false,
    lastTodos: [],
    outputs: [],
    turnOutputs: [],
    turnChanges: [],
    sessionChanges: [],
    changes: [],
    changesVersion: 0,
    diffScope: 'branch',
    diffBranch: null,
    gitState: null,
    pr: meta.pr,
    prThreads: [],
    prHidden: false,
    files: null,
    fileTabs: [],
    fileDetail: null,
    panels: readPanels(meta.id),
    activeTab: readWorkspaceTab(meta.id),
    workspaceExpanded: false,
    detail: null,
    previewUrl: null,
    pendingUser: [],
    scrollRequest: null,
    diffRequest: 0,
    stopping: false,
    historyBusy: false,
    setup: null,
    hostEpoch: 0,
    cur: null,
  };
}

const textOf = (c: unknown) =>
  typeof c === 'string'
    ? c
    : Array.isArray(c)
      ? c
          .filter((x) => x?.type === 'text')
          .map((x) => x.text)
          .join('')
      : '';

export const find = <K extends Item['kind']>(s: SessionView, kind: K, pred: (item: ItemOf<K>) => boolean) =>
  s.items.find((i): i is ItemOf<K> => i.kind === kind && pred(i as ItemOf<K>));
export const findByKey = (s: SessionView, key: string | null | undefined) =>
  key ? s.items.find((i) => i.key === key) : undefined;

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

/** A `!command` is running in the session's own shell: Stop interrupts it, like the model's own turn. */
export const bashRunning = (s: SessionView | undefined) => !!s?.items.some((i) => i.kind === 'bash' && i.running);

/** Append an item; a finished, untouched tool group folds itself away first (except in Verbose). */
export function push<T extends Item>(s: SessionView, item: T, view: ViewMode): T {
  const last = s.items.at(-1);
  if (
    !verbose(view) &&
    item.kind !== 'group' &&
    item.kind !== 'perm' &&
    last?.kind === 'group' &&
    last.open &&
    !last.userToggled &&
    !last.tools.some((t) => t.status === 'running')
  ) {
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

/** Start a new file-change summary without discarding the session's historical output list. */
export function startChangeTurn(s: SessionView) {
  s.turnOutputs = [];
  s.turnChanges = [];
}

function recordOutput(s: SessionView, path: string, kind: 'write' | 'edit', t = Date.now()) {
  const update = (list: SessionView['outputs'] | SessionView['turnOutputs']) => {
    const prev = list.find((o) => o.path === path);
    if (prev) prev.t = t;
    else list.push({ path, kind, t });
  };
  update(s.outputs);
  update(s.turnOutputs);
}

/** Result files the model listed join the session's outputs, as write and edit calls do. */
export function addOutputs(s: SessionView, files: string[]) {
  for (const file of files) {
    if (typeof file !== 'string') continue;
    recordOutput(s, relPath(s.meta.cwd, file), 'write');
  }
}

function recordChange(
  list: SessionChange[],
  path: string,
  kind: 'write' | 'edit',
  oldText: string | null,
  newText: string | null,
  statsFromTool: { add: number; del: number },
  toolId: string,
  binary = false,
) {
  const existing = list.find((change) => change.path === path);
  const before = existing?.status === 'A' ? existing.before : (existing?.before ?? oldText);
  const after = binary ? null : (newText ?? existing?.after ?? null);
  const stats = !binary && (before !== null || after !== null) ? previews.diffStats(before, after) : statsFromTool;
  const next: SessionChange = {
    path,
    status: existing?.status ?? (kind === 'write' ? 'A' : 'M'),
    binary,
    add: stats.add,
    del: stats.del,
    rev: `${Date.now()}:${toolId}`,
    before,
    after,
  };
  if (existing) Object.assign(existing, next);
  else list.push(next);
}

function recordSessionChange(
  s: SessionView,
  path: string,
  kind: 'write' | 'edit',
  args: Record<string, any>,
  preview: previews.ToolPreview,
  toolId: string,
) {
  const oldText = kind === 'edit' && typeof args.oldText === 'string' ? args.oldText : null;
  const newText =
    kind === 'write'
      ? typeof args.content === 'string'
        ? args.content
        : null
      : typeof args.newText === 'string'
        ? args.newText
        : null;
  const stats = preview.type === 'diff' ? preview : { add: 0, del: 0 };
  recordChange(s.sessionChanges, path, kind, oldText, newText, stats, toolId);
  recordChange(s.turnChanges, path, kind, oldText, newText, stats, toolId);
}

/** Nested calls belong to the script's one row, but have the same file side effects as direct calls. */
function recordNestedOutput(s: SessionView, output: NestedFileOutput) {
  const path = relPath(s.meta.cwd, output.path);
  recordOutput(s, path, output.kind);
  const { before = null, after = null, binary = false } = output.content ?? {};
  for (const list of [s.sessionChanges, s.turnChanges])
    recordChange(list, path, output.kind, before, after, { add: 0, del: 0 }, output.toolCallId, binary);
}

function peerSendItem(id: string, args?: Record<string, unknown>): ItemOf<'peerSend'> {
  return {
    kind: 'peerSend',
    key: newKey(),
    toolCallId: id,
    sessionId: typeof args?.session_id === 'string' ? args.session_id : undefined,
    text: typeof args?.message === 'string' ? peerMessageBody(args.message) : undefined,
    status: 'unconfirmed',
  };
}

export function toolStart(
  s: SessionView,
  ev: { toolCallId: string; toolName: string; args?: any },
  view: ViewMode,
  replay = false,
) {
  if (ev.toolName === SEND_MESSAGE_TOOL) {
    push(s, peerSendItem(ev.toolCallId, ev.args), view);
    return;
  }
  if (bareName(ev.toolName) === 'todo_write') return;
  if (bareName(ev.toolName) === 'exit_plan_mode') {
    push(
      s,
      {
        kind: 'plan',
        key: newKey(),
        title: ev.args?.title || 'Plan',
        md: ev.args?.plan || '',
        toolCallId: ev.toolCallId,
        requestId: null,
        resolved: replay ? 'done' : null,
      },
      view,
    );
    return;
  }
  if (bareName(ev.toolName) === 'ask_question') {
    const questions: Question[] = (Array.isArray(ev.args?.questions) ? ev.args.questions : [])
      .filter((q: any) => q?.question && Array.isArray(q.options))
      .map((q: any) => ({
        question: q.question,
        header: q.header ?? '',
        multiSelect: !!q.multiSelect,
        options: q.options,
      }));
    if (questions.length) {
      const request: UiRequest = { id: '', kind: 'questions', toolCallId: ev.toolCallId, title: '', questions };
      push(
        s,
        {
          kind: 'ask',
          key: newKey(),
          requestId: null,
          request,
          toolCallId: ev.toolCallId,
          resolved: replay ? 'cancelled' : null,
        },
        view,
      );
    }
    return;
  }
  // Suggestions are actionable only after the host validates the call and returns its tasks.
  if (bareName(ev.toolName) === 'suggest_task') return;
  const g = currentGroup(s, view);
  const tool = toolFromArgs(ev.toolCallId, ev.toolName, ev.args);
  if (tool.kind === 'agent' && !replay)
    tool.sub = { startedAt: Date.now(), tokens: 0, toolUses: 0, activity: 'Starting', steps: [] };
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
  if (ev.toolName === SEND_MESSAGE_TOOL) {
    const send = find(s, 'peerSend', (item) => item.toolCallId === ev.toolCallId);
    if (send) {
      send.status = ev.isError ? 'failed' : ev.result?.details?.outcome === 'queued' ? 'queued' : 'sent';
      if (ev.isError) send.error = text;
    }
    return fx;
  }
  if (bareName(ev.toolName) === 'todo_write') {
    const items = ev.result?.details?.todos as Todo[] | undefined;
    if (ev.isError || !Array.isArray(items)) return fx;
    // Adjacent updates refresh one card in place; intervening items preserve earlier snapshots.
    const last = s.items.at(-1);
    if (last?.kind === 'todos') last.items = items;
    else push(s, { kind: 'todos', key: newKey(), items }, view);
    s.lastTodos = items;
    return fx;
  }
  if (bareName(ev.toolName) === 'suggest_task') {
    const tasks = ev.result?.details?.tasks as SpawnTask[] | undefined;
    if (ev.isError || !Array.isArray(tasks)) return fx;
    const validTasks = tasks.filter((task) => task?.title && task?.prompt);
    if (validTasks.length)
      push(s, { kind: 'suggest', key: newKey(), toolCallId: ev.toolCallId, tasks: validTasks }, view);
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
    const preview =
      t.kind === 'read'
        ? previews.read(t.args, ev.result ?? {}, !!ev.isError)
        : t.kind === 'edit'
          ? previews.edit(t.args, ev.result ?? {}, !!ev.isError)
          : previews.write(t.args, ev.result ?? {}, !!ev.isError);
    t.preview = preview;
    if ('firstChangedLine' in preview) t.firstChangedLine = preview.firstChangedLine;
    if (preview.type === 'diff') {
      t.add = preview.add;
      t.del = preview.del;
    }
    if (!ev.isError && t.path && (t.kind === 'edit' || t.kind === 'write')) {
      const rel = relPath(s.meta.cwd, t.path);
      recordSessionChange(s, rel, t.kind, t.args, preview, t.id);
    }
  }
  if (t.kind === 'websearch' && !ev.isError) t.count = ev.result?.details?.hits?.length;
  if (bareName(ev.toolName) === CODEMODE_TOOL) t.calls = nestedCalls(ev.result?.details?.calls);
  // Live, the host pushes these as they happen (also from inside a script); this rebuilds them when a transcript is replayed.
  if (replay && bareName(ev.toolName) === 'present_files' && !ev.isError)
    addOutputs(s, ev.result?.details?.files ?? []);
  if (replay && bareName(ev.toolName) === CODEMODE_TOOL) {
    for (const call of nestedCalls(ev.result?.details?.calls)) {
      if (bareName(call.name) !== 'present_files' || call.status !== 'ok') continue;
      try {
        addOutputs(s, JSON.parse(call.args).paths ?? []);
      } catch {
        /* the host shortened the arguments */
      }
    }
  }
  if (t.kind === 'bash') t.output = text;
  else if (t.kind === 'edit' || t.kind === 'write') {
    if (!ev.isError && t.path) recordOutput(s, relPath(s.meta.cwd, t.path), t.kind);
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
    else if (t.sub && !t.sub.endedAt)
      t.sub = { ...t.sub, endedAt: Date.now(), activity: ev.isError ? 'Stopped' : 'Done' };
  } else if (t.kind !== 'read') t.output = text.slice(0, 8000);

  if (t.kind === 'bash' && !replay) {
    if (!ev.isError && /\b(?:gh\s+pr|glab\s+mr)\s+(?:create|merge|close|reopen|ready|edit|update)\b/i.test(t.cmd)) {
      // gh / glab can take a moment to expose a just-created PR through `pr view`.
      const created =
        /\b(?:gh\s+pr|glab\s+mr)\s+create\b/i.test(t.cmd) &&
        text.match(/https?:\/\/[^\s<>"'`]+\/(?:pull|merge_requests)\/(\d+)/i);
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

function beginStream(c: NonNullable<SessionView['cur']>) {
  if (!c.streamT0) c.streamT0 = Date.now();
}

function closeStream(s: SessionView, c: NonNullable<SessionView['cur']>) {
  if (!c.streamT0) return;
  s.streamMs += Math.max(0, Date.now() - c.streamT0);
  c.streamT0 = 0;
}

function addStreamDelta(s: SessionView, c: NonNullable<SessionView['cur']>, delta: string) {
  if (!delta) return;
  beginStream(c);
  const previous = c.streamTokens;
  c.streamChars += delta.length;
  c.streamTokens = Math.ceil(c.streamChars / ESTIMATED_CHARS_PER_TOKEN);
  const added = c.streamTokens - previous;
  s.tokens += added;
  s.streamTokens += added;
}

function assistantDelta(s: SessionView, ame: any, view: ViewMode) {
  const c = (s.cur ??= {
    thinkGroup: null,
    thinkIndex: -1,
    text: null,
    streamChars: 0,
    streamTextChars: 0,
    streamTokens: 0,
    streamT0: 0,
  });
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
      beginStream(c);
      s.statusText = t('status.thinking');
      break;
    case 'thinking_delta': {
      if (!thought()) addThought();
      const delta = String(ame.delta ?? '');
      thought()!.text += delta;
      addStreamDelta(s, c, delta);
      break;
    }
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
      beginStream(c);
      s.statusText = t('status.responding');
      break;
    case 'text_delta': {
      const delta = String(ame.delta ?? '');
      if (!delta) break;
      if (!liveText()) c.text = push(s, { kind: 'text', key: newKey(), text: '', live: true }, view).key;
      liveText()!.text += delta;
      c.streamTextChars += delta.length;
      addStreamDelta(s, c, delta);
      break;
    }
    case 'text_end': {
      const t = liveText();
      if (t) {
        t.text = ame.content ?? t.text;
        t.live = false;
        // `c.text` keeps pointing here until message_end reconciles it: another item (the user's `!` command,
        // a permission card) may land in between, and message_end would then repeat the whole reply.
      }
      break;
    }
    case 'toolcall_start':
      s.statusText = t('status.preparing', { name: ame.toolName || 'tool' });
      break;
  }
}

/** Clear finished work only when a new user message is actually delivered, not when it is queued. */
function clearCompletedTodos(s: SessionView, text: string) {
  if (s.lastTodos.length && s.lastTodos.every((item) => item.status === 'completed') && !decodePeerMessage(text))
    s.lastTodos = [];
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
  const pending = s.pendingUser.map((key) => findByKey(s, key)).filter((i): i is ItemOf<'user'> => i?.kind === 'user');
  // pi expands `/skill:name args` into a <skill> block, so compare against what the user typed.
  const typed = typedText(user.text);
  const match = user.clientId
    ? pending.find((p) => p.clientId === user.clientId)
    : pending.find((p) => !p.attachments.length && p.text.trim() === typed);
  if (match) {
    s.pendingUser = s.pendingUser.filter((k) => k !== match.key);
    Object.assign(match, user, {
      entryId: m.entryId,
      timestamp: m.timestamp,
      queued: false,
      delivered: true,
      failed: false,
    });
  } else if (!user.clientId || !s.items.some((i) => i.kind === 'user' && i.clientId === user.clientId)) {
    startChangeTurn(s);
    push(
      s,
      { kind: 'user', key: newKey(), ...user, entryId: m.entryId, timestamp: m.timestamp, delivered: true },
      view,
    );
  } else return; // A duplicate delivery must not clear a newer list.
  clearCompletedTodos(s, user.text);
}

export function applyPiEvent(s: SessionView, ev: PiEvent, view: ViewMode): Effects {
  switch (ev.type) {
    case 'bash_execution_update': {
      // A `!command` the user ran: the host streams its output, keyed by the transcript item it belongs to.
      // Events are batched, so a chunk can land after the result already replaced the output: drop it then.
      const item = findByKey(s, ev.id);
      if (item?.kind === 'bash' && item.running) item.output += String(ev.delta ?? '');
      return {};
    }
    case 'queue_update':
      s.queuedPeers = queuedPeerMessages(ev.followUp);
      return {};
    case 'agent_start':
      if (!s.running) {
        s.running = true;
        s.t0 = Date.now();
        s.tokens = 0;
        s.streamTokens = 0;
        s.streamMs = 0;
      }
      s.statusText = t('status.thinking');
      return {};
    case 'message_start':
      if (ev.message?.role === 'assistant')
        s.cur = {
          thinkGroup: null,
          thinkIndex: -1,
          text: null,
          streamChars: 0,
          streamTextChars: 0,
          streamTokens: 0,
          streamT0: 0,
        };
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
        const finalText = (Array.isArray(m.content) ? m.content : [])
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('');
        const live = findByKey(s, c?.text);
        if (live?.kind === 'text') {
          live.text = finalText || live.text;
          live.live = false;
          live.msgTs = m.timestamp;
        } else if (finalText && !s.items.some((i) => i.kind === 'text' && i.msgTs === m.timestamp)) {
          const last = s.items.at(-1);
          if (!(last?.kind === 'text' && last.text === finalText))
            push(s, { kind: 'text', key: newKey(), text: finalText, live: false, msgTs: m.timestamp }, view);
        }
        const g = findByKey(s, c?.thinkGroup);
        const step = g?.kind === 'group' ? g.thoughts[c!.thinkIndex] : undefined;
        if (step && !step.done) finishThought(step, view);
        const output = Number(m.usage?.output);
        if (c) {
          // Deltas provide a live estimate; replace that estimate with the provider's final count.
          if (finalText.length > c.streamTextChars) {
            const addedChars = finalText.length - c.streamTextChars;
            c.streamTextChars = finalText.length;
            const previous = c.streamTokens;
            c.streamChars += addedChars;
            c.streamTokens = Math.ceil(c.streamChars / ESTIMATED_CHARS_PER_TOKEN);
            const added = c.streamTokens - previous;
            s.tokens += added;
            s.streamTokens += added;
          }
          if (Number.isFinite(output) && output >= 0) {
            const added = output - c.streamTokens;
            s.tokens += added;
            if (c.streamTokens > 0 || c.streamTextChars > 0) s.streamTokens += added;
            c.streamTokens = output;
          }
          closeStream(s, c);
        } else if (Number.isFinite(output) && output >= 0) {
          s.tokens += output;
        }
        if (m.stopReason === 'error' && m.errorMessage)
          push(s, { kind: 'note', key: newKey(), level: 'error', text: `Error: ${m.errorMessage}` }, view);
        if (m.stopReason === 'aborted') push(s, { kind: 'note', key: newKey(), text: t('status.interrupted') }, view);
        s.cur = null;
      } else if (m.role === 'custom') {
        const item = customItem(m);
        if (item) push(s, item, view);
      }
      return {};
    }
    case 'tool_execution_start':
      if (!ev.parentToolCallId || ev.toolName === SEND_MESSAGE_TOOL) toolStart(s, ev as any, view);
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
      if (!ev.parentToolCallId || ev.toolName === SEND_MESSAGE_TOOL) return toolEnd(s, ev as any, view);
      if (!ev.fileOutput || ev.isError) return {};
      recordNestedOutput(s, ev.fileOutput);
      return { scheduleChanges: true };
    case 'auto_retry_start':
      push(
        s,
        {
          kind: 'note',
          key: newKey(),
          text: t('status.retrying', { attempt: ev.attempt, max: ev.maxAttempts, error: ev.errorMessage || '' }),
        },
        view,
      );
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
          push(
            s,
            {
              kind: 'compaction',
              key: newKey(),
              summary: String(r.summary ?? ''),
              tokensBefore: r.tokensBefore,
              tokensAfter: r.estimatedTokensAfter,
              open: false,
              hidden: 0,
              openSummary: true,
            },
            view,
          );
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
  if (s.cur) closeStream(s, s.cur);
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
  const elapsed = Date.now() - s.t0;
  s.sessionTokens += s.streamTokens;
  s.sessionStreamMs += s.streamMs;
  push(
    s,
    {
      kind: 'foot',
      key: newKey(),
      t: Date.now(),
      usage: t('status.tokens', {
        dur: fmtDur(elapsed),
        tokens: fmtTok(s.tokens),
      }),
    },
    view,
  );
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

export const pendingRequest = (s: SessionView | undefined, requestId: string) =>
  s?.items.find((i): i is ItemOf<'perm' | 'ask' | 'plan'> => 'requestId' in i && i.requestId === requestId);

export function addUiRequest(s: SessionView, req: UiRequest, view: ViewMode): { openPlan?: string } {
  if (pendingRequest(s, req.id)) return {};
  if (req.kind === 'permission') {
    s.waiting = push(
      s,
      { kind: 'perm', key: newKey(), requestId: req.id, toolCallId: req.toolCallId, title: req.title, resolved: null },
      view,
    ).key;
    return {};
  }
  if (req.kind === 'plan') {
    let plan = find(s, 'plan', (p) => p.toolCallId === req.toolCallId);
    if (!plan)
      plan = push(
        s,
        {
          kind: 'plan',
          key: newKey(),
          toolCallId: req.toolCallId,
          title: req.title,
          md: '',
          requestId: null,
          resolved: null,
        },
        view,
      );
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
  const item = pendingRequest(s, requestId);
  if (!item) return;
  item.resolved = item.resolved && item.kind === 'plan' ? item.resolved : label;
  item.requestId = null;
  if (s.waiting === item.key) s.waiting = null;
}

// ------------------------------------------------------------ history

/** Rebuild the transcript from pi's message list (session resume). */
export function replay(s: SessionView, messages: AgentMessage[], view: ViewMode) {
  s.items = [];
  s.queuedPeers = [];
  s.lastTodos = [];
  s.outputs = [];
  s.turnOutputs = [];
  s.turnChanges = [];
  s.sessionChanges = [];
  s.streamTokens = 0;
  s.streamMs = 0;
  s.sessionTokens = 0;
  s.sessionStreamMs = 0;
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
  for (const i of s.items) {
    if (i.kind === 'compaction') {
      i.open = true;
      i.openSummary = false;
    } else if (i.kind === 'handoff') {
      i.open = true;
    }
  }
  return s.items;
}

/**
 * A handoff card carries a long, model-facing text. The transcript shows one line instead: the text
 * is there for the model, not the reader.
 */
function customItem(m: AgentMessage): Item | null {
  if (m.customType === TASK_NOTIFICATION_TYPE)
    return { kind: 'taskEvent', key: newKey(), text: taskNotificationText(textOf(m.content)) };
  if (!m.display) return null;
  if (m.customType !== HANDOFF_CUSTOM_TYPE) return { kind: 'note', key: newKey(), text: textOf(m.content) };
  const d = (m.details ?? {}) as Partial<HandoffDetails>;
  return {
    kind: 'handoff',
    key: newKey(),
    idle: formatIdle(d.idleMinutes ?? 0),
    tokensBefore: d.tokensBefore,
    open: false,
    hidden: 0,
  };
}

/** A `!command` pi recorded in the conversation: replayed like any other item. */
function bashExecutionItem(m: AgentMessage): ItemOf<'bash'> {
  const exitCode = Number(m.exitCode);
  return {
    kind: 'bash',
    key: newKey(),
    command: String(m.command ?? ''),
    output: String(m.output ?? ''),
    running: false,
    exitCode: m.exitCode === null || m.exitCode === undefined || Number.isNaN(exitCode) ? undefined : exitCode,
    cancelled: !!m.cancelled,
    truncated: !!m.truncated,
    fullOutputPath: m.fullOutputPath ? String(m.fullOutputPath) : undefined,
    excluded: !!m.excludeFromContext,
    at: m.timestamp || Date.now(),
  };
}

function appendMessages(s: SessionView, messages: AgentMessage[], view: ViewMode) {
  let sawAssistant = false;
  for (const m of messages) {
    if (m.role === 'user') {
      const user = decodeUserContent(m.content);
      if (user.text.startsWith('[pi-desktop]')) continue;
      startChangeTurn(s);
      if (sawAssistant) s.items.push({ kind: 'foot', key: newKey(), t: m.timestamp || Date.now() });
      sawAssistant = false;
      const event = decodePrEvent(user.text);
      if (event) {
        s.items.push({ kind: 'prEvent', key: newKey(), event, at: m.timestamp || Date.now() });
        continue;
      }
      clearCompletedTodos(s, user.text);
      s.items.push({
        kind: 'user',
        key: newKey(),
        ...user,
        entryId: m.entryId,
        timestamp: m.timestamp,
        delivered: true,
      });
    } else if (m.role === 'assistant') {
      sawAssistant = true;
      for (const output of m.nestedFileOutputs ?? []) recordNestedOutput(s, output);
      for (const b of Array.isArray(m.content) ? m.content : []) {
        if (b.type === 'thinking' && b.thinking) {
          let g = s.items.at(-1);
          if (g?.kind !== 'group') {
            g = { kind: 'group', key: newKey(), thoughts: [], tools: [], open: verbose(view) };
            s.items.push(g);
          }
          g.thoughts.push({ text: b.thinking, done: true, t0: 0, open: verbose(view) });
        } else if (b.type === 'text' && b.text)
          s.items.push({ kind: 'text', key: newKey(), text: b.text, live: false });
        else if (b.type === 'toolCall')
          toolStart(s, { toolCallId: b.id!, toolName: b.name!, args: b.arguments }, view, true);
      }
      if (m.stopReason === 'error' && m.errorMessage)
        s.items.push({ kind: 'note', key: newKey(), level: 'error', text: `Error: ${m.errorMessage}` });
    } else if (m.role === 'toolResult') {
      // Nested sends have execution events live, but only the parent result is in history.
      for (const call of m.nestedCalls?.calls ?? []) {
        if (call.name !== SEND_MESSAGE_TOOL) continue;
        const send = peerSendItem(call.id, call.arguments);
        send.status = call.status === 'ok' ? 'sent' : call.status === 'error' ? 'failed' : 'unconfirmed';
        send.error = call.error;
        s.items.push(send);
      }
      toolEnd(
        s,
        {
          toolCallId: m.toolCallId!,
          toolName: m.toolName!,
          result: { content: m.content, details: m.details },
          isError: m.isError,
        },
        view,
        true,
      );
    } else if (m.role === 'custom') {
      const item = customItem(m);
      if (item) s.items.push(item);
    } else if (m.role === 'bashExecution') {
      s.items.push(bashExecutionItem(m));
    } else if (m.role === 'compactionSummary') {
      const tokensBefore = Number(m.tokensBefore) || undefined;
      s.items.push({
        kind: 'compaction',
        key: newKey(),
        summary: String(m.summary ?? ''),
        tokensBefore,
        open: false,
        hidden: 0,
        openSummary: true,
      });
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
    // A handoff card stands in for the messages above it exactly like a compaction checkpoint does.
    if (item.kind !== 'compaction' && item.kind !== 'handoff') continue;
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

export const hasThinking = (s: SessionView | undefined) =>
  !!s?.items.some((i) => i.kind === 'group' && i.thoughts.length > 0);
