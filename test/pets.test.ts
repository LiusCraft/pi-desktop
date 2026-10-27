// Pet skins share one drawing format with the built-in pets; the Settings page and the chat tools both store them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listPets, removePet, savePet } from '../src/agent/pets';
import { registerManageTools } from '../src/agent/manage-tools';
import { BUILTIN_PETS, parsePetDef } from '../src/shared/pets';

const fox = {
  id: 'fox',
  label: '小狐狸',
  shapes: [
    { fill: '#e07b39', rects: [{ x: 3, y: 0, w: 16, h: 10 }, { x: 4, y: 10, w: 2, h: 4, part: 'leg a' }] },
    { fill: '#141413', part: 'eyes', rects: [{ x: 6, y: 3, w: 2, h: 2 }] },
  ],
};

describe('parsePetDef', () => {
  it('accepts every built-in pet unchanged', () => {
    for (const pet of BUILTIN_PETS) expect(parsePetDef(JSON.parse(JSON.stringify(pet)))).toEqual(pet);
  });

  it.each([
    ['a bad id', { ...fox, id: 'Fox!' }, /id must be/],
    ['a bad colour', { ...fox, shapes: [{ fill: 'red', rects: fox.shapes[0].rects }] }, /fill must be a hex/],
    ['an unknown part', { ...fox, shapes: [{ fill: '#fff', rects: [{ x: 0, y: 0, w: 1, h: 1, part: 'wing' }] }] }, /part must be one of/],
    ['a rectangle off the grid', { ...fox, shapes: [{ fill: '#fff', rects: [{ x: 28, y: 0, w: 5, h: 1 }] }] }, /must stay inside/],
    ['a fractional size', { ...fox, shapes: [{ fill: '#fff', rects: [{ x: 0, y: 0, w: 1.5, h: 1 }] }] }, /integer/],
    ['no shapes', { ...fox, shapes: [] }, /shapes must be/],
  ])('rejects %s', (_name, pet, message) => {
    expect(() => parsePetDef(pet)).toThrow(message);
  });
});

describe('pet files', () => {
  let dir: string;
  beforeEach(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pets-'))));
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('saves, lists, replaces and removes a skin', () => {
    expect(listPets(path.join(dir, 'none'))).toEqual([]);
    savePet(dir, fox);
    savePet(dir, { ...fox, label: '红狐狸' });
    expect(listPets(dir)).toMatchObject([{ id: 'fox', label: '红狐狸' }]);
    removePet(dir, 'fox');
    expect(listPets(dir)).toEqual([]);
  });

  it('will not shadow a built-in pet and skips broken files', () => {
    expect(() => savePet(dir, { ...fox, id: 'cat' })).toThrow(/built-in/);
    fs.writeFileSync(path.join(dir, 'broken.json'), '{nope');
    fs.writeFileSync(path.join(dir, 'cat.json'), JSON.stringify({ ...fox, id: 'cat' }));
    expect(listPets(dir)).toEqual([]);
  });
});

describe('pidesk_pet tools', () => {
  it('shows the built-in format, then saves a skin the model drew', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pets-'));
    const tools = new Map<string, any>();
    registerManageTools({ registerTool: (t: any) => tools.set(t.name, t) } as any, {
      pets: { list: () => listPets(dir), save: (raw) => savePet(dir, raw), remove: (id) => removePet(dir, id) },
    });
    expect((await tools.get('pidesk_pet_list').execute()).content[0].text).toContain('"id":"clawd"');
    const out = await tools.get('pidesk_pet_manage').execute('c', { action: 'save', ...fox });
    expect(out.content[0].text).toMatch(/Saved pet "小狐狸"/);
    expect(listPets(dir)).toHaveLength(1);
    await expect(tools.get('pidesk_pet_manage').execute('c', { action: 'save', id: 'bad', label: 'x', shapes: [] })).rejects.toThrow(/shapes/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
