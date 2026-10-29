// A session that sat idle past its prompt-cache lifetime continues in a fresh context: the old
// messages leave the model's context and one handoff card stays behind. Nothing here calls a
// model — the card is read out of the session file and the old entries are dropped with a
// `context_edit`, so rebuilding costs less than re-sending the history at full price.
import type { Settings } from './protocol';

/** Minutes of inactivity after which a session's context is rebuilt; 0 turns it off. */
export const IDLE_RESET_DEFAULT_MINUTES = 60;

/** Below this many context tokens the saving is not worth losing the conversation. */
export const IDLE_RESET_MIN_TOKENS = 60_000;

/** A week is the point where "idle" stops being meaningful; larger values are treated as unset. */
export const IDLE_RESET_MAX_MINUTES = 7 * 24 * 60;

export const MINUTE_MS = 60 * 1000;

/** Marks the custom message that carries the handoff card; the transcript draws it as a note. */
export const HANDOFF_CUSTOM_TYPE = 'pi-desktop-handoff';

/** What the transcript needs to draw the card instead of the raw model-facing text. */
export interface HandoffDetails {
  sessionId: string;
  /** Idle time before the rebuild, in minutes. */
  idleMinutes: number;
  /** Context tokens that left the model's context. */
  tokensBefore: number;
  filesChanged: number;
  filesRead: number;
}

/** `provider/model`, the key `idleResetModels` is written under. */
export const modelKey = (provider: string, model: string) => `${provider}/${model}`;

/** A hand-edited minutes value: finite, in range and not negative; anything else is treated as unset. */
export const idleMinutes = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= IDLE_RESET_MAX_MINUTES ? value : undefined;

/**
 * The minutes before a context is rebuilt. The model's own value wins (0 = never rebuild for it). A
 * global 0 switches the rebuild off everywhere, so a single model is enabled by giving it a value.
 * Otherwise the lifetime the model catalog declares for its prompt cache applies, and the global
 * setting is the fallback for models that declare nothing.
 */
export function idleResetMinutes(
  settings: Pick<Settings, 'idleResetMinutes' | 'idleResetModels'>,
  key: string,
  declaredMinutes?: number,
): number {
  const own = idleMinutes(settings.idleResetModels?.[key]);
  if (own !== undefined) return own;
  const global = idleMinutes(settings.idleResetMinutes) ?? IDLE_RESET_DEFAULT_MINUTES;
  if (global <= 0) return 0;
  return idleMinutes(declaredMinutes) ?? global;
}

/** "5m" / "3h" / "2d": short enough for one line of the card, in both languages. */
export function formatIdle(minutes: number): string {
  const whole = Math.max(1, Math.round(minutes));
  if (whole < 60) return `${whole}m`;
  const hours = Math.round(whole / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}
