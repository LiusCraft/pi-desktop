// Everything the UI does: navigation, sending, session settings, panels. State lives
// in the app store; pi events are folded in by transcript.ts.
import { toast } from 'sonner';
import { buildMessage, decodeUserContent, type Attachment } from '@shared/attachments';
import type { HostEvent, OutputStyle, PermissionMode, SessionKind, SessionMeta, SpawnTask, ThinkingLevel, UiResponse } from '@shared/protocol';
import { referencePrompt } from '@shared/context-reference';
import { positiveLine } from '@shared/tool-previews';
import { call, errText, modKey } from '@/lib/api';
import { DESKTOP_COMMANDS, MODES, VIEW_MODES, type ViewMode } from '@/lib/constants';
import { changeStats } from '@/lib/diff';
import { fmtTok, fname, relPath } from '@/lib/format';
import { currentSession, getApp, isWork, read, savePref, setApp, setPref, updateSession, type AppState } from './app';
import { dialogs } from './dialogs';
import { activeDraft, drafts, getDraft, sessionDraftKey, useDrafts } from './drafts';
import { forgetPanels, writePanels } from './layout';
import { primeSuggestion, resumeSuggestion } from './predict';
import { forgetScroll } from './scroll';
import { askSide, showSide } from './side';
import {
  addUiRequest, applyPiEvent, applyTaskUpdate, applyViewMode, emptySession, findByKey, hasThinking, newKey, push, replay, resolveUi, settle, type Effects,
} from './transcript';
import type { CardId, Item, Panels, SessionView } from './types';

export const fail = (err: unknown) => toast.error(errText(err));

// ------------------------------------------------------------ drafts

export { sessionDraftKey };
export function welcomeDraftKey(st: AppState = getApp()) {
  return st.view === 'work' ? `welcome:work:${st.prefs.workFolder || 'scratch'}` : `welcome:code:${st.prefs.project || 'none'}`;
}
const activateDraftFor = () => {
  const st = getApp();
  drafts.activate(st.current ? sessionDraftKey(st.current) : welcomeDraftKey(st));
};

// ------------------------------------------------------------ host events

let queue: HostEvent[] = [];
let scheduled = false;

/** Events arrive one IPC message at a time; fold a frame's worth into one render. */
export function handleHostEvent(ev: HostEvent) {
  // Login prompts belong to the settings window; model changes refresh the pickers.
  if (ev.type === 'auth_prompt' || ev.type === 'auth_event') return;
  if (ev.type === 'models_changed') {
    void loadModels();
    return;
  }
  queue.push(ev);
  if (scheduled) return;
  scheduled = true;
  if (document.hidden) setTimeout(flushEvents, 50);
  else requestAnimationFrame(flushEvents);
}

function flushEvents() {
  scheduled = false;
  const events = queue;
  queue = [];
  const effects: [string, Effects][] = [];
  const recoveries: [string, Item & { kind: 'user' }][] = [];
  setApp((st) => {
    const view = st.prefs.viewMode;
    for (const ev of events) {
      if (ev.type === 'tasks') {
        st.tasks = ev.tasks;
        continue;
      }
      if (ev.type === 'auth_prompt' || ev.type === 'auth_event' || ev.type === 'models_changed') continue;
      if (ev.type === 'host_exit') {
        for (const s of Object.values(st.sessions)) {
          if (s.running) settle(s, true, view);
          s.hostEpoch++;
          s.loaded = false;
          s.setup = null;
          s.waiting = null;
          for (const key of [...s.pendingUser]) {
            const p = findByKey(s, key);
            if (p?.kind !== 'user') continue;
            p.exited = true;
            // Unacknowledged submissions still own their locked draft. Acknowledged
            // queues already cleared it, so recover the retained message.
            if (p.acknowledged && !p.delivered) recoveries.push([s.meta.id, { ...p }]);
            s.items = s.items.filter((i) => i.key !== key);
          }
          s.pendingUser = [];
          for (const i of s.items) if ((i.kind === 'perm' || i.kind === 'ask' || i.kind === 'plan') && i.requestId) { i.requestId = null; i.resolved ??= 'cancelled'; }
        }
        const cur = st.current && st.sessions[st.current];
        if (cur) {
          const tail = ev.stderr.trim().split('\n').slice(-6).join('\n');
          push(cur, { kind: 'note', key: newKey(), level: 'error', text: `Agent 进程退出（${ev.code}），下一条消息会自动重启。${tail ? `\n${tail}` : ''}` }, view);
        }
        continue;
      }
      let s = st.sessions[ev.sessionId];
      if (ev.type === 'meta') {
        if (s) s.meta = { ...ev.meta, pr: s.meta.pr ?? ev.meta.pr }; else st.sessions[ev.sessionId] = emptySession(ev.meta);
        continue;
      }
      if (!s) continue;
      switch (ev.type) {
        case 'pi':
          effects.push([s.meta.id, applyPiEvent(s, ev.event, view)]);
          break;
        case 'task':
          applyTaskUpdate(s, ev.update);
          break;
        case 'ui_request': {
          const r = addUiRequest(s, ev.request, view);
          if (r.openPlan) s.detail = { type: 'plan', key: r.openPlan };
          effects.push([s.meta.id, { waiting: true }]);
          break;
        }
        case 'ui_resolved':
          resolveUi(s, ev.requestId, ev.label);
          break;
        case 'setup':
          s.setup = ev.steps;
          break;
        case 'pr':
          if (ev.status) {
            // A PR that did not exist when the bar was hidden is news: show the bar again.
            if (s.pr?.num !== ev.status.num) s.prHidden = false;
            // New comments on a PR whose diff is on screen should appear there without a refresh.
            if (s.panels.diff && (s.pr?.num !== ev.status.num || s.pr.comments !== ev.status.comments)) {
              const sid = s.meta.id;
              queueMicrotask(() => void loadPrThreads(sid));
            }
            s.pr = ev.status;
            s.meta.pr = { num: ev.status.num, url: ev.status.url, state: ev.status.state, draft: ev.status.draft };
          } else {
            s.pr = null;
          }
          break;
        case 'status':
          if (ev.status === 'idle' && s.running) effects.push([s.meta.id, settle(s, false, view)]);
          break;
        case 'notify':
          // Problems interrupt; info-level notices join the transcript instead.
          if (ev.level === 'error') toast.error(ev.message);
          else if (ev.level === 'warning') toast.warning(ev.message);
          else push(s, { kind: 'note', key: newKey(), text: ev.message }, view);
          break;
        case 'editor_text':
          effects.push([s.meta.id, { editorText: ev.text }]);
          break;
        case 'extension_error':
          toast.error(`Extension error: ${ev.error}`);
          break;
      }
      s = st.sessions[ev.sessionId];
    }
  });
  for (const [id, item] of recoveries) if (item.submission) drafts.recover(sessionDraftKey(id), item.submission);
  for (const [id, fx] of effects) runEffects(id, fx);
}

