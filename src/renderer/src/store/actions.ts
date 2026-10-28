// Everything the UI does: navigation, sending, session settings, panels. State lives
// in the app store; pi events are folded in by transcript.ts.
import { toast } from 'sonner';
import { buildMessage, decodeUserContent, type Attachment } from '@shared/attachments';
import type { HostEvent, OutputStyle, PermissionMode, PrThread, SessionKind, SessionMeta, SpawnTask, ThinkingLevel, UiResponse, WorkProjectPatch } from '@shared/protocol';
import { referencePrompt, type ContextReference } from '@shared/context-reference';
import { cacheHitRate } from '@shared/usage';
import { revealItem } from '@/lib/quote-links';
import { positiveLine } from '@shared/tool-previews';
import { encodeTaskMessage } from '@shared/task-message';
import { typedText } from '@shared/skill-message';
import { call, errText, modKey } from '@/lib/api';
import { t } from '@/lib/i18n';
import { cuePet } from '@/lib/pet-cue';
import { playSound } from '@/lib/sounds';
import { COMPACT_WINDOW_WIDTH, desktopCommands, MODES, VIEW_MODES, type ViewMode } from '@/lib/constants';
import { fname, relPath } from '@/lib/format';
import { currentSession, getApp, isWork, read, savePref, setApp, setPref, updateSession, type AppState } from './app';
import { dialogs } from './dialogs';
import { activeDraft, drafts, getDraft, sessionDraftKey, useDrafts } from './drafts';
import { forgetPanels, writeArrangement, writePanels } from './layout';
import { primeSuggestion, resumeSuggestion } from './predict';
import { forgetScroll } from './scroll';
import { askSide, showSide } from './side';
import {
  addOutputs, addUiRequest, applyPiEvent, applyTaskUpdate, applyViewMode, emptySession, findByKey, hasThinking, newKey, push, replay, resolveUi, settle, transcriptItems, type Effects,
} from './transcript';
import type { Arrangement, CardId, ChangedFile, Column, DropPlace, Item, ItemOf, Panels, SessionView } from './types';

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
  if (ev.type === 'remote_link') {
    const was = getApp().remote?.state;
    setApp((st) => void (st.remote && (st.remote.state = ev.state)));
    // Events were missed while the link was down: reload what the host holds.
    if (ev.state === 'connected' && was && was !== 'connected') void resyncRemote();
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
      if (ev.type === 'auth_prompt' || ev.type === 'auth_event' || ev.type === 'models_changed' || ev.type === 'remote_link' || ev.type === 'terminal_data' || ev.type === 'terminal_exit') continue;
      if (ev.type === 'host_exit') {
        for (const s of Object.values(st.sessions)) {
          if (s.running) settle(s, true, view);
          s.hostEpoch++;
          s.loaded = false;
          s.compacting = false;
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
          push(cur, { kind: 'note', key: newKey(), level: 'error', text: `${t('act.hostExit', { code: String(ev.code) })}${tail ? `\n${tail}` : ''}` }, view);
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
        case 'git_fetched':
          effects.push([s.meta.id, { scheduleChanges: true }]);
          break;
        case 'status':
          if (ev.status === 'idle' && s.running) effects.push([s.meta.id, settle(s, false, view)]);
          break;
        case 'notify':
          // Problems interrupt; info-level notices join the transcript instead.
          if (ev.level === 'error') {
            toast.error(ev.message);
            playSound('error');
            cuePet('error');
          } else if (ev.level === 'warning') toast.warning(ev.message);
          else push(s, { kind: 'note', key: newKey(), text: ev.message }, view);
          break;
        case 'session_outputs':
          addOutputs(s, ev.files);
          break;
        case 'editor_text':
          effects.push([s.meta.id, { editorText: ev.text }]);
          break;
        case 'extension_error':
          toast.error(t('act.extensionError', { error: ev.error }));
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
  if (fx.pruneOutputs && isWork(s)) void pruneOutputs(id);
  if (fx.prCreated) call('sessions:update', id, { pr: fx.prCreated }).catch(() => {});
  if (fx.editorText !== undefined) drafts.setText(sessionDraftKey(id), fx.editorText);
  if (fx.settled && !fx.settled.aborted) {
    playSound('done');
    cuePet('done');
  }
  if (fx.waiting) playSound('ask');
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
    if (!isCur || document.hidden) toast.warning(t('act.needsApproval', { title: s.meta.title }));
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

/** After the link to a remote host came back: its sessions moved on without us, so read them again. */
async function resyncRemote() {
  try {
    const [sessions, projects, folders] = await Promise.all([call('sessions:list'), call('projects:list'), call('work:folders')]);
    setApp((st) => {
      st.projects = projects;
      st.workFolders = folders;
      for (const meta of sessions) {
        const known = st.sessions[meta.id];
        if (!known) {
          st.sessions[meta.id] = emptySession(meta);
          st.sessions[meta.id].running = meta.status === 'running';
          continue;
        }
        known.meta = meta;
        known.running = meta.status === 'running';
        known.compacting = false;
        known.loaded = false;
      }
    });
    const cur = getApp().current;
    if (cur && getApp().sessions[cur]) await openSession(cur);
    await loadModels();
  } catch (err) {
    fail(err);
  }
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
    st.activity = false;
    st.artifacts = false;
    st.workProjects = false;
    st.menu = null;
  });
}

export function showScheduled() {
  setApp((st) => {
    st.scheduled = true;
    st.customize = false;
    st.archived = false;
    st.activity = false;
    st.artifacts = false;
    st.workProjects = false;
    st.menu = null;
  });
}

export function showActivity() {
  setApp((st) => {
    st.activity = true;
    st.artifacts = false;
    st.workProjects = false;
    st.archived = false;
    st.customize = false;
    st.scheduled = false;
    st.menu = null;
  });
}

export function showProjects(path: string | null = null) {
  setApp((st) => {
    st.workProjects = true;
    st.openProject = path;
    st.artifacts = false;
    st.archived = false;
    st.activity = false;
    st.customize = false;
    st.scheduled = false;
    st.menu = null;
  });
}

export function showArtifacts() {
  setApp((st) => {
    st.artifacts = true;
    st.workProjects = false;
    st.archived = false;
    st.activity = false;
    st.customize = false;
    st.scheduled = false;
    st.menu = null;
  });
}

export function showArchived() {
  setApp((st) => {
    st.archived = true;
    st.activity = false;
    st.artifacts = false;
    st.workProjects = false;
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
    st.activity = false;
    st.artifacts = false;
    st.workProjects = false;
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
    st.activity = false;
    st.artifacts = false;
    st.workProjects = false;
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
    st.activity = false;
    st.artifacts = false;
    st.workProjects = false;
    st.current = id;
    st.view = view;
    // Starting a session is slow (extensions, MCP): show that it is happening instead of an empty page.
    if (!st.sessions[id].loaded && !st.sessions[id].setup) st.sessions[id].setup = [{ id: 'agent', label: t('act.stepAgent'), state: 'running' }];
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
      if (!fresh) {
        replay(x, r.messages, st.prefs.viewMode);
        // The reopened transcript starts at the summary; the messages it replaced are loaded on demand.
        markCompactionHistory(x, r.hiddenMessages);
      }
      x.loaded = true;
      x.setup = null;
      x.compacting = r.isCompacting;
      // A new session is about to run its first message: the answer here predates it.
      if (!fresh) x.running = r.isStreaming;
      // The run began before this window opened the session: count from the message that started it.
      if (x.running && !x.t0) {
        const started = x.items.findLast((i): i is ItemOf<'user'> => i.kind === 'user');
        x.t0 = started?.timestamp ?? Date.now();
      }
      x.model = r.model;
      x.thinking = r.thinking;
      x.levels = r.levels;
      x.ctxPct = r.stats?.contextUsage?.percent ?? null;
      x.cacheRate = r.stats ? cacheHitRate(r.stats.tokens) : null;
      x.cost = r.stats?.cost ?? null;
      for (const req of r.pending) addUiRequest(x, req, st.prefs.viewMode);
    });
    call('sessions:commands', id).then((commands) => updateSession(id, (x) => void (x.commands = commands.filter((c) => !['desktop-mode', 'desktop-output-style'].includes(c.name))))).catch(() => {});
    if (s.meta.kind === 'code') void loadChanges(id);
  } catch (err) {
    setApp((st) => {
      const x = st.sessions[id];
      if (!x) return;
      x.setup = null;
      push(x, { kind: 'note', key: newKey(), level: 'error', text: t('act.openFailed', { error: errText(err) }) }, st.prefs.viewMode);
    });
  }
}

