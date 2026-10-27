import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  AppInfo, ImportableSession, ModelInfo, OutputStyle, PermissionMode, Project, SessionKind, SettingsPayload, ThinkingLevel, WorktreeInfo,
} from '@shared/protocol';
import type { RemoteActive } from '@shared/remote';
import type { ScheduledTask } from '@shared/schedule';
import { bridge } from '@/lib/api';
import type { ViewMode } from '@/lib/constants';
import type { SessionView } from './types';

// ------------------------------------------------------------ local preferences

export const read = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
};
export const savePref = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

export interface Prefs {
  /** Code: the project new sessions start in. */
  project: string | null;
  worktree: boolean;
  mode: PermissionMode;
  model: string | null;
  effort: ThinkingLevel;
  viewMode: ViewMode;
  outputStyle: OutputStyle;
  /** Work: undefined = not chosen yet, null = temporary workspace. */
  workFolder: string | null | undefined;
  previewUrl: string;
}

const PREF_KEYS: Record<keyof Prefs, string> = {
  project: 'pd_project', worktree: 'pd_worktree', mode: 'pd_mode', model: 'pd_model', effort: 'pd_effort',
  viewMode: 'pd_view_mode', outputStyle: 'pd_output_style', workFolder: 'pd_work_folder', previewUrl: 'pd_preview',
};

function loadPrefs(): Prefs {
  const p: Prefs = {
    project: read('pd_project', null),
    worktree: read('pd_worktree', true),
    mode: read('pd_mode', 'auto'),
    model: read('pd_model', null),
    effort: read('pd_effort', 'high'),
    viewMode: read('pd_view_mode', 'normal'),
    outputStyle: read('pd_output_style', 'default'),
    workFolder: read<string | null | undefined>('pd_work_folder', undefined),
    previewUrl: read('pd_preview', 'http://localhost:5173'),
  };
  if (!['normal', 'thinking', 'verbose'].includes(p.viewMode)) p.viewMode = 'normal';
  return p;
}

// ------------------------------------------------------------ store

export interface AppState {
  info: AppInfo | null;
  settings: Partial<SettingsPayload>;
  /** Which side of the app is showing. */
  view: SessionKind;
  current: string | null;
  lastByView: Record<SessionKind, string | null>;
  projects: Project[];
  workFolders: Project[];
  prefs: Prefs;
  models: ModelInfo[];
  /** Thinking levels of the default model (welcome screens). */
  levels: ThinkingLevel[];
  importable: ImportableSession[];
  /** Current git branch of the selected project (new-session chips). */
  projectBranch: string | null;
  /** Branches of the selected project, and the one the next worktree starts from (null: the current branch). */
  projectBranches: string[];
  baseRef: string | null;
  sessions: Record<string, SessionView>;
  paletteOpen: boolean;
  /** A footer menu opened by a slash command (/model, /permissions, /context). */
  menu: 'model' | 'mode' | 'context' | null;
  sidebarCollapsed: boolean;
  /** The Customize page replaces the conversation area while it is open. */
  customize: boolean;
  /** The Scheduled tasks page replaces the conversation area while it is open. */
  scheduled: boolean;
  /** The Archived sessions page replaces the conversation area while it is open. */
  archived: boolean;
  /** An existing worktree of the selected project that the next new session will run in. */
  adopt: WorktreeInfo | null;
  tasks: ScheduledTask[];
  /** The remote host the whole app is driving (fixed for the life of the window), or null for this machine. */
  remote: RemoteActive | null;
}

const boot = bridge?.boot ?? {};
const initialView = (): SessionKind => {
  const stored = read<string | null>('cc_mode', null);
  if (stored === 'work' || stored === 'chat') return 'work';
  if (stored === 'code') return 'code';
  return boot.settings?.defaultMode === 'work' ? 'work' : 'code';
};

export const useApp = create<AppState>()(
  immer(() => ({
    info: null,
    settings: boot.settings ?? {},
    view: initialView(),
    current: null,
    lastByView: { code: null, work: null },
    projects: [],
    workFolders: [],
    prefs: loadPrefs(),
    models: [],
    levels: [],
    importable: [],
    projectBranch: null,
    projectBranches: [],
    baseRef: null,
    sessions: {},
    paletteOpen: false,
    menu: null,
    customize: false,
    scheduled: false,
    archived: false,
    adopt: null,
    tasks: [],
    remote: boot.remote ?? null,
    sidebarCollapsed: boot.settings?.sidebarCollapsed ?? read('cc_collapsed', false),
  })),
);

export const getApp = () => useApp.getState();
export const setApp = (fn: (s: AppState) => void) => useApp.setState(fn);

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  setApp((s) => {
    s.prefs[key] = value;
  });
  savePref(PREF_KEYS[key], value);
}

/** Mutate one session (no-op when it is unknown). */
export function updateSession(id: string, fn: (s: SessionView) => void) {
  setApp((st) => {
    const s = st.sessions[id];
    if (s) fn(s);
  });
}

export const useCurrent = () => useApp((s) => (s.current ? s.sessions[s.current] : undefined));
export const currentSession = () => {
  const s = getApp();
  return s.current ? s.sessions[s.current] : undefined;
};
export const isWork = (s: SessionView | undefined) => s?.meta.kind === 'work';

export function modelName(models: ModelInfo[], id: string | null | undefined) {
  const m = models.find((x) => `${x.provider}/${x.id}` === id);
  return m ? m.name || m.id : id ? id.split('/').pop()! : 'No model';
}