function runEffects(id: string, fx: Effects) {
  const s = getApp().sessions[id];
  if (!s) return;
  const isCur = getApp().current === id;
  if (fx.scheduleChanges) scheduleChanges(id);
  if (fx.refreshStats) void refreshStats(id);
  if (fx.prCreated) call('sessions:update', id, { pr: fx.prCreated }).catch(() => {});
  if (fx.editorText !== undefined) drafts.setText(sessionDraftKey(id), fx.editorText);
  // Away = another session is open, or the window is hidden / not in front.
  const away = !isCur || document.hidden || !document.hasFocus();
  if (fx.settled && away) {
    if (!isCur) updateSession(id, (x) => void (x.unread = true));
    call('app:notify', { title: s.meta.title, body: fx.settled.aborted ? 'Interrupted' : 'Pi Desktop finished', sessionId: id }).catch(() => {});
  }
  // A finished turn is the moment the user is likely to type again. An interrupted
  // run is not: there is no natural follow-up to guess.
  if (fx.settled && !fx.settled.aborted) void primeSuggestion(id);
  if (fx.waiting && away) {
    if (!isCur || document.hidden) toast.warning(`“${s.meta.title}” 需要你的确认`);
    call('app:notify', { title: s.meta.title, body: 'Needs your approval', sessionId: id }).catch(() => {});
  }
}

// ------------------------------------------------------------ boot

export async function bootstrap() {
  const [info, projects, sessions, folders, tasks] = await Promise.all([
    call('app:info'), call('projects:list'), call('sessions:list'), call('work:folders'), call('tasks:list'),
  ]);
  setApp((st) => {
    st.info = info;
    st.projects = projects;
    if (!projects.some((p) => p.path === st.prefs.project)) st.prefs.project = projects[0]?.path ?? null;
    for (const meta of sessions) {
      st.sessions[meta.id] = emptySession(meta);
      st.sessions[meta.id].running = meta.status === 'running';
    }
    st.workFolders = folders;
    st.tasks = tasks;
    const f = st.prefs.workFolder;
    if (f === undefined || (f && !folders.some((x) => x.path === f))) st.prefs.workFolder = folders[0]?.path ?? null;
  });
  // Reopen where the user left off instead of the new-session page.
  const last = read<string | null>('pd_last_session', null);
  const lastSession = last ? getApp().sessions[last] : undefined;
  if (lastSession && !lastSession.meta.archived) void openSession(last!);
  else showWelcome();
  await loadModels();
}

export async function loadModels() {
  try {
    const { models, defaultModel } = await call('models:list');
    const info = getApp().info;
    setApp((st) => {
      st.models = models;
      const ids = models.map((m) => `${m.provider}/${m.id}`);
      if (!st.prefs.model || !ids.includes(st.prefs.model)) {
        // Prefer a real model when one is configured; otherwise the offline demo model.
        const real = ids.find((i) => !i.startsWith('demo/'));
        st.prefs.model = info?.demo ? 'demo/demo-coder' : defaultModel && !defaultModel.startsWith('demo/') ? defaultModel : real || 'demo/demo-coder';
      }
    });
    const levels = await call('models:levels', getApp().prefs.model).catch(() => []);
    setApp((st) => void (st.levels = levels));
  } catch (err) {
    fail(err);
  }
}

// ------------------------------------------------------------ navigation

export function showCustomize() {
  setApp((st) => {
    st.customize = true;
    st.scheduled = false;
    st.archived = false;
    st.menu = null;
  });
}

export function showScheduled() {
  setApp((st) => {
    st.scheduled = true;
    st.customize = false;
    st.archived = false;
    st.menu = null;
  });
}

export function showArchived() {
  setApp((st) => {
    st.archived = true;
    st.customize = false;
    st.scheduled = false;
    st.menu = null;
  });
}

export function setView(view: SessionKind) {
  setApp((st) => {
    st.view = view;
    st.menu = null;
    st.customize = false;
    st.scheduled = false;
    st.archived = false;
  });
  try {
    localStorage.setItem('cc_mode', JSON.stringify(view));
  } catch {
    // Storage can be unavailable; the in-memory preference still applies.
  }
  const last = getApp().lastByView[view];
  const s = last ? getApp().sessions[last] : undefined;
  if (s && !s.meta.archived) void openSession(last!);
  else showWelcome();
}

export function showWelcome() {
  setApp((st) => {
    st.customize = false;
    st.scheduled = false;
    st.archived = false;
    st.current = null;
    st.lastByView[st.view] = null;
  });
  savePref('pd_last_session', null);
  activateDraftFor();
  void refreshImportable();
}