// ------------------------------------------------------------ sending

/** Reply to a passage of the conversation: it joins the composer as a card, with the reply typed in the popup. */
export function replyWith(sid: string, passage: string, comment = '') {
  const key = sessionDraftKey(sid);
  const added = drafts.addReference(key, { id: crypto.randomUUID(), kind: 'quote', path: '', text: passage.trim(), comment: comment.trim() || undefined });
  if (!added) throw new Error(getDraft(key).errors.at(-1) ?? t('act.replyFailed'));
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea[data-composer-input]')?.focus());
}

/** Quote a PR review thread into the composer, so the next message can answer or act on it. */
export function quotePrThread(thread: PrThread, note?: string) {
  const s = currentSession();
  if (!s) return;
  const key = sessionDraftKey(s.meta.id);
  const text = thread.comments.map((c) => `${c.author}: ${c.body}`).join('\n\n');
  const added = drafts.addReference(key, {
    id: crypto.randomUUID(), kind: 'comment', path: thread.path, text,
    ...(note ? { comment: note } : {}),
    ...(thread.line ? { startLine: thread.line, endLine: thread.line } : {}),
    side: thread.side,
  });
  if (!added) throw new Error(getDraft(key).errors.at(-1) ?? t('act.quoteFailed'));
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea[data-composer-input]')?.focus());
}

