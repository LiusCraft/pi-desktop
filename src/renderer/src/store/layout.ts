// What the user left open in a session's workspace: which cards were visible and which
// one was expanded. Kept next to the session id in localStorage, so reopening a
// conversation (even after a restart) shows its own layout instead of a default one.
import type { Arrangement, CardId, Column, Panels } from './types';

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

const arrangementKey = (id: string) => `pd_arrangement:${id}`;

const CARD_IDS: readonly CardId[] = ['progress', 'tasks', 'diff', 'preview', 'detail', 'files', 'terminal'];

export function readArrangement(id: string): Arrangement {
  const arrangement: Arrangement = { primary: [], secondary: [] };
  try {
    const saved = JSON.parse(store.getItem(arrangementKey(id)) ?? 'null');
    const seen = new Set<CardId>();
    for (const column of Object.keys(arrangement) as Column[]) {
      const list = saved?.[column];
      if (!Array.isArray(list)) continue;
      for (const card of list) {
        if (CARD_IDS.includes(card) && !seen.has(card)) {
          seen.add(card);
          arrangement[column].push(card);
        }
      }
    }
  } catch {
    // An unreadable entry just means the default arrangement.
  }
  return arrangement;
}

export function writeArrangement(id: string, arrangement: Arrangement) {
  try {
    store.setItem(arrangementKey(id), JSON.stringify(arrangement));
  } catch {
    // A full or blocked storage only costs the memory, never the change itself.
  }
}

export function forgetPanels(id: string) {
  try {
    store.removeItem(arrangementKey(id));
    store.removeItem(panelsKey(id));
  } catch {
    // Nothing to do: the entry is unreachable once the session is gone.
  }
}
