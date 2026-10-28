// Claude Code's pixel mascot. It strolls along the composer's top edge while nothing is
// happening and acts out what the agent is doing (thinking, editing, running a command…).
import { useEffect, useRef, useState } from 'react';
import { BUILTIN_PETS, DEFAULT_PET_ID, type PetDef } from '@shared/pets';
import type { MessageKey } from '@shared/i18n';
import { t as tr } from '@/lib/i18n';
import { playSound } from '@/lib/sounds';
import { cn } from '@/lib/utils';
import { useApp } from '@/store/app';
import type { SessionView } from '@/store/types';

export type Mood = 'idle' | 'thinking' | 'typing' | 'running' | 'reading' | 'talking' | 'waiting';

/** What the pet should be doing for this session right now. */
export function moodOf(s: SessionView | undefined): Mood {
  if (s?.compacting) return 'thinking';
  if (!s?.running) return 'idle';
  if (s.waiting) return 'waiting';
  for (let i = s.items.length - 1; i >= 0; i--) {
    const item = s.items[i];
    if (item.kind !== 'group') continue;
    const tool = item.tools.findLast((t) => t.status === 'running');
    if (!tool) break;
    return toolMood(tool.kind);
  }
  if (s.statusText.startsWith('Responding')) return 'talking';
  // A finished tool keeps its pose until the next thing (text, another tool) shows up.
  const last = s.items.at(-1);
  const lastTool = last?.kind === 'group' ? last.tools.at(-1) : undefined;
  return lastTool ? toolMood(lastTool.kind) : 'thinking';
}

function toolMood(kind: string): Mood {
  if (kind === 'edit' || kind === 'write') return 'typing';
  if (kind === 'read' || kind === 'grep' || kind === 'glob' || kind === 'ls') return 'reading';
  return 'running';
}

/** Sprite units are 1.727px wide at size 1; the viewBox is symmetric around the body so mirroring it keeps the body put. */
const UNIT = 38 / 22;
const SPRITE_UNITS = 38;
const PET_W = Math.round(SPRITE_UNITS * UNIT);
const EDGE = 16;
const SPEED = 30; // px per second
const AIR_SPEED = 48; // px per second while hopping
const NEAR = 4; // px: closer than this to its goal counts as already there
const BLOCK_POLL_MS = 250;
const DRAG_THRESHOLD = 3; // px of pointer travel before a press becomes a drag
const JOY_MS = 1400; // how long a double-click reaction lasts
const HELD_LIFT = 8; // px the pet is lifted while the user holds it
const GRAVITY = 1400; // px per second squared
const JUMP_ARC = 12; // px it clears a ledge by at the top of a hop
const MAX_JUMP = 140; // px: a ledge taller than this is a wall
const FOOT = 10; // px either side of its middle that count as standing on a ledge
const LEDGE_GAP = 8; // buttons closer than this form one ledge
const MIN_LEDGE = 2; // px: lower than this is no ledge at all
/** Mark an element that floats over the composer so the pet keeps clear of it. */
export const PET_BLOCK_ATTR = 'data-pet-block';
/** Mark an element sitting above the composer that the pet can hop onto and walk along (chips, the PR bar). */
export const PET_GROUND_ATTR = 'data-pet-ground';
export const PET_GROUND = { [PET_GROUND_ATTR]: '' };
/** Mark a card docked above the composer: the pet moves up to stand on its top edge instead of covering it. */
export const PET_PERCH_ATTR = 'data-pet-perch';
export const PET_PERCH = { [PET_PERCH_ATTR]: '' };
const PERCH_POLL_MS = 250;

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The rightmost spot (left offset) the pet may stand on: the composer's width minus whatever floats over it. */
function walkMax(track: HTMLElement) {
  const t = track.getBoundingClientRect();
  let max = Math.max(EDGE, track.offsetWidth - PET_W - EDGE);
  for (const el of document.querySelectorAll<HTMLElement>(`[${PET_BLOCK_ATTR}]`)) {
    const r = el.getBoundingClientRect();
    if (r.bottom > t.top && r.top < t.bottom && r.right > t.left && r.left < t.right) max = Math.min(max, r.left - t.left - PET_W - EDGE / 2);
  }
  return Math.max(EDGE, max);
}

