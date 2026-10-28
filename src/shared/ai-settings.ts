/**
 * The app settings the model may change through `pidesk_settings_manage`, and how each value is checked.
 * Left out on purpose: the `ai*` switches and `autoReview*` (the model must not widen its own access or
 * switch off the review of its own commands), `terminalShell`
 * (an executable the app launches), `shellSession` (how its own commands run) and `worktreeDir`
 * (a folder the app creates and writes into).
 */
import { PALETTES, SUGGESTION_MAX_CONTEXT, type Settings, type SuggestionModelMode, type ThemeSetting, type WorkIdeasModelMode } from './protocol';

const THEMES: readonly ThemeSetting[] = ['light', 'dark', 'system'];
const SUGGESTION_MODES: readonly SuggestionModelMode[] = ['auto', 'session', 'fixed'];
const WORK_IDEAS_MODES: readonly WorkIdeasModelMode[] = ['session', 'auto', 'fixed'];
const SESSION_KINDS = ['code', 'work'] as const;

interface Field {
  /** What the model is told the value may be. */
  hint: string;
  ok(value: unknown, petIds: readonly string[]): boolean;
}
const flag: Field = { hint: 'true | false', ok: (v) => typeof v === 'boolean' };
const oneOf = (values: readonly string[]): Field => ({ hint: values.join(' | '), ok: (v) => typeof v === 'string' && values.includes(v) });

export const AI_SETTING_FIELDS = {
  theme: oneOf(THEMES),
  palette: oneOf(PALETTES),
  sidebarCollapsed: flag,
  pet: flag,
  petSkin: { hint: 'a pet skin id (see pidesk_pet_list)', ok: (v, petIds) => typeof v === 'string' && petIds.includes(v) },
  notify: flag,
  defaultMode: oneOf(SESSION_KINDS),
  renderMermaid: flag,
  suggestions: flag,
  suggestionModel: oneOf(SUGGESTION_MODES),
  suggestionModelId: { hint: 'provider/model id, used when suggestionModel is fixed; null clears it', ok: (v) => v === null || (typeof v === 'string' && v.includes('/')) },
  suggestionContext: { hint: `integer 1..${SUGGESTION_MAX_CONTEXT}`, ok: (v) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= SUGGESTION_MAX_CONTEXT },
  suggestionFullContext: flag,
  workIdeas: flag,
  workIdeasModel: oneOf(WORK_IDEAS_MODES),
  workIdeasModelId: { hint: 'provider/model id, used when workIdeasModel is fixed; null clears it', ok: (v) => v === null || (typeof v === 'string' && v.includes('/')) },
} satisfies Partial<Record<keyof Settings, Field>>;

export type AiSettingKey = keyof typeof AI_SETTING_FIELDS;
export const AI_SETTING_KEYS = Object.keys(AI_SETTING_FIELDS) as AiSettingKey[];

/** Checks a patch from the model and returns it typed; throws a readable message for the first problem. */
export function checkAiSettingsPatch(raw: Record<string, unknown>, petIds: readonly string[]): Partial<Settings> {
  const entries = Object.entries(raw);
  if (!entries.length) throw new Error('set needs at least one setting');
  for (const [key, value] of entries) {
    const field = (AI_SETTING_FIELDS as Record<string, Field>)[key];
    if (!field) throw new Error(`"${key}" cannot be changed from the chat. Changeable settings: ${AI_SETTING_KEYS.join(', ')}`);
    if (!field.ok(value, petIds)) throw new Error(`Bad value for ${key}: expected ${field.hint}`);
  }
  return raw as Partial<Settings>;
}
