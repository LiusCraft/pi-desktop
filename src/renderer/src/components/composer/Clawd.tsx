// Claude Code's pixel mascot. It strolls along the composer's top edge while nothing is
// happening and acts out what the agent is doing (thinking, editing, running a command…).
import { useEffect, useRef, useState } from 'react';
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

const PET_W = 38;
const EDGE = 16;
const SPEED = 30; // px per second

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Wander to random spots along the track while `enabled`, pausing between walks. `from` is the leftmost share of the track it may use. */
function usePatrol(enabled: boolean, track: React.RefObject<HTMLDivElement | null>, from = 0) {
  const x = useRef<number | null>(null);
  const [state, setState] = useState<{ x: number | null; facing: 1 | -1; walking: boolean; dur: number }>({ x: null, facing: -1, walking: false, dur: 0 });
  useEffect(() => {
    if (!enabled || reducedMotion()) {
      setState((p) => ({ ...p, walking: false, dur: 0 }));
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    // Pin the starting spot with `left`, so the first walk animates instead of jumping.
    if (x.current == null && track.current) {
      x.current = Math.max(EDGE, track.current.offsetWidth - PET_W - 24);
      setState((p) => ({ ...p, x: x.current, dur: 0 }));
    }
    const walk = () => {
      const width = track.current?.offsetWidth ?? 0;
      const max = Math.max(EDGE, width - PET_W - EDGE);
      const min = Math.min(max, Math.max(EDGE, width * from));
      const start = x.current ?? max;
      const to = min + Math.random() * (max - min);
      const dist = Math.abs(to - start);
      const dur = dist / SPEED;
      x.current = to;
      setState({ x: to, facing: to >= start ? 1 : -1, walking: dist > 4, dur });
      timer = setTimeout(() => {
        setState((p) => ({ ...p, walking: false }));
        timer = setTimeout(walk, 2500 + Math.random() * 5000);
      }, dur * 1000);
    };
    timer = setTimeout(walk, 1500 + Math.random() * 2000);
    return () => {
      clearTimeout(timer);
      // Stop where it is right now instead of finishing the walk.
      const el = track.current?.querySelector<HTMLElement>('.clawd-pos');
      if (el && track.current) x.current = el.getBoundingClientRect().left - track.current.getBoundingClientRect().left;
      setState((p) => ({ ...p, x: x.current, walking: false, dur: 0 }));
    };
  }, [enabled, track, from]);
  return state;
}

export const PET_SKINS = [
  { id: 'clawd', label: 'Clawd' },
  { id: 'cat', label: '像素猫' },
  { id: 'robot', label: '机器人' },
] as const;
export type PetSkin = (typeof PET_SKINS)[number]['id'];
const skinOf = (id: string | undefined): PetSkin => PET_SKINS.find((s) => s.id === id)?.id ?? 'clawd';

/** Everything that differs between skins; limbs/eyes/mouth keep their class names so one set of CSS animates them all. */
function Body({ skin }: { skin: PetSkin }) {
  if (skin === 'cat') {
    return (
      <>
        <g fill="#e0a458">
          <rect className="tail" x="19" y="5" width="3" height="2" />
          <rect className="leg a" x="4" y="10" width="2" height="4" />
          <rect className="leg b" x="8" y="10" width="2" height="4" />
          <rect className="leg a" x="12" y="10" width="2" height="4" />
          <rect className="leg b" x="16" y="10" width="2" height="4" />
          <rect className="arm l" x="0" y="4" width="3" height="3" />
          <rect x="3" y="0" width="16" height="10" />
          <rect x="3" y="-2" width="3" height="3" />
          <rect x="16" y="-2" width="3" height="3" />
        </g>
        <g fill="#f2b8b0">
          <rect x="4" y="-1" width="1" height="2" />
          <rect x="17" y="-1" width="1" height="2" />
          <rect x="10" y="5" width="2" height="1" />
        </g>
        <g fill="#b9763a">
          <rect x="7" y="0" width="1" height="2" />
          <rect x="10" y="0" width="2" height="1" />
          <rect x="14" y="0" width="1" height="2" />
        </g>
        <g className="eyes" fill="#141413">
          <rect x="6" y="3" width="2" height="2" />
          <rect x="14" y="3" width="2" height="2" />
        </g>
        <rect className="mouth" x="10" y="7" width="2" height="1" fill="#141413" />
      </>
    );
  }
  if (skin === 'robot') {
    return (
      <>
        <g fill="#8aa4bd">
          <rect x="10" y="-3" width="2" height="3" />
          <rect className="leg a" x="4" y="10" width="2" height="4" />
          <rect className="leg b" x="8" y="10" width="2" height="4" />
          <rect className="leg a" x="12" y="10" width="2" height="4" />
          <rect className="leg b" x="16" y="10" width="2" height="4" />
          <rect className="arm l" x="0" y="4" width="3" height="3" />
          <rect className="arm r" x="19" y="4" width="3" height="3" />
          <rect x="3" y="0" width="16" height="10" />
        </g>
        <rect x="9" y="-4" width="4" height="2" fill="#e5675a" />
        <rect x="5" y="2" width="12" height="6" fill="#1f2a37" />
        <g className="eyes" fill="#7ee0b0">
          <rect x="6" y="3" width="2" height="2" />
          <rect x="14" y="3" width="2" height="2" />
        </g>
        <rect className="mouth" x="9" y="6" width="4" height="1" fill="#7ee0b0" />
      </>
    );
  }
  return (
    <>
      <g fill="#d97757">
        <rect className="leg a" x="4" y="10" width="2" height="4" />
        <rect className="leg b" x="8" y="10" width="2" height="4" />
        <rect className="leg a" x="12" y="10" width="2" height="4" />
        <rect className="leg b" x="16" y="10" width="2" height="4" />
        <rect className="arm l" x="0" y="4" width="3" height="3" />
        <rect className="arm r" x="19" y="4" width="3" height="3" />
        <rect x="3" y="0" width="16" height="10" />
      </g>
      <g className="eyes" fill="#141413">
        <rect x="6" y="3" width="2" height="2" />
        <rect x="14" y="3" width="2" height="2" />
      </g>
      <rect className="mouth" x="10" y="7" width="2" height="1" fill="#141413" />
    </>
  );
}

/** One frame of the pet. The composer animates it by mood; the settings page shows it still. */
export function PetSprite({ skin, mood = 'idle', walking = false, facing = 1, size = 1 }: { skin: string | undefined; mood?: Mood; walking?: boolean; facing?: 1 | -1; size?: number }) {
  return (
    <svg
      className={cn('clawd', `mood-${mood}`, walking && 'walking')}
      style={{ transform: `scaleX(${facing})` }}
      viewBox="0 -6 22 20"
      width={PET_W * size}
      height={34 * size}
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
      <rect className="fx-sweat" x="20" y="-2" width="1" height="2" fill="var(--info)" />
      <g className="pet"><Body skin={skinOf(skin)} /></g>
    </svg>
  );
}

/** `from`: keep to the right of this share of the width (e.g. clear of the new-session chips). */
export function Clawd({ mood, from }: { mood: Mood; from?: number }) {
  const track = useRef<HTMLDivElement>(null);
  const enabled = useApp((s) => s.settings.pet) !== false;
  const skin = useApp((s) => s.settings.petSkin);
  const { x, facing, walking, dur } = usePatrol(enabled && mood === 'idle', track, from);
  if (!enabled) return null;
  return (
    <div ref={track} className="pointer-events-none absolute inset-x-0 -top-[33px] h-[34px]" aria-hidden>
      <div className="clawd-pos absolute bottom-0" style={x == null ? { right: 24 } : { left: x, transition: `left ${dur}s linear` }}>
        <PetSprite skin={skin} mood={mood} walking={walking} facing={facing} />
      </div>
    </div>
  );
}