interface Ledge { l: number; r: number; h: number }

/** The things above the composer the pet can stand on, as spans of the track and their height over its floor. */
function ledgesOf(track: HTMLElement): Ledge[] {
  const t = track.getBoundingClientRect();
  const out: Ledge[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(`[${PET_GROUND_ATTR}]`)) {
    const r = el.getBoundingClientRect();
    const h = t.bottom - r.top;
    if (r.width > 0 && h > MIN_LEDGE && r.bottom <= t.bottom + 1) out.push({ l: r.left - t.left - LEDGE_GAP / 2, r: r.right - t.left + LEDGE_GAP / 2, h });
  }
  return out;
}
/** How high the floor is under a pet whose left edge is at `x`. */
const groundAt = (ledges: Ledge[], x: number) => {
  const mid = x + PET_W / 2;
  return ledges.reduce((top, l) => (mid + FOOT > l.l && mid - FOOT < l.r ? Math.max(top, l.h) : top), 0);
};

interface Body { x: number | null; y: number; vy: number; air: boolean; facing: 1 | -1 }
interface Gait { facing: 1 | -1; walking: boolean; arrived: boolean }

/**
 * Where the pet is, simulated frame by frame: it walks at a steady pace, hops up onto ledges in its way
 * (the new-session chips, the PR bar) and drops off their far side. Idle it wanders to random spots along
 * the track; while `working` it goes to the far right end and stays there. Either way it stays inside what is
 * visible of the composer, even when panels open beside it or float over it. The user can pick it up
 * (`grab` / `dragTo` / `drop`): where it is put down it stays until its job changes (working) or it wanders
 * off again (idle). Position is written straight to `pos`; React only hears about the gait.
 */
