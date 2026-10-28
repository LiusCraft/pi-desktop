import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '@/lib/utils';

const MIN_SCALE = 1;
const MAX_SCALE = 16;
/** Scale factor per wheel notch. */
const WHEEL_STEP = 1.15;
/** Scale a double click zooms to from the fitted size. */
const DOUBLE_CLICK_SCALE = 2.5;

interface View { scale: number; x: number; y: number }
const FIT: View = { scale: 1, x: 0, y: 0 };

/** An image fitted to its box that zooms with the wheel (around the cursor), pans by dragging, and toggles zoom on double click. */
export function ZoomImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; from: View } | null>(null);
  const [view, setView] = useState<View>(FIT);

  useEffect(() => setView(FIT), [src]);

  // Offsets are measured from the box center; zooming keeps the point under `(px, py)` fixed.
  const zoomAt = (px: number, py: number, to: (scale: number) => number) => setView((v) => {
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, to(v.scale)));
    if (scale === MIN_SCALE) return FIT;
    const k = scale / v.scale;
    return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
  });
  const local = (clientX: number, clientY: number) => {
    const r = box.current!.getBoundingClientRect();
    return [clientX - r.left - r.width / 2, clientY - r.top - r.height / 2] as const;
  };

  // React registers wheel listeners as passive, which cannot stop the page from scrolling.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [px, py] = local(e.clientX, e.clientY);
      zoomAt(px, py, (s) => s * (e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const down = (e: ReactPointerEvent) => {
    if (view.scale === MIN_SCALE) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, from: view };
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (d?.id === e.pointerId) setView({ ...d.from, x: d.from.x + e.clientX - d.x, y: d.from.y + e.clientY - d.y });
  };
  const up = (e: ReactPointerEvent) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  return (
    <div
      ref={box}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={(e) => {
        const [px, py] = local(e.clientX, e.clientY);
        zoomAt(px, py, (s) => (s === MIN_SCALE ? DOUBLE_CLICK_SCALE : MIN_SCALE));
      }}
      className={cn('flex touch-none items-center justify-center overflow-hidden select-none', view.scale > MIN_SCALE ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in', className)}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        className="max-h-full max-w-full object-contain will-change-transform"
      />
    </div>
  );
}
