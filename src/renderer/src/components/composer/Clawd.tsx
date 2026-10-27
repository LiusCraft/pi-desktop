// Claude Code's pixel mascot. It strolls along the composer's top edge while nothing is
// happening and acts out what the agent is doing (thinking, editing, running a command…).
import { useEffect, useRef, useState } from 'react';
import { BUILTIN_PETS, DEFAULT_PET_ID, type PetDef } from '@shared/pets';
import { cn } from '@/lib/utils';
import { useApp } from '@/store/app';
import type { SessionView } from '@/store/types';

export type Mood = 'idle' | 'thinking' | 'typing' | 'running' | 'reading' | 'talking' | 'waiting';

/** What the pet should be doing for this session right now. */
export function moodOf(s: SessionView | undefined): Mood {
  if (!s?.running) return 'idle';
  if (s.waiting) return 'waiting';
  for (let i = s.items.length - 1; i >= 0; i--) {
    const item = s.items[i];
    if (item.kind !== 'group') continue;
    const tool = item.tools.findLast((t) => t.status === 'running');
    if (!tool) break;
    if (tool.kind === 'edit' || tool.kind === 'write') return 'typing';
    if (tool.kind === 'read' || tool.kind === 'grep' || tool.kind === 'glob' || tool.kind === 'ls') return 'reading';
    return 'running';
  }
  return s.statusText.startsWith('Responding') ? 'talking' : 'thinking';
}

/** Sprite units are 1.727px wide at size 1; the viewBox is symmetric around the body so mirroring it keeps the body put. */
const UNIT = 38 / 22;
const SPRITE_UNITS = 38;
const PET_W = Math.round(SPRITE_UNITS * UNIT);
const EDGE = 16;
const SPEED = 30; // px per second
const NEAR = 4; // px: closer than this counts as already there
const BLOCK_POLL_MS = 400;
const DRAG_THRESHOLD = 3; // px of pointer travel before a press becomes a drag
const JOY_MS = 1400; // how long a double-click reaction lasts
const HELD_LIFT = 8; // px the pet is lifted while the user holds it
/** Mark an element that floats over the composer so the pet keeps clear of it. */
export const PET_BLOCK_ATTR = 'data-pet-block';

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The stretch of the track (left offsets) the pet may stand on: the composer's width minus whatever floats over it. `from` is the leftmost share it may use. */
function walkRange(track: HTMLElement, from: number) {
  const width = track.offsetWidth;
  const t = track.getBoundingClientRect();
  let max = Math.max(EDGE, width - PET_W - EDGE);
  for (const el of document.querySelectorAll<HTMLElement>(`[${PET_BLOCK_ATTR}]`)) {
    const r = el.getBoundingClientRect();
    if (r.bottom > t.top && r.top < t.bottom && r.right > t.left && r.left < t.right) max = Math.min(max, r.left - t.left - PET_W - EDGE / 2);
  }
  max = Math.max(EDGE, max);
  return { min: Math.min(max, Math.max(EDGE, width * from)), max };
}

interface Patrol { x: number | null; facing: 1 | -1; walking: boolean; dur: number; arrived: boolean }

/**
 * Where the pet is. Idle it wanders to random spots along the track; while `working` it walks to the
 * far right end and stays there. Either way it stays inside what is visible of the composer, even when
 * panels open beside it or float over it. The user can pick it up (`grab` / `dragTo` / `drop`): where it is
 * put down it stays until its job changes (working) or it wanders off again (idle).
 */
