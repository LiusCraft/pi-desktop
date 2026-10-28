// Plays the app's synthesized sounds (Web Audio), so the app ships no audio files. The active pet
// skin may bring its own voices; see `@shared/sounds`.
import { BUILTIN_PETS, type PetDef } from '@shared/pets';
import { DEFAULT_VOICES, type SoundEvent, type Voices } from '@shared/sounds';
import { getApp } from '@/store/app';

const ATTACK = 0.01; // seconds to fade a note in, so it does not click

let ctx: AudioContext | undefined;

/** Play the active pet's sound for `event`, unless sounds or that event are switched off. */
export function playSound(event: SoundEvent) {
  const { sound, soundOff, pets, petSkin } = getApp().settings;
  if (sound === false || soundOff?.includes(event)) return;
  previewSound(event, petVoices(petSkin, pets));
}

/** The voices of the skin `id` (built-in or custom). */
export function petVoices(id: string | undefined, custom: readonly PetDef[] | undefined): Voices | undefined {
  return [...BUILTIN_PETS, ...(custom ?? [])].find((p) => p.id === id)?.sounds;
}

/** Play the sound for `event` whatever the settings say (the Settings window's listen button); `own` is a pet's voices. */
export function previewSound(event: SoundEvent, own?: Voices) {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const voice = own?.[event] ?? DEFAULT_VOICES[event];
    const start = ctx.currentTime;
    for (const note of voice.notes) {
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      const from = start + note.at;
      osc.type = voice.wave;
      osc.frequency.value = note.freq;
      amp.gain.setValueAtTime(0, from);
      amp.gain.linearRampToValueAtTime(voice.gain, from + ATTACK);
      amp.gain.exponentialRampToValueAtTime(0.0001, from + note.len);
      osc.connect(amp).connect(ctx.destination);
      osc.start(from);
      osc.stop(from + note.len + 0.02);
    }
  } catch {
    // No audio device or the browser refused to start audio: stay silent.
  }
}
