// The app's sounds. They are synthesized (Web Audio), so a sound is a few notes, not a file. A pet
// skin may carry its own voice for any event (`PetDef.sounds`); events it leaves out use DEFAULT_VOICES.

/** The moments that can play a sound. `speak` is the pet's daily greeting, `pet` a double-click on it. */
export const SOUND_EVENTS = ['done', 'error', 'ask', 'pet', 'speak'] as const;
export type SoundEvent = (typeof SOUND_EVENTS)[number];

/** The events that belong to the pet itself; Settings → Pet switches them together. */
export const PET_SOUND_EVENTS: readonly SoundEvent[] = ['pet', 'speak'];

export const SOUND_WAVES = ['sine', 'square', 'triangle', 'sawtooth'] as const;
export type SoundWave = (typeof SOUND_WAVES)[number];

export interface SoundNote {
  /** Hz */
  freq: number;
  /** Seconds after the sound starts. */
  at: number;
  /** Seconds. */
  len: number;
}
export interface Voice {
  wave: SoundWave;
  /** Volume, 0..SOUND_LIMITS.gain. */
  gain: number;
  notes: SoundNote[];
}
export type Voices = Partial<Record<SoundEvent, Voice>>;

export const SOUND_LIMITS = {
  notes: 8,
  freq: { min: 80, max: 4000 },
  at: { min: 0, max: 2 },
  len: { min: 0.02, max: 1 },
  gain: 0.4,
} as const;

export const DEFAULT_VOICES: Record<SoundEvent, Voice> = {
  done: { wave: 'sine', gain: 0.18, notes: [{ freq: 660, at: 0, len: 0.12 }, { freq: 880, at: 0.1, len: 0.22 }] },
  error: { wave: 'triangle', gain: 0.2, notes: [{ freq: 330, at: 0, len: 0.14 }, { freq: 247, at: 0.13, len: 0.26 }] },
  ask: { wave: 'sine', gain: 0.18, notes: [{ freq: 784, at: 0, len: 0.1 }, { freq: 784, at: 0.18, len: 0.1 }] },
  pet: { wave: 'square', gain: 0.07, notes: [{ freq: 988, at: 0, len: 0.06 }, { freq: 1319, at: 0.07, len: 0.1 }] },
  speak: { wave: 'sine', gain: 0.12, notes: [{ freq: 523, at: 0, len: 0.08 }, { freq: 659, at: 0.09, len: 0.08 }, { freq: 784, at: 0.18, len: 0.14 }] },
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function inRange(v: unknown, min: number, max: number, where: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new Error(`${where} must be a number between ${min} and ${max}`);
  return v;
}

/** Check an untrusted `sounds` object (a pet file, model output) and return a clean copy. */
export function parseVoices(raw: unknown, where = 'sounds'): Voices {
  if (!isObj(raw)) throw new Error(`${where} must be an object keyed by event (${SOUND_EVENTS.join(', ')})`);
  const out: Voices = {};
  for (const [event, v] of Object.entries(raw)) {
    const at = `${where}.${event}`;
    if (!SOUND_EVENTS.includes(event as SoundEvent)) throw new Error(`${at}: unknown event, use ${SOUND_EVENTS.join(', ')}`);
    if (!isObj(v)) throw new Error(`${at} must be an object {wave, gain, notes}`);
    if (!SOUND_WAVES.includes(v.wave as SoundWave)) throw new Error(`${at}.wave must be one of ${SOUND_WAVES.join(', ')}`);
    if (!Array.isArray(v.notes) || !v.notes.length || v.notes.length > SOUND_LIMITS.notes) throw new Error(`${at}.notes must be a list of 1-${SOUND_LIMITS.notes} notes`);
    const notes = v.notes.map((n: unknown, i): SoundNote => {
      const w = `${at}.notes[${i}]`;
      if (!isObj(n)) throw new Error(`${w} must be an object {freq, at, len}`);
      return {
        freq: inRange(n.freq, SOUND_LIMITS.freq.min, SOUND_LIMITS.freq.max, `${w}.freq`),
        at: inRange(n.at, SOUND_LIMITS.at.min, SOUND_LIMITS.at.max, `${w}.at`),
        len: inRange(n.len, SOUND_LIMITS.len.min, SOUND_LIMITS.len.max, `${w}.len`),
      };
    });
    out[event as SoundEvent] = { wave: v.wave as SoundWave, gain: inRange(v.gain, 0, SOUND_LIMITS.gain, `${at}.gain`), notes };
  }
  return out;
}
