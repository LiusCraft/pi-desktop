import { useCallback, useRef, useState, type PointerEvent } from 'react';

/**
 * Drag a floating panel by its header. The panel is moved with a translate on top of
 * wherever it was laid out, so it keeps working however it is positioned; buttons and
 * inputs inside the handle stay clickable.
 */
export function useDrag() {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const start = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const latest = useRef(offset);
  latest.current = offset;

  const onPointerDown = useCallback((e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as Element).closest('button,input,textarea,a')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { px: e.clientX, py: e.clientY, x: latest.current.x, y: latest.current.y };
  }, []);
  const onPointerMove = useCallback((e: PointerEvent<HTMLElement>) => {
    const s = start.current;
    if (!s) return;
    // The pointer must stay inside the window, or the panel could be lost off-screen.
    const px = Math.min(Math.max(e.clientX, 0), window.innerWidth);
    const py = Math.min(Math.max(e.clientY, 0), window.innerHeight);
    setOffset({ x: s.x + px - s.px, y: s.y + py - s.py });
  }, []);
  const onPointerUp = useCallback(() => void (start.current = null), []);

  return {
    style: { transform: `translate(${offset.x}px, ${offset.y}px)` },
    handle: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, className: 'cursor-grab touch-none select-none active:cursor-grabbing' },
  };
}