/** Answer a PR review thread on the code host itself, then refresh the threads. */
export async function replyPrThread(threadId: string, body: string) {
  const id = currentSession()?.meta.id;
  if (!id) return;
  await call('sessions:prReply', id, threadId, body);
  await loadPrThreads(id);
}

export async function resolvePrThread(threadId: string, resolved: boolean) {
  const id = currentSession()?.meta.id;
  if (!id) return;
  await call('sessions:prResolve', id, threadId, resolved);
  await loadPrThreads(id);
}

const HELP = () => t('act.help', { mod: modKey });

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
      toast.warning(t('act.startSessionFirst'));
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
      toast.warning(t('act.startSessionFirst'));
      return true;
    }
    const lines = [...desktopCommands(), ...s.commands.map((c) => [`/${c.name}`, c.description || c.source] as [string, string])];
    pushItem(s.meta.id, { kind: 'text', key: newKey(), text: `### ${t('act.commands')}\n${lines.map(([k, d]) => `- \`${k}\` ${d}`).join('\n')}\n\n${HELP()}`, live: false });
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
        x.cacheRate = null;
        x.cost = 0;
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
  updateSession(id, (x) => {
    x.compacting = true;
    x.statusText = t('status.compacting');
  });
  try {
    await call('sessions:compact', id, instructions);
  } finally {
    // The compaction_end event does this too; this covers a host that never answered.
    updateSession(id, (x) => void (x.compacting = false));
    void refreshStats(id);
  }
}

/** A reopened transcript has only the latest summary; remember how many messages it stands in for. */
function markCompactionHistory(s: SessionView, hidden: number) {
  const card = s.items.findLast((i): i is ItemOf<'compaction'> => i.kind === 'compaction');
  if (card) card.hidden = hidden;
}

/** Show or hide the messages above a compaction card, loading them from the session file when needed. */
export async function toggleCompactionHistory(id: string, key: string) {
  const s = getApp().sessions[id];
  const card = findByKey(s, key);
  if (!s || card?.kind !== 'compaction' || card.loading) return;
  const set = (patch: Partial<ItemOf<'compaction'>>) => updateSession(id, (x) => {
    const c = findByKey(x, key);
    if (c?.kind === 'compaction') Object.assign(c, patch);
  });
  // Once loaded (or when the live transcript still holds them), the items are already above the card.
  if (s.items.findIndex((i) => i.key === key) > 0 || card.open || !card.hidden) return set({ open: !card.open });
  set({ loading: true });
  try {
    const messages = await call('sessions:compactedHistory', id);
    setApp((st) => {
      const x = st.sessions[id];
      const c = findByKey(x, key);
      if (c?.kind !== 'compaction') return;
      const at = x.items.findIndex((i) => i.key === key);
      x.items.splice(at, 0, ...transcriptItems(x.meta, messages, st.prefs.viewMode));
      c.open = true;
      c.hidden = 0;
      c.loading = false;
    });
  } catch (err) {
    set({ loading: false });
    fail(err);
  }
}

/** Expand or collapse the summary of a compaction card. */
export function toggleCompactionSummary(id: string, key: string) {
  updateSession(id, (x) => {
    const card = findByKey(x, key);
    if (card?.kind === 'compaction') card.openSummary = !card.openSummary;
  });
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
    pushItem(id, { kind: 'note', key: newKey(), text: t('act.exported', { path }) });
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
      ...(meta.worktreeSetup ? [{ id: 'worktree' as const, label: t('act.stepWorktree', { branch: meta.branch ?? '' }), state: 'running' as const }] : []),
      { id: 'agent', label: t('act.stepAgent'), state: meta.worktreeSetup ? 'pending' : 'running' },
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
  if (draft.preparing) return void toast.warning(t('act.waitAttachments'));
  const text = draft.text;
  const files = draft.attachments.slice();
  // An @ reference is only sent while its badge is still in the message: deleting the token removes the context.
  const references = draft.references.filter((reference) => !reference.token || text.includes(reference.token));
  let s = currentSession();
  if (s?.stopping || s?.historyBusy) return;
  if (!text.trim() && !files.length && !references.length) {
    if (s?.running || s?.compacting) void stop(s.meta.id);
    return;
  }
  if (s?.compacting) return void toast.warning(t('act.waitCompaction'));
  const head = text.trim().split(/\s+/)[0];
  // Commands the app handles itself (and pi's /skill) take no attachments; a skill may still carry @ context.
  if ((files.length || references.length) && desktopCommands().some(([name]) => name === head)) return void toast.warning(t('act.slashNoAttach'));
  if (await slashCommand(s, head, text)) return;

  const st = getApp();
  if (!s && st.view === 'code' && !st.prefs.project) return void toast.warning(t('act.pickProjectFirst'));
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
      v.statusText = t('status.thinking');
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
      drafts.error(key, t('act.exitedUnconfirmed'));
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
    else if (u?.exited || getApp().sessions[id]?.hostEpoch !== epoch) drafts.error(key, t('act.exitedUnconfirmed'));
    else if (/exited|closed|timeout|timed out|terminated/i.test(errText(err))) {
      updateSession(id, (v) => {
        const x = findByKey(v, itemKey);
        if (x?.kind === 'user') Object.assign(x, { failed: true, queued: false });
      });
      drafts.error(key, t('act.unconfirmed'));
    } else {
      removeUser();
      drafts.error(key, err);
    }
    if (optimistic) updateSession(id, (v) => void (v.running = false));
  } finally {
    drafts.lock(key, false);
  }
}

/** Stop the run (or an in-flight compaction); queued messages come back to the draft. */
export async function stop(id: string) {
  const s = getApp().sessions[id];
  if (!s || s.stopping || !(s.running || s.compacting)) return;
  const epoch = s.hostEpoch;
  updateSession(id, (v) => {
    v.stopping = true;
    v.statusText = t('act.stopping');
  });
  try {
    const q = await call('sessions:clearQueue', id);
    for (const wire of [...q.steering, ...q.followUp]) {
      const decoded = decodeUserContent(wire);
      const v = getApp().sessions[id];
      const p = v?.pendingUser.map((k) => findByKey(v, k)).find((i): i is Item & { kind: 'user' } => i?.kind === 'user' && (decoded.clientId ? i.clientId === decoded.clientId : i.wire === wire));
      const snapshot = p?.submission ?? { text: typedText(decoded.text), attachments: decoded.attachments.filter((a): a is any => a.kind === 'file' || !!(a as any).data) };
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
  updateSession(id, (v) => {
    resolveUi(v, requestId, label);
    const resolved = findByKey(v, itemKey);
    if (resolved?.kind === 'ask' && response.answers) resolved.answers = response.answers;
  });
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

/** Rename a session to a title the user typed in place; the host locks it against auto-naming. */
export async function setSessionTitle(id: string, title: string) {
  try {
    const meta = await call('sessions:update', id, { title });
    updateSession(id, (v) => void (v.meta = meta));
  } catch (err) {
    fail(err);
  }
}

export async function setSessionPinned(id: string, pinned: boolean) {
  try {
    const meta = await call('sessions:update', id, { pinned });
    updateSession(id, (v) => void (v.meta = meta));
  } catch (err) {
    fail(err);
  }
}

/** Archive keeps the conversation and any worktree on disk; the sidebar just stops listing it. */
export async function archiveSession(id: string, quiet = false) {
  const s = getApp().sessions[id];
  if (!s) return;
  try {
    await call('sessions:archive', id);
    updateSession(id, (v) => {
      v.meta.archived = true;
      v.loaded = false;
      v.running = false;
      v.compacting = false;
      v.setup = null;
    });
    if (getApp().current === id) showWelcome();
    if (!quiet) toast(t('act.archived', { title: s.meta.title }), { action: { label: t('act.undo'), onClick: () => void unarchiveSession(id) } });
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

/** Several at once: one toast, one undo. */
export async function archiveSessions(ids: string[]) {
  if (ids.length < 2) return void (ids[0] && archiveSession(ids[0]));
  const done = ids.filter((id) => getApp().sessions[id] && !getApp().sessions[id].meta.archived);
  await Promise.all(done.map((id) => archiveSession(id, true)));
  toast(t('act.archivedMany', { n: done.length }), { action: { label: t('act.undo'), onClick: () => void Promise.all(done.map(unarchiveSession)) } });
}

export async function pinSessions(ids: string[], pinned: boolean) {
  await Promise.all(ids.map((id) => setSessionPinned(id, pinned)));
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
    const lines = [t('act.deleteLine')];
    if (lost.worktree) {
      lines.push(t('act.deleteWorktree', { path: lost.worktree }));
      if (lost.dirty) lines.push(t('act.deleteDirty', { n: lost.dirty }));
      if (lost.unpushed) lines.push(t('act.deleteUnpushed', { branch: lost.branch ?? '', n: lost.unpushed }));
    }
    if (!(await dialogs.confirm(t('act.deleteTitle', { title: s.meta.title }), lines.join('\n'), t('act.delete'), true))) return;
    const removed = await call('sessions:remove', id);
    dropSession(id);
    if (removed.branchKept) toast(t('act.branchKept', { branch: removed.branchKept }));
  } catch (err) {
    fail(err);
  }
}

export async function deleteSessions(ids: string[]) {
  if (ids.length < 2) return void (ids[0] && deleteSession(ids[0]));
  try {
    const lost = await Promise.all(ids.map((id) => call('sessions:inspect', id)));
    const lines = [t('act.deleteLine')];
    const trees = lost.filter((l) => l.worktree).length;
    const dirty = lost.reduce((n, l) => n + (l.dirty || 0), 0);
    if (trees) lines.push(t('act.deleteWorktrees', { n: trees }));
    if (dirty) lines.push(t('act.deleteDirty', { n: dirty }));
    if (!(await dialogs.confirm(t('act.deleteManyTitle', { n: ids.length }), lines.join('\n'), t('act.delete'), true))) return;
    for (const id of ids) {
      const removed = await call('sessions:remove', id);
      dropSession(id);
      if (removed.branchKept) toast(t('act.branchKept', { branch: removed.branchKept }));
    }
  } catch (err) {
    fail(err);
  }
}

/** `restoreDraft: false` leaves the message's text out of the new composer (forking at a turn's end, not at a message of the user). */
export async function userMessageAction(id: string, entryId: string, action: 'rewind' | 'fork', restoreDraft = true) {
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
      markCompactionHistory(target, session.hiddenMessages);
      target.loaded = true;
      target.running = session.isStreaming;
      target.model = session.model;
      target.thinking = session.thinking;
      target.levels = session.levels;
      target.ctxPct = session.stats?.contextUsage?.percent ?? null;
      target.cacheRate = session.stats ? cacheHitRate(session.stats.tokens) : null;
      target.cost = session.stats?.cost ?? null;
    });
    const attachments = restoreDraft ? draft.attachments.filter((attachment): attachment is Attachment => attachment.kind === 'file' || typeof attachment.data === 'string') : [];
    if (restoreDraft) drafts.recover(sessionDraftKey(session.meta.id), { text: typedText(draft.text), attachments, label: t(action === 'rewind' ? 'act.rewoundMessage' : 'act.branchStart') });
    if (restoreDraft && draft.notice) drafts.error(sessionDraftKey(session.meta.id), draft.notice);
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

/**
 * Drop a dragged card next to another one, possibly in the other column. `columns` is what is on screen now,
 * so the saved arrangement starts from it and the move is kept for every later combination of open cards.
 */
export function moveCard(id: string, card: CardId, target: CardId, place: DropPlace, columns: Arrangement) {
  if (card === target) return;
  const next: Arrangement = { primary: columns.primary.filter((c) => c !== card), secondary: columns.secondary.filter((c) => c !== card) };
  if (place === 'left' || place === 'right') {
    // The side edge sends the card to the left or right column, at its bottom; an empty side opens a new column.
    next[place === 'left' ? 'primary' : 'secondary'].push(card);
  } else {
    const column: Column = next.primary.includes(target) ? 'primary' : 'secondary';
    next[column].splice(next[column].indexOf(target) + (place === 'after' ? 1 : 0), 0, card);
  }
  updateSession(id, (v) => void (v.arrangement = next));
  writeArrangement(id, next);
}

/** Blow one card up over the whole workspace (or, `wide`, the whole session with the conversation), or put it back — remembered per session. */
export function expandCard(id: string, card: CardId | null, wide = false) {
  updateSession(id, (v) => {
    v.expanded = card;
    v.expandedWide = !!card && wide;
  });
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
    if (!(await call('sessions:stopTask', id, toolCallId))) toast.warning(t('act.taskFinished'));
  } catch (err) {
    fail(err);
  }
}

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|bmp)$/i;
const MEDIA_FILE = /\.(mp3|wav|m4a|aac|ogg|opus|flac|mp4|m4v|webm|mov)$/i;

let fileRequest = 0;
/**
 * Show the current contents of a session file in the detail panel, at a line.
 * Images show as images; `fallbackImage` (what a read tool returned) covers files outside the session.
 * The file takes a tab of the Files card: the preview tab if nobody pinned it, else a new one (`pin` keeps it).
 */
export async function openFileRef(path: string, line?: number, fallbackImage?: string, pin = false) {
  const s = currentSession();
  if (!s) return;
  const id = s.meta.id;
  const rel = relPath(s.meta.cwd, path);
  const request = ++fileRequest;
  const target = positiveLine(line);
  updateSession(id, (v) => {
    v.detail = { type: 'file', path: rel, line: target, loading: true };
    if (v.meta.kind === 'work') return;
    const known = v.fileTabs.find((t) => t.path === rel);
    if (known) known.pinned ||= pin;
    else {
      const preview = pin ? -1 : v.fileTabs.findIndex((t) => !t.pinned);
      if (preview >= 0) v.fileTabs[preview] = { path: rel, pinned: false };
      else v.fileTabs.push({ path: rel, pinned: pin });
    }
  });
  // The preview lives in the Files card (a Work session has no such card and shows it on its own).
  if (s.meta.kind !== 'work') togglePanel(id, 'files', true);
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
    if (MEDIA_FILE.test(rel)) {
      const media = (await call('sessions:readMedia', id, rel).catch(() => null)) ?? null;
      if (stillShowing()) updateSession(id, (v) => void (v.detail = { type: 'file', path: rel, line: target, loading: false, media: media && { kind: media.kind, src: media.src } }));
      return;
    }
    const text = await call('sessions:readFile', id, rel);
    if (stillShowing()) updateSession(id, (v) => void (v.detail = { type: 'file', path: rel, line: target, loading: false, text }));
  } catch (err) {
    if (stillShowing()) updateSession(id, (v) => void (v.detail = { type: 'file', path: rel, line: target, loading: false, error: errText(err) }));
  }
}
/** Keep a previewed file's tab (a double click on the tab or the file). */
export function pinFileTab(id: string, path: string) {
  updateSession(id, (v) => {
    const tab = v.fileTabs.find((t) => t.path === path);
    if (tab) tab.pinned = true;
  });
}

/** Close a tab; if it was showing, the neighbour takes over, or the card goes back to its empty state. */
export function closeFileTab(id: string, path: string) {
  const s = getApp().sessions[id];
  const at = s?.fileTabs.findIndex((t) => t.path === path) ?? -1;
  if (!s || at < 0) return;
  const next = s.fileTabs[at + 1] ?? s.fileTabs[at - 1];
  const showing = s.detail?.type === 'file' && s.detail.path === path;
  updateSession(id, (v) => void v.fileTabs.splice(at, 1));
  if (!showing) return;
  if (next) void openFileRef(next.path);
  else closeDetail(id);
}

/** Closing the Files card drops its tabs. */
export function closeFiles(id: string) {
  updateSession(id, (v) => {
    v.fileTabs = [];
    if (v.detail?.type === 'file') v.detail = null;
  });
}

export function setFileWindow(id: string, start: number) {
  updateSession(id, (v) => {
    if (v.detail?.type === 'file') v.detail.start = start;
  });
}

/** Ctrl/Cmd+Shift+F: the Files card opens with its find bar on this scope (a card already open is told by event). */
export const findTarget = { scope: null as 'file' | 'all' | null };
export const FIND_EVENT = 'pi:find';
export function requestFind(scope: 'file' | 'all') {
  const s = currentSession();
  if (!s || s.meta.kind === 'work') return;
  findTarget.scope = scope;
  const open = s.panels.files;
  togglePanel(s.meta.id, 'files', true);
  if (open) window.dispatchEvent(new Event(FIND_EVENT));
}

/** Open the Diff panel scrolled to one file, or to the first PR review thread (`thread`). */
export const diffTarget = { path: null as string | null, line: undefined as number | undefined, side: undefined as 'additions' | 'deletions' | undefined, thread: false, seq: 0 };
export function openDiffRef(path: string, line?: number, side?: 'old' | 'new' | 'mixed') {
  const s = currentSession();
  if (!s) return;
  diffTarget.path = relPath(s.meta.cwd, path);
  diffTarget.line = positiveLine(line);
  diffTarget.side = side === 'old' ? 'deletions' : 'additions';
  diffTarget.seq++;
  togglePanel(s.meta.id, 'diff', true);
}
/** A card of a sent message: go to what it refers to. `quoted` is the transcript item a reply points at. */
export function openContextReference(reference: ContextReference, quoted: string | null) {
  if (reference.kind === 'quote') {
    if (!quoted || !revealItem(quoted, reference.text)) toast.info(t('act.quoteGone'));
  } else if (reference.directory) toast.info(t('act.folderNoPreview'));
  else if (reference.side) openDiffRef(reference.path, reference.startLine, reference.side);
  else void openFileRef(reference.path, reference.startLine);
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

const threadCacheKey = (id: string) => `pi.prThreads.${id}`;
function readThreadCache(id: string): PrThread[] {
  try {
    const cached = JSON.parse(localStorage.getItem(threadCacheKey(id)) ?? '[]');
    return Array.isArray(cached) ? cached : [];
  } catch {
    return [];
  }
}

/** Stale-while-revalidate: the last known threads show at once, the forge answers in the background. */
export async function loadPrThreads(id: string) {
  const s = getApp().sessions[id];
  if (!s || isWork(s) || !s.pr) return;
  if (!s.prThreads.length) {
    const cached = readThreadCache(id);
    if (cached.length) updateSession(id, (v) => void (v.prThreads = cached));
  }
  try {
    const prThreads = await call('sessions:prThreads', id);
    updateSession(id, (v) => { if (JSON.stringify(v.prThreads) !== JSON.stringify(prThreads)) v.prThreads = prThreads; });
    try { localStorage.setItem(threadCacheKey(id), JSON.stringify(prThreads)); } catch { /* storage full or blocked */ }
  } catch {
    // Without gh the diff keeps whatever it last knew.
  }
}

/** Files the model listed or wrote and then deleted leave the Files list. */
async function pruneOutputs(id: string) {
  const paths = getApp().sessions[id]?.outputs.map((o) => o.path) ?? [];
  if (!paths.length) return;
  try {
    const alive = new Set(await call('sessions:existing', id, paths));
    updateSession(id, (v) => {
      v.outputs = v.outputs.filter((o) => alive.has(o.path));
    });
  } catch {
    // Keep the list as it is when the check fails.
  }
}

const changeTimers = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleChanges(id: string) {
  clearTimeout(changeTimers.get(id));
  changeTimers.set(id, setTimeout(() => void loadChanges(id), 250));
}
const changesKey = (files: ChangedFile[]) => files.map((f) => `${f.path}:${f.status}:${f.add}:${f.del}:${f.binary}:${f.rev}`).join('\n');
export async function loadChanges(id: string) {
  const s = getApp().sessions[id];
  if (!s || isWork(s)) return;
  try {
    const { files, state } = await call('sessions:changes', id);
    updateSession(id, (v) => {
      // Panels are the user's: a new change must not rearrange their workspace.
      // An unchanged listing keeps its identity, so the diff on screen (open comments, selections) is left alone.
      if (changesKey(v.changes) !== changesKey(files)) v.changes = files;
      if (JSON.stringify(v.gitState) !== JSON.stringify(state)) v.gitState = state;
    });
  } catch {
    // The diff panel simply keeps its previous contents when a refresh fails.
  }
}

/** Measure the session's diff from another branch, then re-read it. */
export async function setDiffBase(id: string, ref: string) {
  try {
    await call('sessions:setBase', id, ref);
    await loadChanges(id);
  } catch (err) {
    fail(err);
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
    const pct = st?.contextUsage?.percent;
    const rate = st ? cacheHitRate(st.tokens) : null;
    updateSession(id, (v) => {
      if (pct != null) v.ctxPct = pct;
      if (rate != null) v.cacheRate = rate;
      if (st) v.cost = st.cost;
    });
  } catch {
    // Context usage is cosmetic; keep the last known figures.
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

// ------------------------------------------------------------ projects and folders

export function selectProject(path: string) {
  if (getApp().prefs.project !== path) setApp((st) => void (st.baseRef = null));
  setPref('project', path);
  // An adopted worktree belongs to the project it came with.
  if (getApp().adopt && getApp().adopt!.mainRoot !== path) setApp((st) => void (st.adopt = null));
  if (!getApp().current) activateDraftFor();
  void refreshImportable();
}

/** Pick a folder on the remote host: there is no native dialog for another machine, so walk its folders. */
async function pickRemoteFolder(): Promise<string | null> {
  const host = getApp().remote?.name ?? t('act.remote');
  let listing = await call('remote:browse');
  for (;;) {
    const options = [
      { label: t('act.pickThisFolder'), hint: listing.path },
      { label: t('act.typePath'), hint: t('act.typePathHint', { host }) },
      ...(listing.parent ? [{ label: t('act.up'), hint: listing.parent }] : []),
      ...listing.dirs.map((d) => ({ label: `${d.name}/` })),
    ];
    const choice = await dialogs.choose(`${host}: ${listing.path}`, options);
    if (choice === null) return null;
    if (choice === 0) return listing.path;
    if (choice === 1) {
      const typed = await dialogs.prompt(t('act.folderPathOn', { host }), listing.path, { action: t('act.choose') });
      if (typed === null) return null;
      if (typed.trim()) return typed.trim();
      continue;
    }
    const target = choice === 2 && listing.parent ? listing.parent : listing.dirs[choice - (listing.parent ? 3 : 2)].path;
    listing = await call('remote:browse', target);
  }
}

export async function addProject() {
  if (getApp().remote) {
    try {
      const dir = await pickRemoteFolder();
      if (!dir) return;
      const project = await call('projects:addPath', dir);
      setApp((st) => void (st.projects = [project, ...st.projects.filter((p) => p.path !== project.path)]));
      selectProject(project.path);
    } catch (err) {
      fail(err);
    }
    return;
  }
  try {
    const added = await call('projects:add');
    if (!added) return;
    let project = added.kind === 'added' ? added.project : null;
    let adopt = null;
    if (added.kind === 'worktree') {
      const { info } = added;
      const main = fname(info.mainRoot);
      const choice = await dialogs.choose(t('act.isWorktree', { name: fname(info.path), main }), [
        { label: t('act.asSession', { main }), hint: t('act.asSessionHint', { branch: info.branch ?? t('act.detached') }) + (added.known ? '' : t('act.asSessionAdd', { main })) },
        { label: t('act.asProject'), hint: t('act.asProjectHint') },
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
  const note = sessions.length ? t('act.removeProjectNote', { n: sessions.length }) : '';
  if (!(await dialogs.confirm(t('act.removeProjectTitle', { name: fname(path) }), `${t('act.removeProjectBody')}${note}`, t('act.remove'), true))) return;
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
    toast.success(t('act.startedIn', { title: meta.title }), { action: { label: t('act.open'), onClick: () => void openSession(meta.id) } });
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
    await call('sessions:prompt', sid, { text: encodeTaskMessage(task.title, task.prompt), attachments: [], clientId: crypto.randomUUID() }, busy ? 'followUp' : 'steer');
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
  const index = list.length === 1 ? 0 : await dialogs.choose(t('act.importTitle'), list.map((s) => ({ label: s.name || s.firstPrompt?.slice(0, 60) || s.id, hint: new Date(s.mtime).toLocaleString() })));
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

/** Save what the Projects page edits; the list the host answers with replaces the one in the store. */
export async function updateWorkProject(path: string, patch: WorkProjectPatch) {
  try {
    const folders = await call('work:update', path, patch);
    setApp((st) => void (st.workFolders = folders));
  } catch (err) {
    fail(err);
  }
}

/** Open a new Work task in a project: the folder is chosen and the welcome page shown. */
export function newProjectTask(path: string) {
  setView('work');
  setWorkFolder(path);
  showWelcome();
}

export function setWorkFolder(folder: string | null) {
  setPref('workFolder', folder);
  if (folder) call('work:useFolder', folder).catch(() => {});
  if (!getApp().current) activateDraftFor();
}

export async function addWorkFolder() {
  try {
    let folder;
    if (getApp().remote) {
      const dir = await pickRemoteFolder();
      folder = dir ? await call('work:addPath', dir) : null;
    } else {
      folder = await call('work:addFolder');
    }
    if (!folder) return;
    const folders = await call('work:folders');
    setApp((st) => void (st.workFolders = folders));
    setWorkFolder(folder.path);
  } catch (err) {
    fail(err);
  }
}

/** Narrow windows: once the user has picked something in the sidebar, give the space back. */
export function collapseSidebarIfCompact() {
  if (window.innerWidth < COMPACT_WINDOW_WIDTH && !getApp().sidebarCollapsed) toggleSidebar(true);
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
