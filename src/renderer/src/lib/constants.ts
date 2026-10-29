import type { OutputStyle, PermissionMode, ThinkingLevel } from '@shared/protocol';
import type { MessageKey } from '@shared/i18n';
import { t } from './i18n';

/** An id with a translated name and description; read at use time, so the text follows the current language. */
function described<Id extends string>(
  ids: readonly Id[],
  key: (id: Id) => string,
): { id: Id; name: string; desc: string }[] {
  return ids.map((id) => ({
    id,
    get name() {
      return t(key(id) as MessageKey);
    },
    get desc() {
      return t(`${key(id)}.desc` as MessageKey);
    },
  }));
}

/** Below this window width the sidebar would crowd the conversation, so picking something in it folds it away. */
export const COMPACT_WINDOW_WIDTH = 900;

export const MODES = described<PermissionMode>(
  ['auto', 'default', 'acceptEdits', 'plan', 'bypass'],
  (id) => `mode.${id}`,
);
export const modeName = (id: PermissionMode | undefined) => MODES.find((m) => m.id === id)?.name ?? MODES[0].name;

export const levelLabel = (level: ThinkingLevel) => t(`level.${level}`);

export type ViewMode = 'normal' | 'thinking' | 'verbose';
export const VIEW_MODES = described<ViewMode>(['normal', 'thinking', 'verbose'], (id) => `view.${id}`);

export const OUTPUT_STYLE_INFO = described<OutputStyle>(
  ['default', 'proactive', 'concise', 'explanatory', 'learning'],
  (id) => `style.${id}`,
);

/** Slash commands the desktop handles itself (the session adds pi's own). */
const DESKTOP_COMMAND_NAMES = ['clear', 'compact', 'btw', 'context', 'model', 'permissions', 'export', 'help'] as const;
export const desktopCommands = (): [string, string][] =>
  DESKTOP_COMMAND_NAMES.map((name) => [`/${name}`, t(`cmd.${name}`)]);

const WORK_IDEA_IDS = ['briefing', 'inbox', 'customize'] as const;
export const workIdeas = () => WORK_IDEA_IDS.map((id) => ({ label: t(`idea.${id}`), prompt: t(`idea.${id}.prompt`) }));