function usePatrol(enabled: boolean, working: boolean, track: React.RefObject<HTMLDivElement | null>, from = 0) {
  const x = useRef<number | null>(null);
  const [state, setState] = useState<Patrol>({ x: null, facing: -1, walking: false, dur: 0, arrived: false });
  const [held, setHeld] = useState(false);
  /** The `working` value the user dropped it under; while that holds, the pet is not sent back to the right end. */
  const pinnedFor = useRef<boolean | null>(null);
  useEffect(() => {
    const el = track.current;
    // While held, the effect is torn down: its cleanup freezes the pet where it is and cancels every walk.
    if (!enabled || !el || held) return;
    if (pinnedFor.current !== working) pinnedFor.current = null;
    const pinned = pinnedFor.current === working;
    const still = reducedMotion();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const goTo = (to: number, instant: boolean, then?: () => void) => {
      clearTimeout(timer);
      const start = x.current ?? to;
      const dist = Math.abs(to - start);
      const dur = instant || still ? 0 : dist / SPEED;
      const walking = dur > 0 && dist > NEAR;
      x.current = to;
      setState((p) => ({ x: to, facing: dist > NEAR ? (to >= start ? 1 : -1) : p.facing, walking, dur, arrived: !walking }));
      const arrive = () => {
        setState((p) => ({ ...p, walking: false, arrived: true }));
        then?.();
      };
      if (walking) timer = setTimeout(arrive, dur * 1000);
      else then?.();
    };
    // Pin the starting spot with `left`, so the first walk animates instead of jumping.
    if (x.current == null) {
      x.current = walkRange(el, from).max;
      setState((p) => ({ ...p, x: x.current, dur: 0 }));
    }
    const wander = () => {
      const { min, max } = walkRange(el, from);
      goTo(min + Math.random() * (max - min), false, () => {
        timer = setTimeout(wander, 2500 + Math.random() * 5000);
      });
    };
    if (working && pinned) setState((p) => ({ ...p, arrived: true }));
    else if (working) goTo(walkRange(el, from).max, false);
    else if (!still) timer = setTimeout(wander, 1500 + Math.random() * 2000);
    // Follow the composer as panels open, close or resize beside it, or float over it.
    const fit = () => {
      const { max } = walkRange(el, from);
      const at = x.current ?? max;
      if (at > max) goTo(max, true);
      else if (working && !pinned && at < max - NEAR) goTo(max, false);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    const poll = setInterval(fit, BLOCK_POLL_MS);
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      observer.disconnect();
      // Stop where it is right now instead of finishing the walk.
      const pos = el.querySelector<HTMLElement>('.clawd-pos');
      if (pos) x.current = pos.getBoundingClientRect().left - el.getBoundingClientRect().left;
      setState((p) => ({ ...p, x: x.current, walking: false, dur: 0, arrived: false }));
    };
  }, [enabled, working, held, track, from]);
  const grab = () => setHeld(true);
  const dragTo = (left: number) => {
    const el = track.current;
    if (!el) return;
    const to = Math.min(walkRange(el, 0).max, Math.max(EDGE, left));
    const prev = x.current ?? to;
    x.current = to;
    setState((p) => ({ ...p, x: to, facing: Math.abs(to - prev) >= 1 ? (to > prev ? 1 : -1) : p.facing, walking: false, dur: 0 }));
  };
  const drop = () => {
    pinnedFor.current = working;
    setHeld(false);
  };
  return { ...state, held, grab, dragTo, drop };
}

/** Every skin the user can pick: the built-in pets, then their own. */
export function allPets(custom: readonly PetDef[] | undefined): PetDef[] {
  return [...BUILTIN_PETS, ...(custom ?? [])];
}

/** One pet drawn from its definition; limbs, eyes and mouth keep their part names so one set of CSS animates every skin. */
function Body({ pet }: { pet: PetDef }) {
  return (
    <>
      {pet.shapes.map((shape, i) => (
        <g key={i} fill={shape.fill} className={shape.part}>
          {shape.rects.map((r, j) => (
            <rect key={j} className={r.part} x={r.x} y={r.y} width={r.w} height={r.h} />
          ))}
        </g>
      ))}
    </>
  );
}

/** A small computer beside the pet; the keyboard shows while editing, the prompt while running a command. */
function MonitorProp() {
  return (
    <>
      <g className="prop prop-screen" fill="#55534d">
        <rect x="23" y="-1" width="7" height="6" />
        <rect x="26" y="5" width="1" height="3" />
      </g>
      <rect className="prop prop-screen" x="24" y="0" width="5" height="4" fill="#1f2a37" />
      <g className="prop prop-typing">
        <g className="lines" fill="#7ee0b0">
          <rect x="25" y="1" width="3" height="1" />
          <rect x="25" y="3" width="2" height="1" />
        </g>
        <rect x="22" y="8" width="7" height="1" fill="#55534d" />
      </g>
      <g className="prop prop-running" fill="#7ee0b0">
        <rect x="25" y="1" width="1" height="1" />
        <rect className="cursor" x="27" y="3" width="2" height="1" />
      </g>
    </>
  );
}