export async function openSession(id: string, fresh = false) {
  const s = getApp().sessions[id];
  if (!s) return;
  const view: SessionKind = s.meta.kind;
  // A session that moved on while it was closed opens at its newest message instead of
  // the place the user left it at; everything else returns to where they were.
  if (s.unread) forgetScroll(id);
  setApp((st) => {
    st.customize = false;
    st.scheduled = false;
    st.archived = false;
    st.current = id;
    st.view = view;
    // Starting a session is slow (extensions, MCP): show that it is happening instead of an empty page.
    if (!st.sessions[id].loaded && !st.sessions[id].setup) st.sessions[id].setup = [{ id: 'agent', label: '启动 Agent，加载扩展与工具', state: 'running' }];
    st.lastByView[view] = id;
    st.sessions[id].unread = false;
    if (st.sessions[id].detail?.type === 'file' && (st.sessions[id].detail as any).loading) st.sessions[id].detail = null;
  });
  try {
    localStorage.setItem('cc_mode', JSON.stringify(view));
  } catch {
    // Storage can be unavailable; the in-memory preference still applies.
  }
  savePref('pd_last_session', id);
  activateDraftFor();
  resumeSuggestion();
  if (s.loaded && !fresh) return;
  try {
    const r = await call('sessions:open', id);
    setApp((st) => {
      const x = st.sessions[id];
      if (!x) return;
      x.meta = r.meta;
      if (!fresh) replay(x, r.messages, st.prefs.viewMode);
      x.loaded = true;
      x.setup = null;
      // A new session is about to run its first message: the answer here predates it.
      if (!fresh) x.running = r.isStreaming;
      x.model = r.model;
      x.thinking = r.thinking;
      x.levels = r.levels;
      x.ctxPct = r.stats?.contextUsage?.percent ?? null;
      for (const req of r.pending) addUiRequest(x, req, st.prefs.viewMode);
    });
    call('sessions:commands', id).then((commands) => updateSession(id, (x) => void (x.commands = commands.filter((c) => !['desktop-mode', 'desktop-output-style'].includes(c.name))))).catch(() => {});
    if (s.meta.kind === 'code') void loadChanges(id);
  } catch (err) {
    setApp((st) => {
      const x = st.sessions[id];
      if (!x) return;
      x.setup = null;
      push(x, { kind: 'note', key: newKey(), level: 'error', text: `无法打开会话：${errText(err)}` }, st.prefs.viewMode);
    });
  }
}

// ------------------------------------------------------------ sending

/** Quote a passage of the conversation into the composer, ready to be answered. */
export function replyWith(sid: string, passage: string) {
  const key = sessionDraftKey(sid);
  const quote = passage.trim().split('\n').map((line) => `> ${line}`).join('\n');
  const current = getDraft(key).text;
  const text = current.trim() ? `${current.replace(/\s+$/, '')}\n\n${quote}\n\n` : `${quote}\n\n`;
  drafts.setText(key, text);
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLTextAreaElement>('textarea[data-composer-input]');
    el?.focus();
    el?.setSelectionRange(text.length, text.length);
  });
}

const HELP = () => `### Shortcuts
- \`↵\` 发送（运行中会插话）· \`${modKey}↵\` 排队到当前任务之后 · \`⇧↵\` 换行
- \`⇧Tab\` 切换模式 · \`Esc\` 中断
- \`${modKey}O\` 切换 transcript 视图（Normal / Thinking / Verbose）
- \`${modKey}K\` 搜索 · \`${modKey}B\` 侧边栏 · \`${modKey}D\` Diff
- 输入 \`@\` 引用文件 · \`/btw\` 旁路提问 · 选中回复内容可「Send side chat」或「Reply」`;

