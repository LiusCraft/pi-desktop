// The workspace tabs and selection belong to the session.
import type { Panels, SessionView, SideChatTab, WorkspaceResourceId, WorkspaceTab } from './types';

export function isWorkspaceResource(tab: WorkspaceTab | null): tab is WorkspaceResourceId {
  return tab?.startsWith('resource:') ?? false;
}

export function isSideChatTab(tab: WorkspaceTab | null): tab is SideChatTab {
  return tab?.startsWith('side:') ?? false;
}

export const sideChatTab = (id: string): SideChatTab => `side:${id}`;
export const sideChatId = (tab: SideChatTab) => tab.slice('side:'.length);

/** A brand new session opens with nothing but Work's progress card. */
export const DEFAULT_PANELS: Panels = {
  diff: false,
  preview: false,
  files: false,
  terminal: false,
  progress: true,
  tasks: false,
};

/** localStorage, or an in-memory stand-in when it is missing (tests, private modes). */
type KeyValue = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const store: KeyValue = (() => {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // Access can throw when storage is disabled; fall through to memory.
  }
  const memory = new Map<string, string>();
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => void memory.set(key, value),
    removeItem: (key) => void memory.delete(key),
  };
})();

const panelsKey = (id: string) => `pd_panels:${id}`;

export function readPanels(id: string): Panels {
  let saved: Record<string, unknown> | null = null;
  try {
    saved = JSON.parse(store.getItem(panelsKey(id)) ?? 'null');
  } catch {
    saved = null;
  }
  const panels = { ...DEFAULT_PANELS };
  if (saved && typeof saved === 'object') {
    for (const key of Object.keys(DEFAULT_PANELS) as (keyof Panels)[]) {
      const value = saved[key];
      if (typeof value === 'boolean') panels[key] = value;
    }
  }
  return panels;
}

export function writePanels(id: string, panels: Panels) {
  try {
    store.setItem(panelsKey(id), JSON.stringify(panels));
  } catch {
    // A full or blocked storage only costs the memory, never the change itself.
  }
}

const activeTabKey = (id: string) => `pd_workspace_tab:${id}`;
const TAB_ORDER: readonly (keyof Panels | 'detail')[] = [
  'progress',
  'tasks',
  'diff',
  'preview',
  'files',
  'terminal',
  'detail',
];

export function openWorkspaceTabs(s: SessionView, canTerminal: boolean): WorkspaceTab[] {
  const work = s.meta.kind === 'work';
  const tabs: WorkspaceTab[] = TAB_ORDER.filter((tab) => {
    if (tab === 'detail') return !!s.detail;
    if (!s.panels[tab]) return false;
    if (tab === 'progress') return work;
    if (tab === 'tasks') return true;
    return !work && (tab !== 'terminal' || canTerminal);
  });
  if (s.sessionInfoOpen) tabs.push('sessionInfo');
  tabs.push(...s.sideTabs, ...s.workspaceResources.map((resource) => resource.id));
  if (s.workspaceNewOpen) tabs.push('new');
  return tabs;
}

export function selectedWorkspaceTab(s: SessionView, tabs: readonly WorkspaceTab[]): WorkspaceTab | null {
  return s.activeTab && tabs.includes(s.activeTab) ? s.activeTab : (tabs[0] ?? null);
}

/** Explicitly opening or selecting any tab also reveals the dock. */
export function activateWorkspaceTab(s: SessionView, tab: WorkspaceTab) {
  s.activeTab = tab;
  s.workspaceHidden = false;
}

export function closeWorkspaceTab(s: SessionView, tab: WorkspaceTab, canTerminal: boolean, remove: () => void) {
  const before = openWorkspaceTabs(s, canTerminal);
  const wasSelected = selectedWorkspaceTab(s, before) === tab;
  remove();
  const remaining = openWorkspaceTabs(s, canTerminal);
  if (wasSelected) s.activeTab = remaining[before.indexOf(tab)] ?? remaining.at(-1) ?? null;
  if (!remaining.length) s.workspaceExpanded = false;
}

export function readWorkspaceTab(id: string): WorkspaceTab | null {
  try {
    const saved = store.getItem(activeTabKey(id));
    return TAB_ORDER.find((tab) => tab !== 'detail' && tab === saved) ?? null;
  } catch {
    return null;
  }
}

export function writeWorkspaceTab(id: string, tab: WorkspaceTab | null) {
  // Transient tabs don't overwrite the last regular selection.
  if (tab === 'detail' || tab === 'sessionInfo' || tab === 'new' || isSideChatTab(tab) || isWorkspaceResource(tab))
    return;
  try {
    if (tab) store.setItem(activeTabKey(id), tab);
    else store.removeItem(activeTabKey(id));
  } catch {
    // Storage may be unavailable.
  }
}

export function forgetPanels(id: string) {
  try {
    store.removeItem(activeTabKey(id));
    store.removeItem(panelsKey(id));
  } catch {
    // Nothing to do: the entry is unreachable once the session is gone.
  }
}
