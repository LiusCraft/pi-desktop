// One-shot reactions for the pet: a turn finished, or something went wrong.
export type PetCue = 'done' | 'error';

type Listener = (cue: PetCue) => void;

const listeners = new Set<Listener>();

export function cuePet(cue: PetCue) {
  listeners.forEach((l) => l(cue));
}

export function onPetCue(listener: Listener) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
