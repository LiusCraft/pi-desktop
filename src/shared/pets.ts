// The pet skins. A skin is a pixel drawing made of rectangles on a 22 x 14 grid (the body sits at
// x 0..22, y -4..14), exactly how the built-in pets below are made. A rectangle can carry a `part`;
// the stylesheet animates parts by name (legs step, arms tap, eyes blink / scan, the mouth talks,
// the tail swings), so a custom skin gets the same moods as the built-in ones for free.

/** Parts the stylesheet knows how to animate. */
export const PET_PARTS = ['leg a', 'leg b', 'arm l', 'arm r', 'tail', 'eyes', 'mouth'] as const;
export type PetPart = (typeof PET_PARTS)[number];

export interface PetRect {
  x: number;
  y: number;
  w: number;
  h: number;
  part?: PetPart;
}
/** Rectangles sharing a fill; `part` on the shape applies to all of its rectangles (the two eyes). */
export interface PetShape {
  fill: string;
  part?: PetPart;
  rects: PetRect[];
}
export interface PetDef {
  id: string;
  label: string;
  /** Painted first to last. */
  shapes: PetShape[];
}

/** The drawing area in sprite units; the sprite's viewBox is wider only to make room for props. */
export const PET_GRID = { minX: -8, maxX: 30, minY: -6, maxY: 14 } as const;
export const PET_LIMITS = { label: 20, shapes: 24, rects: 160 } as const;
const PET_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const PET_FILL = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export const BUILTIN_PETS: readonly PetDef[] = [
  {
    id: 'clawd',
    label: 'Clawd',
    shapes: [
      {
        fill: '#d97757',
        rects: [
          { x: 4, y: 10, w: 2, h: 4, part: 'leg a' },
          { x: 8, y: 10, w: 2, h: 4, part: 'leg b' },
          { x: 12, y: 10, w: 2, h: 4, part: 'leg a' },
          { x: 16, y: 10, w: 2, h: 4, part: 'leg b' },
          { x: 0, y: 4, w: 3, h: 3, part: 'arm l' },
          { x: 19, y: 4, w: 3, h: 3, part: 'arm r' },
          { x: 3, y: 0, w: 16, h: 10 },
        ],
      },
      { fill: '#141413', part: 'eyes', rects: [{ x: 6, y: 3, w: 2, h: 2 }, { x: 14, y: 3, w: 2, h: 2 }] },
      { fill: '#141413', rects: [{ x: 10, y: 7, w: 2, h: 1, part: 'mouth' }] },
    ],
  },
  {
    id: 'cat',
    label: '像素猫',
    shapes: [
      {
        fill: '#e0a458',
        rects: [
          { x: 19, y: 5, w: 3, h: 2, part: 'tail' },
          { x: 4, y: 10, w: 2, h: 4, part: 'leg a' },
          { x: 8, y: 10, w: 2, h: 4, part: 'leg b' },
          { x: 12, y: 10, w: 2, h: 4, part: 'leg a' },
          { x: 16, y: 10, w: 2, h: 4, part: 'leg b' },
          { x: 0, y: 4, w: 3, h: 3, part: 'arm l' },
          { x: 3, y: 0, w: 16, h: 10 },
          { x: 3, y: -2, w: 3, h: 3 },
          { x: 16, y: -2, w: 3, h: 3 },
        ],
      },
      { fill: '#f2b8b0', rects: [{ x: 4, y: -1, w: 1, h: 2 }, { x: 17, y: -1, w: 1, h: 2 }, { x: 10, y: 5, w: 2, h: 1 }] },
      { fill: '#b9763a', rects: [{ x: 7, y: 0, w: 1, h: 2 }, { x: 10, y: 0, w: 2, h: 1 }, { x: 14, y: 0, w: 1, h: 2 }] },
      { fill: '#141413', part: 'eyes', rects: [{ x: 6, y: 3, w: 2, h: 2 }, { x: 14, y: 3, w: 2, h: 2 }] },
      { fill: '#141413', rects: [{ x: 10, y: 7, w: 2, h: 1, part: 'mouth' }] },
    ],
  },
  {
    id: 'robot',
    label: '机器人',
    shapes: [
      {
        fill: '#8aa4bd',
        rects: [
          { x: 10, y: -3, w: 2, h: 3 },
          { x: 4, y: 10, w: 2, h: 4, part: 'leg a' },
          { x: 8, y: 10, w: 2, h: 4, part: 'leg b' },
          { x: 12, y: 10, w: 2, h: 4, part: 'leg a' },
          { x: 16, y: 10, w: 2, h: 4, part: 'leg b' },
          { x: 0, y: 4, w: 3, h: 3, part: 'arm l' },
          { x: 19, y: 4, w: 3, h: 3, part: 'arm r' },
          { x: 3, y: 0, w: 16, h: 10 },
        ],
      },
      { fill: '#e5675a', rects: [{ x: 9, y: -4, w: 4, h: 2 }] },
      { fill: '#1f2a37', rects: [{ x: 5, y: 2, w: 12, h: 6 }] },
      { fill: '#7ee0b0', part: 'eyes', rects: [{ x: 6, y: 3, w: 2, h: 2 }, { x: 14, y: 3, w: 2, h: 2 }] },
      { fill: '#7ee0b0', rects: [{ x: 9, y: 6, w: 4, h: 1, part: 'mouth' }] },
    ],
  },
];
export const BUILTIN_PET_IDS: readonly string[] = BUILTIN_PETS.map((p) => p.id);
/** The skin used when the saved one is missing or was deleted. */
export const DEFAULT_PET_ID = BUILTIN_PETS[0].id;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fail = (msg: string): never => {
  throw new Error(msg);
};

