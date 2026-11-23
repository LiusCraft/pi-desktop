export const SHORTCUTS = {
  navigation: {
    palette: 'Mod+K',
    sessions: 'Mod+Shift+K',
    work: 'Mod+Shift+1',
    code: 'Mod+Shift+2',
    newSession: 'Mod+N',
    sidebar: 'Mod+B',
    settings: 'Mod+,',
  },
  conversation: {
    composer: 'Mod+Alt+I',
    model: 'Mod+Alt+M',
    effort: 'Mod+Alt+E',
    mode: 'Mod+Alt+P',
    cycleMode: 'Mod+Alt+C',
    attachments: 'Mod+Alt+A',
    panel: 'Mod+D',
    view: 'Mod+O',
    findFile: 'Mod+F',
    findAll: 'Mod+Shift+F',
    stop: 'Escape',
    choice1: '1',
    choice2: '2',
    choice3: '3',
    choice4: '4',
    questionNext: 'Alt+Enter',
  },
  creation: {
    folder: 'Mod+Alt+L',
    base: 'Mod+Alt+B',
    worktree: 'Mod+Alt+W',
  },
} as const;

export const DEFAULT_SHORTCUTS = { ...SHORTCUTS.navigation, ...SHORTCUTS.conversation, ...SHORTCUTS.creation };
export type ShortcutAction = keyof typeof DEFAULT_SHORTCUTS;
export type ShortcutOverrides = Partial<Record<ShortcutAction, string | null>>;
export const SHORTCUT_ACTIONS = Object.keys(DEFAULT_SHORTCUTS) as ShortcutAction[];
export const CHOICE_SHORTCUTS = ['choice1', 'choice2', 'choice3', 'choice4'] as const;

export function shortcutFor(overrides: ShortcutOverrides | undefined, action: ShortcutAction) {
  const override = overrides?.[action];
  return override === undefined ? DEFAULT_SHORTCUTS[action] : override;
}

const BINDING =
  /^(Mod\+)?(Ctrl\+)?(Alt\+)?(Shift\+)?([A-Z0-9,.;/]|F(?:[1-9]|1[0-2])|Enter|Escape|Arrow(?:Up|Down|Left|Right))$/;

export function validShortcut(action: ShortcutAction, binding: string) {
  const parts = BINDING.exec(binding);
  if (!parts) return false;
  const [, mod, ctrl, alt, shift, key] = parts;
  if (key === 'Escape') return !mod && !ctrl && !alt && !shift && action === 'stop';
  if (mod || ctrl || alt || /^F\d+$/.test(key)) return true;
  return !shift && /^\d$/.test(key) && CHOICE_SHORTCUTS.some((choice) => choice === action);
}

export function normalizeShortcuts(value: unknown): ShortcutOverrides {
  const clean: ShortcutOverrides = {};
  if (!value || typeof value !== 'object') return clean;
  for (const action of SHORTCUT_ACTIONS) {
    const binding = (value as Record<string, unknown>)[action];
    if (binding === null || (typeof binding === 'string' && validShortcut(action, binding))) clean[action] = binding;
  }
  return clean;
}

/** Mod is Command on macOS and aliases Ctrl elsewhere, including for conflict checks. */
export function platformBinding(binding: string, mac: boolean) {
  return mac ? binding : binding.replace(/^Mod\+(Ctrl\+)?/, 'Ctrl+');
}

export function shortcutConflict(overrides: ShortcutOverrides, action: ShortcutAction, binding: string, mac: boolean) {
  const candidate = platformBinding(binding, mac);
  return SHORTCUT_ACTIONS.find((other) => {
    const key = shortcutFor(overrides, other);
    return other !== action && key !== null && platformBinding(key, mac) === candidate;
  });
}

export function resetShortcut(overrides: ShortcutOverrides, action: ShortcutAction, mac: boolean) {
  const next = { ...overrides };
  delete next[action];
  // The default may have been assigned elsewhere while this action was customized.
  for (let other = shortcutConflict(next, action, DEFAULT_SHORTCUTS[action], mac); other;) {
    next[other] = null;
    other = shortcutConflict(next, action, DEFAULT_SHORTCUTS[action], mac);
  }
  return next;
}
