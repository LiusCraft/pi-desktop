// What the composer's @ menu offers besides files: other sessions of the project, a
// terminal tab's output and the working-tree changes. Content is captured when the
// item is picked (a snapshot), so a badge shows exactly what the model receives.
import { TERMINAL_DEFAULT_LINES, type FileChange, type SessionKind, type TerminalInfo } from '@shared/protocol';
import {
  DIFF_TOKEN,
  diffSummaryText,
  sessionToken,
  terminalToken,
  type ContextReference,
} from '@shared/context-reference';
import { call } from '@/lib/api';
import { t } from '@/lib/i18n';
import { fname } from '@/lib/format';
import { getApp } from '@/store/app';

export type MentionKind = 'file' | 'session' | 'terminal' | 'diff';

export interface Mention {
  kind: MentionKind;
  /** The menu's primary line. */
  label: string;
  /** The secondary line: the token that will be inserted, or the full path. */
  hint: string;
  /** What goes into the message text. */
  insert: string;
  /** The text fuzzy matching runs against. */
  search: string;
  sessionId?: string;
  title?: string;
  terminalId?: string;
}

/** Sources fetched when the @ menu opens, per session. */
export interface MentionSources {
  terminals: TerminalInfo[];
  changes: FileChange[];
  /** False outside a git repository, where `@diff` has nothing to stand for. */
  repo: boolean;
}
const EMPTY_SOURCES: MentionSources = { terminals: [], changes: [], repo: false };

const SOURCES_TTL_MS = 15_000;
const sources = new Map<string, { at: number; value: MentionSources }>();
const loading = new Set<string>();

export const cachedSources = (id: string): MentionSources => sources.get(id)?.value ?? EMPTY_SOURCES;

/** Refresh a session's terminals and working-tree changes in the background, then let the menu re-rank. */
export function loadSources(id: string, done: () => void) {
  const hit = sources.get(id);
  if (hit && Date.now() - hit.at < SOURCES_TTL_MS) return;
  if (loading.has(id)) return;
  loading.add(id);
  void Promise.all([
    call('terminal:list', id).catch((): TerminalInfo[] => []),
    call('sessions:changes', id)
      .then((set) => ({ repo: set.repo, changes: set.files }))
      .catch(() => ({ repo: false, changes: [] as FileChange[] })),
  ])
    .then(([terminals, { repo, changes }]) => {
      sources.set(id, { at: Date.now(), value: { terminals, changes, repo } });
    })
    .finally(() => {
      done();
      loading.delete(id);
    });
}

/** The lines a terminal snapshot takes, from the setting. */
export const terminalLines = () => getApp().settings.terminalContextLines ?? TERMINAL_DEFAULT_LINES;

export const fileMention = (path: string): Mention => ({
  kind: 'file',
  label: `@${fname(path)}`,
  hint: path,
  insert: `@${path} `,
  search: path,
});

export function diffMention(files: FileChange[]): Mention {
  const label = t('mention.diff');
  const add = files.reduce((n, file) => n + file.add, 0);
  const del = files.reduce((n, file) => n + file.del, 0);
  return {
    kind: 'diff',
    label,
    hint: files.length ? t('mention.diffHint', { files: files.length, add, del }) : t('mention.diffNone'),
    insert: `${DIFF_TOKEN} `,
    search: `${label} ${DIFF_TOKEN} diff changes`,
  };
}

export const terminalMentions = (terminals: TerminalInfo[]): Mention[] =>
  terminals.map((terminal) => ({
    kind: 'terminal',
    label: terminal.title,
    hint: terminalToken(terminal.title),
    insert: `${terminalToken(terminal.title)} `,
    search: `${terminal.title} term terminal`,
    terminalId: terminal.id,
    title: terminal.title,
  }));

/** The other sessions of this project that a session of `kind` may read, most recently used first. */
export function sessionMentions(projectPath: string | null, kind: SessionKind, currentId: string): Mention[] {
  const views = Object.values(getApp().sessions);
  return views
    .filter(
      (s) => s.meta.id !== currentId && s.meta.kind === kind && s.meta.projectPath === projectPath && !s.meta.archived,
    )
    .sort((a, b) => (b.meta.updatedAt || 0) - (a.meta.updatedAt || 0))
    .map((s) => ({
      kind: 'session',
      label: s.meta.title,
      hint: sessionToken(s.meta.title),
      insert: `${sessionToken(s.meta.title)} `,
      search: `${s.meta.title} ${s.meta.branch ?? ''} session`,
      sessionId: s.meta.id,
      title: s.meta.title,
    }));
}

/** What the picked item stands for; null when there is nothing to attach. */
export async function mentionReference(
  mention: Mention,
  current: MentionSources = EMPTY_SOURCES,
): Promise<ContextReference | null> {
  const id = crypto.randomUUID();
  if (mention.kind === 'diff')
    return { id, kind: 'diff', path: '', token: DIFF_TOKEN, text: diffSummaryText(current.changes) };
  if (mention.kind === 'session' && mention.sessionId) {
    return {
      id,
      kind: 'session',
      path: '',
      token: mention.insert.trim(),
      title: mention.title ?? '',
      sessionId: mention.sessionId,
    };
  }
  if (mention.kind === 'terminal' && mention.terminalId) {
    const text = await call('terminal:text', mention.terminalId, terminalLines());
    if (!text.trim()) return null;
    return { id, kind: 'terminal', path: '', token: mention.insert.trim(), title: mention.title ?? '', text };
  }
  return null;
}