/** One frame of the pet. The composer animates it by mood; the settings page shows it still. */
export function PetSprite({ pet, mood = 'idle', walking = false, held = false, joy = false, facing = 1, size = 1 }: { pet: PetDef; mood?: Mood; walking?: boolean; held?: boolean; joy?: boolean; facing?: 1 | -1; size?: number }) {
  return (
    <svg
      className={cn('clawd', `mood-${mood}`, walking && 'walking', held && 'held', joy && 'joy')}
      // Inline size: the settings tiles' toggle buttons force `svg` to 1rem unless the size is set on the element itself.
      style={{ transform: `scaleX(${facing})`, width: PET_W * size, height: 34 * size }}
      viewBox={`-8 -6 ${SPRITE_UNITS} 20`}
      shapeRendering="crispEdges"
    >
      <g className="fx-think" fill="currentColor">
        <rect x="12" y="-3" width="2" height="2" />
        <rect x="15" y="-4" width="2" height="2" />
        <rect x="18" y="-5" width="2" height="2" />
      </g>
      <g className="fx-alert" fill="#d97757">
        <rect x="10" y="-6" width="2" height="3" />
        <rect x="10" y="-2" width="2" height="1" />
      </g>
      <g className="fx-heart" fill="#e5675a">
        <rect x="9" y="-5" width="2" height="1" />
        <rect x="12" y="-5" width="2" height="1" />
        <rect x="9" y="-4" width="5" height="1" />
        <rect x="10" y="-3" width="3" height="1" />
        <rect x="11" y="-2" width="1" height="1" />
      </g>
      <rect className="fx-sweat" x="20" y="-2" width="1" height="2" fill="var(--info)" />
      <MonitorProp />
      <g className="prop prop-reading">
        <rect x="22" y="3" width="7" height="5" fill="#f3efe3" />
        <rect x="25" y="3" width="1" height="5" fill="#b9763a" />
        <g className="lines" fill="#9b9588">
          <rect x="23" y="4" width="2" height="1" />
          <rect x="23" y="6" width="2" height="1" />
          <rect x="26" y="4" width="2" height="1" />
          <rect x="26" y="6" width="2" height="1" />
        </g>
      </g>
      <g className="pet"><Body pet={pet} /></g>
    </svg>
  );
}

/** `from`: keep to the right of this share of the width (e.g. clear of the new-session chips). */
export function Clawd({ mood, from }: { mood: Mood; from?: number }) {
  const track = useRef<HTMLDivElement>(null);
  const enabled = useApp((s) => s.settings.pet) !== false;
  const skin = useApp((s) => s.settings.petSkin);
  const custom = useApp((s) => s.settings.pets);
  const pet = allPets(custom).find((p) => p.id === skin) ?? BUILTIN_PETS.find((p) => p.id === DEFAULT_PET_ID)!;
  const patrol = usePatrol(enabled, mood !== 'idle', track, from);
  const press = useRef<{ startX: number; startLeft: number; moved: boolean } | null>(null);
  const [joy, setJoy] = useState(false);
  const joyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(joyTimer.current), []);
  if (!enabled) return null;
  const { x, facing, walking, dur, arrived, held } = patrol;
  const left = (el: HTMLElement) => el.getBoundingClientRect().left - track.current!.getBoundingClientRect().left;
  return (
    <div ref={track} className="pointer-events-none absolute inset-x-0 -top-[33px] h-[34px]" aria-hidden>
      <div
        className={cn('clawd-pos pointer-events-auto absolute bottom-0 touch-none select-none', held ? 'cursor-grabbing' : 'cursor-grab')}
        style={{ ...(x == null ? { right: 24 } : { left: x, transition: `left ${dur}s linear, transform 0.12s` }), transform: held ? `translateY(-${HELD_LIFT}px)` : undefined }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          press.current = { startX: e.clientX, startLeft: left(e.currentTarget), moved: false };
        }}
        onPointerMove={(e) => {
          const p = press.current;
          if (!p) return;
          const dx = e.clientX - p.startX;
          if (!p.moved) {
            if (Math.abs(dx) < DRAG_THRESHOLD) return;
            p.moved = true;
            patrol.grab();
          }
          patrol.dragTo(p.startLeft + dx);
        }}
        onPointerUp={() => {
          if (press.current?.moved) patrol.drop();
          press.current = null;
        }}
        onPointerCancel={() => {
          if (press.current?.moved) patrol.drop();
          press.current = null;
        }}
        onDoubleClick={() => {
          clearTimeout(joyTimer.current);
          setJoy(true);
          joyTimer.current = setTimeout(() => setJoy(false), JOY_MS);
        }}
      >
        <PetSprite pet={pet} mood={walking || !arrived ? 'idle' : mood} walking={walking} held={held} joy={joy} facing={facing} />
      </div>
    </div>
  );
}