function parsePart(v: unknown, where: string): PetPart | undefined {
  if (v === undefined) return undefined;
  if (!PET_PARTS.includes(v as PetPart)) fail(`${where}.part must be one of ${PET_PARTS.join(', ')}`);
  return v as PetPart;
}

function parseRect(v: unknown, where: string): PetRect {
  if (!isObj(v)) return fail(`${where} must be an object {x,y,w,h}`);
  const [x, y, w, h] = (['x', 'y', 'w', 'h'] as const).map((k) => {
    const n = v[k];
    return Number.isInteger(n) ? (n as number) : fail(`${where}.${k} must be an integer`);
  });
  if (w < 1 || h < 1) fail(`${where}: w and h must be at least 1`);
  const { minX, maxX, minY, maxY } = PET_GRID;
  if (x < minX || y < minY || x + w > maxX || y + h > maxY) fail(`${where}: must stay inside x ${minX}..${maxX}, y ${minY}..${maxY}`);
  const part = parsePart(v.part, where);
  return part ? { x, y, w, h, part } : { x, y, w, h };
}

/** Check an untrusted pet definition (file, pasted JSON, model output) and return a clean copy. */
export function parsePetDef(raw: unknown): PetDef {
  if (!isObj(raw)) return fail('A pet must be a JSON object {id, label, shapes}');
  const { id, label, shapes } = raw;
  if (typeof id !== 'string' || !PET_ID.test(id)) fail('id must be lowercase letters, digits and - (1-32 chars, not starting with -)');
  if (typeof label !== 'string' || !label.trim() || label.trim().length > PET_LIMITS.label) fail(`label must be 1-${PET_LIMITS.label} characters`);
  if (!Array.isArray(shapes) || !shapes.length || shapes.length > PET_LIMITS.shapes) fail(`shapes must be a list of 1-${PET_LIMITS.shapes} shapes`);
  let total = 0;
  const clean = (shapes as unknown[]).map((s, i): PetShape => {
    const where = `shapes[${i}]`;
    if (!isObj(s)) return fail(`${where} must be an object {fill, rects}`);
    if (typeof s.fill !== 'string' || !PET_FILL.test(s.fill)) fail(`${where}.fill must be a hex colour like #d97757`);
    if (!Array.isArray(s.rects) || !s.rects.length) fail(`${where}.rects must be a non-empty list`);
    total += (s.rects as unknown[]).length;
    if (total > PET_LIMITS.rects) fail(`too many rectangles (max ${PET_LIMITS.rects})`);
    const part = parsePart(s.part, where);
    const rects = (s.rects as unknown[]).map((r, j) => parseRect(r, `${where}.rects[${j}]`));
    return part ? { fill: s.fill as string, part, rects } : { fill: s.fill as string, rects };
  });
  return { id: id as string, label: (label as string).trim(), shapes: clean };
}