function usePatrol(enabled: boolean, working: boolean, track: React.RefObject<HTMLDivElement | null>, pos: React.RefObject<HTMLDivElement | null>) {
  const body = useRef<Body>({ x: null, y: 0, vy: 0, air: false, facing: -1 });
  const [gait, setGait] = useState<Gait>({ facing: -1, walking: false, arrived: false });
  const [held, setHeld] = useState(false);
  /** The `working` value the user dropped it under; while that holds, the pet is not sent back to the right end. */
  const pinnedFor = useRef<boolean | null>(null);
  useEffect(() => {
    const el = track.current;
    const node = pos.current;
    // While held, the effect is torn down: its cleanup stops every walk and timer.
    if (!enabled || !el || !node || held) return;
    if (pinnedFor.current !== working) pinnedFor.current = null;
    const pinned = pinnedFor.current === working;
    const still = reducedMotion();
    const b = body.current;
    let goal: number | null = null;
    let onArrive: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let raf = 0;
    let last = 0;

    const jump = (rise: number) => {
      b.air = true;
      b.vy = Math.sqrt(2 * GRAVITY * (rise + JUMP_ARC));
    };
    const publish = (walking: boolean, arrived: boolean) =>
      setGait((p) => (p.facing === b.facing && p.walking === walking && p.arrived === arrived ? p : { facing: b.facing, walking, arrived }));

    /** Advance the simulation; true while something is still moving. */
    const step = (dt: number) => {
      const max = walkMax(el);
      const ledges = ledgesOf(el);
      const ground = (x: number) => groundAt(ledges, x);
      b.x = Math.min(max, b.x ?? Math.max(EDGE, el.offsetWidth - PET_W - 24));
      let walking = false;
      let arrivedNow = false;
      if (still) {
        if (goal != null) {
          b.x = Math.min(max, goal);
          goal = null;
          arrivedNow = true;
        }
        b.y = ground(b.x);
        b.air = false;
      } else {
        if (!b.air) {
          const g = ground(b.x);
          if (g > b.y + 1) jump(g - b.y); // a ledge appeared under it (the PR bar)
          else if (g < b.y - 1) {
            // walked off a ledge, or it went away
            b.air = true;
            b.vy = 0;
          } else b.y = g;
        }
        if (goal != null) {
          const dist = goal - b.x;
          if (Math.abs(dist) <= 1) {
            b.x = goal;
            goal = null;
            arrivedNow = true;
          } else {
            const dir = dist > 0 ? 1 : -1;
            b.facing = dir;
            const nx = b.x + dir * Math.min(Math.abs(dist), (b.air ? AIR_SPEED : SPEED) * dt);
            const rise = ground(nx) - b.y;
            if (rise <= 1) {
              b.x = nx;
              walking = !b.air;
            } else if (!b.air && rise <= MAX_JUMP) jump(rise); // in the way: hop up onto it
            else if (!b.air) {
              // too tall to climb: stop here
              goal = null;
              arrivedNow = true;
            }
          }
        }
        if (b.air) {
          b.vy -= GRAVITY * dt;
          b.y += b.vy * dt;
          const g = ground(b.x);
          if (b.y <= g && b.vy <= 0) {
            b.y = g;
            b.vy = 0;
            b.air = false;
          }
        }
      }
      node.style.left = `${b.x}px`;
      node.style.bottom = `${b.y}px`;
      node.style.visibility = '';
      publish(walking, goal == null && !b.air);
      if (arrivedNow) {
        const then = onArrive;
        onArrive = undefined;
        then?.();
      }
      return goal != null || b.air;
    };
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      raf = step(dt) ? requestAnimationFrame(frame) : 0;
    };
    const wake = () => {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const setGoal = (to: number, then?: () => void) => {
      goal = to;
      onArrive = then;
      wake();
    };
    const wander = () => {
      setGoal(EDGE + Math.random() * (walkMax(el) - EDGE), () => {
        timer = setTimeout(wander, 2500 + Math.random() * 5000);
      });
    };
    // Follow the composer as panels open, close or resize beside it, float over it, or ledges come and go.
    const check = () => {
      if (working && !pinned && b.x != null) {
        const max = walkMax(el);
        if (Math.abs(max - b.x) > NEAR || goal != null) goal = max;
      }
      wake();
    };

    if (working && !pinned) setGoal(walkMax(el));
    else {
      if (!working && !still) timer = setTimeout(wander, 1500 + Math.random() * 2000);
      wake();
    }
    const observer = new ResizeObserver(check);
    observer.observe(el);
    const poll = setInterval(check, BLOCK_POLL_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      clearInterval(poll);
      observer.disconnect();
      setGait((p) => ({ ...p, walking: false, arrived: false }));
    };
  }, [enabled, working, held, track, pos]);

  const grab = () => setHeld(true);
  const dragTo = (left: number) => {
    const el = track.current;
    const node = pos.current;
    if (!el || !node) return;
    const b = body.current;
    const to = Math.min(walkMax(el), Math.max(EDGE, left));
    if (b.x != null && Math.abs(to - b.x) >= 1) b.facing = to > b.x ? 1 : -1;
    b.x = to;
    b.y = groundAt(ledgesOf(el), to) + HELD_LIFT;
    b.vy = 0;
    node.style.left = `${to}px`;
    node.style.bottom = `${b.y}px`;
    setGait((p) => (p.facing === b.facing ? p : { ...p, facing: b.facing }));
  };
  const drop = () => {
    pinnedFor.current = working;
    body.current.air = true; // falls to whatever is underneath
    setHeld(false);
  };
  return { ...gait, held, grab, dragTo, drop };
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

const GREETED_KEY = 'pet-greeted-on';
const GREETING_MS = 7000;
const GREETING_COUNT = 3;

function greetingFor(date: Date) {
  const h = date.getHours();
  const period = h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 18 ? 'afternoon' : h >= 18 && h < 23 ? 'evening' : 'night';
  return tr(`greet.${period}.${1 + Math.floor(Math.random() * GREETING_COUNT)}` as MessageKey);
}

/** The pet's words: a greeting once per calendar day, and again whenever the skin is switched; null while it is quiet. */
function useDailyGreeting(enabled: boolean, skin: string | undefined) {
  // An object, so the same sentence twice in a row is still a new greeting and restarts the timer.
  const [said, setSaid] = useState<{ text: string } | null>(null);
  const shownSkin = useRef(skin);
  useEffect(() => {
    if (shownSkin.current === skin) return;
    shownSkin.current = skin;
    if (!enabled) return;
    setSaid({ text: greetingFor(new Date()) });
    playSound('speak');
  }, [enabled, skin]);
  useEffect(() => {
    if (!enabled) return;
    const now = new Date();
    const today = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    try {
      if (localStorage.getItem(GREETED_KEY) === today) return;
      localStorage.setItem(GREETED_KEY, today);
    } catch { /* storage unavailable: greet this session only */ }
    setSaid({ text: greetingFor(now) });
    playSound('speak');
  }, [enabled]);
  useEffect(() => {
    if (!said) return;
    const timer = setTimeout(() => setSaid(null), GREETING_MS);
    return () => clearTimeout(timer);
  }, [said]);
  return said?.text ?? null;
}

/** Lives on the top edge of the input box; mark neighbours above it with `PET_GROUND` to give it something to climb. */
export function Clawd({ mood }: { mood: Mood }) {
  const track = useRef<HTMLDivElement>(null);
  const enabled = useApp((s) => s.settings.pet) !== false;
  const skin = useApp((s) => s.settings.petSkin);
  const greeting = useDailyGreeting(enabled, skin);
  const custom = useApp((s) => s.settings.pets);
  const pet = allPets(custom).find((p) => p.id === skin) ?? BUILTIN_PETS.find((p) => p.id === DEFAULT_PET_ID)!;
  const pos = useRef<HTMLDivElement>(null);
  const patrol = usePatrol(enabled, mood !== 'idle', track, pos);
  const press = useRef<{ startX: number; startLeft: number; moved: boolean } | null>(null);
  const [joy, setJoy] = useState(false);
  const joyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(joyTimer.current), []);
  // How far above the input box the docked card's top edge is (0 when nothing is docked).
  // Written straight to the style: while the card animates this runs every frame, and a React render per frame makes the pet stutter.
  useEffect(() => {
    const measure = () => {
      const el = track.current;
      if (!el) return;
      const perch = document.querySelector(`[${PET_PERCH_ATTR}]`);
      const box = el.parentElement;
      const lift = perch && box ? Math.max(0, box.getBoundingClientRect().top - perch.getBoundingClientRect().top) : 0;
      el.style.bottom = lift ? `calc(100% + ${lift}px)` : '';
    };
    measure();
    // The card animates its height: follow it every frame instead of waiting for the next poll.
    const observer = new ResizeObserver(measure);
    let watched: Element | null = null;
    const poll = setInterval(() => {
      const perch = document.querySelector(`[${PET_PERCH_ATTR}]`);
      if (perch !== watched) {
        if (watched) observer.unobserve(watched);
        if (perch) observer.observe(perch);
        watched = perch;
      }
      measure();
    }, PERCH_POLL_MS);
    return () => {
      clearInterval(poll);
      observer.disconnect();
    };
  }, []);
  if (!enabled) return null;
  const { facing, walking, arrived, held } = patrol;
  const left = (el: HTMLElement) => el.getBoundingClientRect().left - track.current!.getBoundingClientRect().left;
  return (
    <div ref={track} className="pointer-events-none absolute inset-x-0 bottom-full h-[34px]" aria-hidden>
      <div
        ref={pos}
        className={cn('clawd-pos pointer-events-auto absolute bottom-0 touch-none select-none', held ? 'cursor-grabbing' : 'cursor-grab')}
        // Hidden until the first step has put it somewhere; position is written by `usePatrol`.
        style={{ left: 0, bottom: 0, visibility: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
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
          playSound('pet');
          setJoy(true);
          joyTimer.current = setTimeout(() => setJoy(false), JOY_MS);
        }}
      >
        {greeting && (
          <div className="pointer-events-none absolute bottom-full left-1/2 mb-1 w-max max-w-[220px] -translate-x-1/2 animate-in rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md duration-300 fade-in-0 slide-in-from-bottom-1">
            {greeting}
          </div>
        )}
        <PetSprite pet={pet} mood={walking || !arrived ? 'idle' : mood} walking={walking} held={held} joy={joy} facing={facing} />
      </div>
    </div>
  );
}