async function slashCommand(s: SessionView | undefined, head: string, text: string): Promise<boolean> {
  const key = activeDraft()?.key;
  const clear = () => key && drafts.clear(key);
  if (head === '/model' || head === '/permissions') {
    clear();
    setApp((st) => void (st.menu = head === '/model' ? 'model' : 'mode'));
    return true;
  }
  if (head === '/btw') {
    if (!s) {
      toast.warning('先开始一个会话');
      return true;
    }
    clear();
    const question = text.trim().slice(head.length).trim();
    // Without a question it only opens the panel, with whatever passage is staged.
    if (question) askSide(s.meta.id, question).catch(fail);
    else showSide(s.meta.id);
    return true;
  }
  if (head === '/help') {
    clear();
    if (!s) {
      toast.warning('先开始一个会话');
      return true;
    }
    const lines = [...DESKTOP_COMMANDS, ...s.commands.map((c) => [`/${c.name}`, c.description || c.source] as [string, string])];
    pushItem(s.meta.id, { kind: 'text', key: newKey(), text: `### Commands\n${lines.map(([k, d]) => `- \`${k}\` ${d}`).join('\n')}\n\n${HELP()}`, live: false });
    return true;
  }
  if (!s || !['/clear', '/compact', '/context', '/export'].includes(head)) return false;
  clear();
  const id = s.meta.id;
  try {
    if (head === '/clear') {
      await call('sessions:newContext', id);
      updateSession(id, (x) => {
        x.items = [];
        x.todosKey = null;
        x.ctxPct = 0;
      });
    } else if (head === '/compact') {
      await compactSession(id, text.slice(head.length).trim() || undefined);
    } else if (head === '/context') {
      setApp((st) => void (st.menu = 'context'));
    } else if (head === '/export') {
      await exportHtml(id);
    }
  } catch (err) {
    fail(err);
  }
  return true;
}

/** Summarise older messages to free context (/compact, or the context popover). */
export async function compactSession(id: string, instructions?: string) {
  updateSession(id, (x) => void (x.statusText = 'Compacting…'));
  const r = await call('sessions:compact', id, instructions);
  pushItem(id, { kind: 'note', key: newKey(), text: `Compacted · ${fmtTok(r.tokensBefore)} → ~${fmtTok(r.estimatedTokensAfter ?? 0)} tokens` });
  void refreshStats(id);
}

function pushItem(id: string, item: Item) {
  setApp((st) => {
    const s = st.sessions[id];
    if (s) push(s, item, st.prefs.viewMode);
  });
}

/** Write the transcript to an HTML file and note the path in the conversation. */
export async function exportHtml(id: string) {
  try {
    const { path } = await call('sessions:exportHtml', id);
    pushItem(id, { kind: 'note', key: newKey(), text: `Exported to ${path}` });
  } catch (err) {
    fail(err);
  }
}

async function createSession(firstPrompt: string, draftKey: string) {
  const st = getApp();
  const work = st.view === 'work';
  const meta = await call('sessions:create', {
    kind: work ? 'work' : 'code',
    projectPath: work ? st.prefs.workFolder || null : st.prefs.project,
    worktree: !work && st.prefs.worktree,
    adoptPath: !work && st.adopt && st.adopt.mainRoot === st.prefs.project ? st.adopt.path : undefined,
    baseRef: !work && st.prefs.worktree && st.baseRef && st.baseRef !== st.projectBranch ? st.baseRef : undefined,
    title: firstPrompt.replace(/@\S+/g, '').trim().slice(0, 60) || 'New session',
    autoName: true,
    model: st.prefs.model,
    thinking: st.prefs.effort,
    mode: st.prefs.mode,
    outputStyle: st.prefs.outputStyle,
  });
  setApp((x) => {
    x.sessions[meta.id] ??= emptySession(meta);
    x.sessions[meta.id].meta = meta;
    x.sessions[meta.id].loaded = true;
    x.sessions[meta.id].model = st.prefs.model;
    x.sessions[meta.id].levels = st.levels;
    // The worktree and the agent come up in the background; the conversation opens straight away.
    x.sessions[meta.id].setup = [
      ...(meta.worktreeSetup ? [{ id: 'worktree' as const, label: `创建 git worktree（${meta.branch}）`, state: 'running' as const }] : []),
      { id: 'agent', label: '启动 Agent，加载扩展与工具', state: meta.worktreeSetup ? 'pending' : 'running' },
    ];
    x.adopt = null;
    x.baseRef = null;
  });
  const active = useDrafts.getState().active === draftKey;
  drafts.rekey(draftKey, sessionDraftKey(meta.id));
  if (active) void openSession(meta.id, true);
  return meta;
}

/** Send the active draft: a prompt, a steer while running, or a queued follow-up. */
export async function send(queueOnly = false) {
  const draft = activeDraft();
  if (!draft || draft.sending) return;
  if (draft.preparing) return void toast.warning('等待附件处理完成后再发送');
  const text = draft.text;
  const files = draft.attachments.slice();
  const references = draft.references.slice();
  let s = currentSession();
  if (s?.stopping || s?.historyBusy) return;
  if (!text.trim() && !files.length && !references.length) {
    if (s?.running) void stop(s.meta.id);
    return;
  }
  const head = text.trim().split(/\s+/)[0];
  if ((files.length || references.length) && head.startsWith('/')) return void toast.warning('斜杠命令不能携带附件或上下文；请先移除或使用普通消息');
  if (await slashCommand(s, head, text)) return;

  const st = getApp();
  if (!s && st.view === 'code' && !st.prefs.project) return void toast.warning('先选择一个项目');
  let key = draft.key;
  drafts.lock(key, true);
  if (!s) {
    try {
      const meta = await createSession(text || files[0]?.name || 'Attachments', key);
      key = sessionDraftKey(meta.id);
      s = getApp().sessions[meta.id];
    } catch (err) {
      drafts.lock(key, false);
      return void drafts.error(key, err);
    }
  }
  const id = s!.meta.id;
  const epoch = s!.hostEpoch;
  const clientId = crypto.randomUUID();
  const submission = { text, attachments: files, references, clientId };
  const payload = { text: referencePrompt(text, references), attachments: files, clientId };
  let wire: string;
  try {
    wire = buildMessage(payload).message;
  } catch (err) {
    drafts.lock(key, false);
    return void drafts.error(key, err);
  }
  const wasRunning = !!getApp().sessions[id]?.running;
  const itemKey = newKey();
  const optimistic = !wasRunning && !text.startsWith('/');
  setApp((x) => {
    const v = x.sessions[id];
    if (!v) return;
    push(v, { kind: 'user', key: itemKey, text: payload.text, attachments: files, clientId, submission, wire, queued: wasRunning, acknowledged: false }, x.prefs.viewMode);
    v.pendingUser.push(itemKey);
    if (optimistic) {
      v.running = true;
      v.t0 = Date.now();
      v.tokens = 0;
      v.todosKey = null;
      v.statusText = 'Thinking…';
    }
  });
  const item = () => findByKey(getApp().sessions[id], itemKey) as (Item & { kind: 'user' }) | undefined;
  const removeUser = () => updateSession(id, (v) => {
    v.pendingUser = v.pendingUser.filter((k) => k !== itemKey);
    v.items = v.items.filter((i) => i.key !== itemKey);
  });
  try {
    const r = await call('sessions:prompt', id, payload, queueOnly ? 'followUp' : 'steer');
    if (item()?.exited || getApp().sessions[id]?.hostEpoch !== epoch) {
      drafts.error(key, '进程已退出，发送状态未确认；草稿已保留，请核对历史后再发送');
      return;
    }
    updateSession(id, (v) => {
      const u = findByKey(v, itemKey);
      if (u?.kind === 'user') u.acknowledged = true;
    });
    drafts.clear(key);
    if (r.disposition === 'handled') {
      removeUser();
      if (optimistic) updateSession(id, (v) => void (v.running = false));
    }
  } catch (err) {
    const u = item();
    if (u?.delivered) drafts.clear(key);
    else if (u?.exited || getApp().sessions[id]?.hostEpoch !== epoch) drafts.error(key, '进程已退出，发送状态未确认；草稿已保留，请核对历史后再发送');
    else if (/exited|closed|timeout|timed out|terminated/i.test(errText(err))) {
      updateSession(id, (v) => {
        const x = findByKey(v, itemKey);
        if (x?.kind === 'user') Object.assign(x, { failed: true, queued: false });
      });
      drafts.error(key, '发送状态未确认，请核对会话后再重试，避免重复发送');
    } else {
      removeUser();
      drafts.error(key, err);
    }
    if (optimistic) updateSession(id, (v) => void (v.running = false));
  } finally {
    drafts.lock(key, false);
  }
}

/** Stop the run; queued messages come back to the draft. */
export async function stop(id: string) {
  const s = getApp().sessions[id];
  if (!s || s.stopping || !s.running) return;
  const epoch = s.hostEpoch;
  updateSession(id, (v) => {
    v.stopping = true;
    v.statusText = 'Stopping…';
  });
  try {
    const q = await call('sessions:clearQueue', id);
    for (const wire of [...q.steering, ...q.followUp]) {
      const decoded = decodeUserContent(wire);
      const v = getApp().sessions[id];
      const p = v?.pendingUser.map((k) => findByKey(v, k)).find((i): i is Item & { kind: 'user' } => i?.kind === 'user' && (decoded.clientId ? i.clientId === decoded.clientId : i.wire === wire));
      const snapshot = p?.submission ?? { text: decoded.text, attachments: decoded.attachments.filter((a): a is any => a.kind === 'file' || !!(a as any).data) };
      if (p) updateSession(id, (x) => {
        x.pendingUser = x.pendingUser.filter((k) => k !== p.key);
        x.items = x.items.filter((i) => i.key !== p.key);
      });
      drafts.recover(sessionDraftKey(id), snapshot);
    }
    if (getApp().sessions[id]?.hostEpoch === epoch) await call('sessions:abort', id);
  } catch (err) {
    if (getApp().sessions[id]?.hostEpoch === epoch) fail(err);
  } finally {
    updateSession(id, (v) => void (v.stopping = false));
  }
}

// ------------------------------------------------------------ questions

export function answerUi(id: string, itemKey: string, response: UiResponse, label: string) {
  const s = getApp().sessions[id];
  const item = findByKey(s, itemKey);
  if (!item || !('requestId' in item) || !item.requestId) return;
  const requestId = item.requestId;
  updateSession(id, (v) => resolveUi(v, requestId, label));
  call('sessions:respond', id, requestId, response).catch(fail);
}

// ------------------------------------------------------------ session settings

export function setPermMode(mode: PermissionMode) {
  const s = currentSession();
  if (s) {
    updateSession(s.meta.id, (v) => void (v.meta.mode = mode));
    call('sessions:setMode', s.meta.id, mode).catch(fail);
  } else setPref('mode', mode);
}
export function cycleMode() {
  const s = currentSession();
  const cur = s?.meta.mode ?? getApp().prefs.mode;
  const i = MODES.findIndex((m) => m.id === cur);
  setPermMode(MODES[(i + 1) % MODES.length].id);
}

export function setViewMode(view: ViewMode) {
  setPref('viewMode', view);
  setApp((st) => {
    for (const s of Object.values(st.sessions)) applyViewMode(s, view);
  });
}
export function cycleViewMode() {
  const s = currentSession();
  const modes = VIEW_MODES.filter((m) => m.id !== 'thinking' || hasThinking(s));
  const at = modes.findIndex((m) => m.id === getApp().prefs.viewMode);
  setViewMode((modes[at + 1] ?? modes[0]).id);
}

export function setOutputStyle(style: OutputStyle) {
  setPref('outputStyle', style);
  const s = currentSession();
  if (s) {
    updateSession(s.meta.id, (v) => void (v.meta.outputStyle = style));
    call('sessions:setStyle', s.meta.id, style).catch(fail);
  }
}

export async function chooseModel(id: string) {
  const s = currentSession();
  if (s) {
    try {
      const r = await call('sessions:setModel', s.meta.id, id);
      updateSession(s.meta.id, (v) => {
        v.model = id;
        v.levels = r.levels;
        v.thinking = r.thinking;
      });
    } catch (err) {
      fail(err);
    }
    return;
  }
  setPref('model', id);
  const levels = await call('models:levels', id).catch(() => []);
  setApp((st) => void (st.levels = levels));
}

export async function chooseEffort(level: ThinkingLevel) {
  const s = currentSession();
  if (s) {
    try {
      await call('sessions:setThinking', s.meta.id, level);
      updateSession(s.meta.id, (v) => void (v.thinking = level));
    } catch (err) {
      fail(err);
    }
  } else setPref('effort', level);
}

export async function renameSession(id: string) {
  const s = getApp().sessions[id];
  if (!s) return;
  const title = await dialogs.prompt('Rename session', s.meta.title, { action: 'Save' });
  if (!title?.trim()) return;
  try {
    const meta = await call('sessions:update', id, { title });
    updateSession(id, (v) => void (v.meta = meta));
  } catch (err) {
    fail(err);
  }
}

/** Archive keeps the conversation and any worktree on disk; the sidebar just stops listing it. */
export async function archiveSession(id: string) {
  const s = getApp().sessions[id];
  if (!s) return;
  try {
    await call('sessions:archive', id);
    updateSession(id, (v) => {
      v.meta.archived = true;
      v.loaded = false;
      v.running = false;
      v.setup = null;
    });
    if (getApp().current === id) showWelcome();
    toast(`已归档“${s.meta.title}”`, { action: { label: '撤销', onClick: () => void unarchiveSession(id) } });
  } catch (err) {
    fail(err);
  }
}

export async function unarchiveSession(id: string) {
  try {
    const meta = await call('sessions:unarchive', id);
    updateSession(id, (v) => void (v.meta = meta));
  } catch (err) {
    fail(err);
  }
}

/** Forget a session: the sidebar, its conversation file and the worktree Pi Desktop made for it. */
function dropSession(id: string) {
  if (getApp().current === id) showWelcome();
  forgetPanels(id);
  forgetScroll(id);
  setApp((st) => {
    delete st.sessions[id];
    for (const view of ['code', 'work'] as const) if (st.lastByView[view] === id) st.lastByView[view] = null;
  });
}

export async function deleteSession(id: string) {
  const s = getApp().sessions[id];
  if (!s) return;
  try {
    const lost = await call('sessions:inspect', id);
    const lines = ['对话记录会被删除；项目里的文件不受影响。'];
    if (lost.worktree) {
      lines.push(`它的 git worktree 也会被删除：${lost.worktree}`);
      if (lost.dirty) lines.push(`其中 ${lost.dirty} 个文件有未提交的改动，会一并丢失。`);
      if (lost.unpushed) lines.push(`分支 ${lost.branch} 上有 ${lost.unpushed} 个未推送的提交；分支会保留，提交不会丢。`);
    }
    if (!(await dialogs.confirm(`删除“${s.meta.title}”？`, lines.join('\n'), 'Delete', true))) return;
    const removed = await call('sessions:remove', id);
    dropSession(id);
    if (removed.branchKept) toast(`分支 ${removed.branchKept} 已保留，里面有只存在于它的提交`);
  } catch (err) {
    fail(err);
  }
}

export async function userMessageAction(id: string, entryId: string, action: 'rewind' | 'fork') {
  const s = getApp().sessions[id];
  if (!s || s.running || s.historyBusy || s.pendingUser.length) return;
  updateSession(id, (view) => void (view.historyBusy = true));
  try {
    const result = await call('sessions:messageAction', id, entryId, action);
    const { session, draft } = result;
    setApp((st) => {
      const target = st.sessions[session.meta.id] ??= emptySession(session.meta);
      target.meta = session.meta;
      replay(target, session.messages, st.prefs.viewMode);
      target.loaded = true;
      target.running = session.isStreaming;
      target.model = session.model;
      target.thinking = session.thinking;
      target.levels = session.levels;
      target.ctxPct = session.stats?.contextUsage?.percent ?? null;
    });
    const attachments = draft.attachments.filter((attachment): attachment is Attachment => attachment.kind === 'file' || typeof attachment.data === 'string');
    drafts.recover(sessionDraftKey(session.meta.id), { text: draft.text, attachments, label: action === 'rewind' ? '回退的消息' : '分支起点' });
    if (draft.notice) drafts.error(sessionDraftKey(session.meta.id), draft.notice);
    // Navigate only if the user has stayed on the source session during the request.
    if (getApp().current === id) await openSession(session.meta.id);
  } catch (err) {
    fail(err);
  } finally {
    updateSession(id, (view) => void (view.historyBusy = false));
  }
}

export async function forkSession(id: string) {
  try {
    await call('sessions:clone', id);
  } catch (err) {
    fail(err);
  }
}

// ------------------------------------------------------------ panels, files, git

export function togglePanel(id: string, panel: keyof Panels, open?: boolean) {
  updateSession(id, (v) => void (v.panels[panel] = open ?? !v.panels[panel]));
  const s = getApp().sessions[id];
  // The layout belongs to the session: coming back to it should look the way it was left.
  if (s) writePanels(id, s.panels);
  if (panel === 'diff' && s?.panels.diff) {
    void loadChanges(id);
    void loadPrThreads(id);
  }
  if (panel === 'files' && s?.panels.files && !s.files) void loadFiles(id);
}

/** Blow one card up over the whole workspace, or put it back — remembered per session. */
export function expandCard(id: string, card: CardId | null) {
  updateSession(id, (v) => void (v.expanded = card));
}

export function closeDetail(id: string) {
  updateSession(id, (v) => void (v.detail = null));
}
export function openPlan(id: string, key: string) {
  updateSession(id, (v) => void (v.detail = { type: 'plan', key }));
}
export function openAgent(id: string, toolCallId: string) {
  updateSession(id, (v) => void (v.detail = { type: 'agent', toolCallId }));
}

/** Stop one background subagent; the turn goes on without its report. */
export async function stopTask(id: string, toolCallId: string) {
  try {
    if (!(await call('sessions:stopTask', id, toolCallId))) toast.warning('This task has already finished');
  } catch (err) {
    fail(err);
  }
}

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|bmp)$/i;

let fileRequest = 0;
/**
 * Show the current contents of a session file in the detail panel, at a line.
 * Images show as images; `fallbackImage` (what a read tool returned) covers files outside the session.
 */
export async function openFileRef(path: string, line?: number, fallbackImage?: string) {
  const s = currentSession();
  if (!s) return;
  const id = s.meta.id;
  const rel = relPath(s.meta.cwd, path);
  const request = ++fileRequest;
  const target = positiveLine(line);
  updateSession(id, (v) => void (v.detail = { type: 'file', path: rel, line: target, loading: true }));
  const stillShowing = () => {
    const d = getApp().sessions[id]?.detail;
    return request === fileRequest && getApp().current === id && d?.type === 'file' && d.path === rel;
  };
  try {
    if (IMAGE_FILE.test(rel) || fallbackImage) {
      const image = (await call('sessions:readImage', id, rel).catch(() => null))?.src ?? fallbackImage ?? null;
      if (stillShowing()) updateSession(id, (v) => void (v.detail = { type: 'file', path: rel, line: target, loading: false, image }));
      return;
    }
    const text = await call('sessions:readFile', id, rel);
    if (stillShowing()) updateSession(id, (v) => void (v.detail = { type: 'file', path: rel, line: target, loading: false, text }));
  } catch (err) {
    if (stillShowing()) updateSession(id, (v) => void (v.detail = { type: 'file', path: rel, line: target, loading: false, error: errText(err) }));
  }
}
export function setFileWindow(id: string, start: number) {
  updateSession(id, (v) => {
    if (v.detail?.type === 'file') v.detail.start = start;
  });
}

/** Open the Diff panel scrolled to one file, or to the first PR review thread (`thread`). */
export const diffTarget = { path: null as string | null, thread: false, seq: 0 };
export function openDiffRef(path: string) {
  const s = currentSession();
  if (!s) return;
  diffTarget.path = relPath(s.meta.cwd, path);
  diffTarget.seq++;
  togglePanel(s.meta.id, 'diff', true);
}
/** The PR bar's size chip: just show the diff. */
export function openDiffPanel() {
  const s = currentSession();
  if (s) togglePanel(s.meta.id, 'diff', true);
}
/** The PR bar's comment chip: land on the first review comment in the diff, focused and flashing. */
export async function openPrComments() {
  const s = currentSession();
  if (!s) return;
  const id = s.meta.id;
  await loadPrThreads(id);
  const now = getApp().sessions[id];
  if (!now?.prThreads.length) {
    // Conversation comments and review summaries have no line in the diff: GitHub is where they live.
    if (now?.pr) void call('app:openExternal', now.pr.url);
    return;
  }
  diffTarget.thread = true;
  diffTarget.seq++;
  togglePanel(id, 'diff', true);
}

export async function loadPrThreads(id: string) {
  const s = getApp().sessions[id];
  if (!s || isWork(s) || !s.pr) return;
  try {
    const prThreads = await call('sessions:prThreads', id);
    updateSession(id, (v) => void (v.prThreads = prThreads));
  } catch {
    // Without gh the diff simply has no comments.
  }
}

const changeTimers = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleChanges(id: string) {
  clearTimeout(changeTimers.get(id));
  changeTimers.set(id, setTimeout(() => void loadChanges(id), 250));
}
export async function loadChanges(id: string) {
  const s = getApp().sessions[id];
  if (!s || isWork(s)) return;
  try {
    const { files, state } = await call('sessions:changes', id);
    const changes = files.map((f) => ({ ...f, ...(f.binary ? { add: 0, del: 0 } : changeStats(f.path, f.before, f.status === 'D' ? null : f.after)) }));
    updateSession(id, (v) => {
      // Panels are the user's: a new change must not rearrange their workspace.
      v.changes = changes;
      v.gitState = state;
    });
  } catch {
    // The diff panel simply keeps its previous contents when a refresh fails.
  }
}

export async function loadFiles(id: string, force = false) {
  const s = getApp().sessions[id];
  if (!s || (s.files && !force)) return;
  try {
    const files = await call('sessions:files', id);
    updateSession(id, (v) => void (v.files = files));
  } catch (err) {
    fail(err);
  }
}

export async function refreshStats(id: string) {
  try {
    const st = await call('sessions:stats', id);
    if (st?.contextUsage?.percent != null) updateSession(id, (v) => void (v.ctxPct = st.contextUsage!.percent));
  } catch {
    // Context usage is cosmetic; keep the last known percentage.
  }
}

/** The CI panel's switches; the host's PR watcher picks them up and does the rest. */
export async function setPrAuto(id: string, patch: { fixCi?: boolean; merge?: boolean }) {
  try {
    const meta = await call('sessions:update', id, { prAuto: patch });
    updateSession(id, (v) => void (v.meta = meta));
  } catch (err) {
    fail(err);
  }
}

/** A command typed in the terminal panel; its output joins the next turn's context. */
export async function runTerminal(id: string, cmd: string) {
  const index = getApp().sessions[id]?.term.length ?? 0;
  updateSession(id, (v) => void v.term.push({ cmd, out: '…' }));
  let out: string;
  try {
    const r = await call('sessions:bash', id, cmd);
    out = r.output + (r.exitCode ? `\nCommand exited with code ${r.exitCode}` : '');
  } catch (err) {
    out = errText(err);
  }
  updateSession(id, (v) => {
    if (v.term[index]) v.term[index].out = out;
  });
  scheduleChanges(id);
}

// ------------------------------------------------------------ projects and folders

export function selectProject(path: string) {
  if (getApp().prefs.project !== path) setApp((st) => void (st.baseRef = null));
  setPref('project', path);
  // An adopted worktree belongs to the project it came with.
  if (getApp().adopt && getApp().adopt!.mainRoot !== path) setApp((st) => void (st.adopt = null));
  if (!getApp().current) activateDraftFor();
  void refreshImportable();
}

export async function addProject() {
  try {
    const added = await call('projects:add');
    if (!added) return;
    let project = added.kind === 'added' ? added.project : null;
    let adopt = null;
    if (added.kind === 'worktree') {
      const { info } = added;
      const main = fname(info.mainRoot);
      const choice = await dialogs.choose(`“${fname(info.path)}”是 ${main} 的 worktree`, [
        { label: `作为 ${main} 项目下的新会话`, hint: `直接在这个 worktree（${info.branch ?? '游离 HEAD'}）里工作，不再另建 worktree${added.known ? '' : `；同时把 ${main} 添加为项目`}` },
        { label: '作为独立项目添加', hint: '把这个文件夹当成一个单独的项目' },
      ]);
      if (choice === null) return;
      const result = await call('projects:adoptWorktree', choice === 0 ? 'session' : 'project');
      if (!result) return;
      project = result.project;
      adopt = result.adopt;
    }
    if (!project) return;
    const projects = await call('projects:list');
    setApp((st) => void (st.projects = projects));
    selectProject(project.path);
    setApp((st) => void (st.adopt = adopt));
  } catch (err) {
    fail(err);
  }
}

/** Take a project out of Pi Desktop's list. The folder stays; its sessions are archived, not deleted. */
export async function removeProject(path: string) {
  const sessions = Object.values(getApp().sessions).filter((s) => s.meta.kind === 'code' && s.meta.projectPath === path && !s.meta.archived);
  const note = sessions.length ? `它的 ${sessions.length} 个会话会被归档，之后可以在 Archived sessions 里找回。` : '';
  if (!(await dialogs.confirm(`从 Pi Desktop 移除“${fname(path)}”？`, `文件夹和里面的文件都不会被删除。${note}`, 'Remove', true))) return;
  try {
    for (const s of sessions) {
      await call('sessions:archive', s.meta.id);
      updateSession(s.meta.id, (v) => {
        v.meta.archived = true;
        v.loaded = false;
        v.running = false;
      });
    }
    const projects = await call('projects:remove', path);
    const cur = currentSession();
    if (cur && cur.meta.projectPath === path) showWelcome();
    setApp((st) => {
      st.projects = projects;
      if (st.prefs.project === path) st.prefs.project = null;
      if (st.adopt?.mainRoot === path) st.adopt = null;
    });
    if (!getApp().prefs.project) setPref('project', projects[0]?.path ?? null);
    void refreshImportable();
  } catch (err) {
    fail(err);
  }
}

// ------------------------------------------------------------ suggested tasks

const keyOf = (item: { toolCallId: string }, index: number) => `${item.toolCallId}:${index}`;

/** Run a suggested task in a new session of the same project; the user stays where they are. */
export async function startSuggested(sid: string, item: { toolCallId: string }, index: number, task: SpawnTask) {
  try {
    const meta = await call('sessions:spawn', sid, task, keyOf(item, index));
    setApp((st) => void (st.sessions[meta.id] ??= emptySession(meta)));
    toast.success(`已在新会话中开始：${meta.title}`, { action: { label: '打开', onClick: () => void openSession(meta.id) } });
  } catch (err) {
    fail(err);
  }
}

/** Hand a suggested task to the session that suggested it. */
export async function doSuggestedHere(sid: string, item: { toolCallId: string }, index: number, task: SpawnTask) {
  try {
    const meta = await call('sessions:update', sid, { suggestion: { key: keyOf(item, index), state: 'here' } });
    updateSession(sid, (v) => void (v.meta = meta));
    const busy = !!getApp().sessions[sid]?.running;
    await call('sessions:prompt', sid, { text: task.prompt, attachments: [], clientId: crypto.randomUUID() }, busy ? 'followUp' : 'steer');
  } catch (err) {
    fail(err);
  }
}

export async function dismissSuggested(sid: string, item: { toolCallId: string }, index: number) {
  try {
    const meta = await call('sessions:update', sid, { suggestion: { key: keyOf(item, index), state: 'dismissed' } });
    updateSession(sid, (v) => void (v.meta = meta));
  } catch (err) {
    fail(err);
  }
}

export async function refreshImportable() {
  const project = getApp().prefs.project;
  if (!project || getApp().view !== 'code') return setApp((st) => void ((st.importable = []), (st.projectBranch = null), (st.projectBranches = []), (st.baseRef = null)));
  const [list, branch, branches] = await Promise.all([
    call('sessions:importable', project).catch(() => []),
    call('git:branch', project).catch(() => null),
    call('git:branches', project).catch(() => [] as string[]),
  ]);
  setApp((st) => {
    st.importable = list;
    st.projectBranch = branch && branch !== 'HEAD' ? branch : null;
    st.projectBranches = branches;
    // A choice made for another project (or a branch that is gone) does not carry over.
    if (st.baseRef && !branches.includes(st.baseRef)) st.baseRef = null;
  });
}

export async function importCliSession() {
  const list = getApp().importable;
  if (!list.length) return;
  const index = list.length === 1 ? 0 : await dialogs.choose('Import a pi CLI session', list.map((s) => ({ label: s.name || s.firstPrompt?.slice(0, 60) || s.id, hint: new Date(s.mtime).toLocaleString() })));
  if (index == null) return;
  try {
    const meta: SessionMeta = await call('sessions:import', list[index].file);
    setApp((st) => void (st.sessions[meta.id] = emptySession(meta)));
    await openSession(meta.id);
    void refreshImportable();
  } catch (err) {
    fail(err);
  }
}

export function setWorkFolder(folder: string | null) {
  setPref('workFolder', folder);
  if (folder) call('work:useFolder', folder).catch(() => {});
  if (!getApp().current) activateDraftFor();
}

export async function addWorkFolder() {
  try {
    const folder = await call('work:addFolder');
    if (!folder) return;
    const folders = await call('work:folders');
    setApp((st) => void (st.workFolders = folders));
    setWorkFolder(folder.path);
  } catch (err) {
    fail(err);
  }
}

export function toggleSidebar(collapsed?: boolean) {
  const next = collapsed ?? !getApp().sidebarCollapsed;
  setApp((st) => void (st.sidebarCollapsed = next));
  try {
    localStorage.setItem('cc_collapsed', JSON.stringify(next));
  } catch {
    // Storage can be unavailable; the main process stores the real setting.
  }
  call('settings:set', { sidebarCollapsed: next }).catch(() => {});
}

export { getDraft };
