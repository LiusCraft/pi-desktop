/**
 * The user's own pet skins: `<app data>/pets/<id>.json`, each one a `PetDef` (see `@shared/pets`).
 * The Settings page and the model's `pidesk_pet_*` tools both go through here, so a skin is
 * checked the same way wherever it comes from. Unreadable or invalid files are skipped.
 */
import fs from 'node:fs';
import path from 'node:path';
import { BUILTIN_PET_IDS, parsePetDef, type PetDef } from '@shared/pets';

const file = (dir: string, id: string) => path.join(dir, `${id}.json`);

export function listPets(dir: string): PetDef[] {
  let names: string[];
  try {
    names = fs
      .readdirSync(dir)
      .filter((n) => n.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
  const pets: PetDef[] = [];
  for (const name of names) {
    try {
      const pet = parsePetDef(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
      if (name === `${pet.id}.json` && !BUILTIN_PET_IDS.includes(pet.id)) pets.push(pet);
    } catch {
      // A hand-edited file that no longer parses just does not show up.
    }
  }
  return pets;
}

/** Validate and store a skin, replacing one with the same id. */
export function savePet(dir: string, raw: unknown): PetDef {
  const pet = parsePetDef(raw);
  if (BUILTIN_PET_IDS.includes(pet.id)) throw new Error(`"${pet.id}" is a built-in pet; pick another id`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    file(dir, pet.id),
    `${JSON.stringify(pet, null, 2)}
`,
  );
  return pet;
}

export function removePet(dir: string, id: string) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error('Invalid pet id');
  fs.rmSync(file(dir, id), { force: true });
}
