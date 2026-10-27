import { useLocale, useT } from '@/lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { MinusIcon, PlusIcon, ScanIcon } from 'lucide-react';

const MIN_SCALE = 0.2;
const MAX_SCALE = 8;

/** Pan and zoom around one rendered diagram: wheel zooms at the cursor, dragging pans. */
export function DiagramViewer({ svg }: { svg: string }) {
  const t = useT();
  const locale = useLocale();
  useEffect(() => { document.title = t('app.diagram'); }, [locale]); // eslint-disable-line react-hooks/exhaustive-deps
  const stage = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const drag = useRef<{ x: number; y: number } | null>(null);

  const zoomAt = (factor: number, cx: number, cy: number) =>
    setView((v) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      const k = scale / v.scale;
      return { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  const zoomCenter = (factor: number) => {
    const r = stage.current?.getBoundingClientRect();
    if (r) zoomAt(factor, r.width / 2, r.height / 2);
  };
  const reset = () => setView({ x: 0, y: 0, scale: 1 });

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    // React's wheel handlers are passive; zooming has to stop the page from scrolling.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.close();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const tool = 'flex size-8 items-center justify-center rounded-md hover:bg-accent';
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex items-center justify-between border-b px-4 py-2 text-sm">
        <span className="text-muted-foreground">{t('diagram.hint')}</span>
        <div className="flex items-center gap-1">
          <button className={tool} title={t('diagram.zoomOut')} onClick={() => zoomCenter(1 / 1.25)}>
            <MinusIcon className="size-4" />
          </button>
          <span className="w-12 text-center tabular-nums text-muted-foreground">{Math.round(view.scale * 100)}%</span>
          <button className={tool} title={t('diagram.zoomIn')} onClick={() => zoomCenter(1.25)}>
            <PlusIcon className="size-4" />
          </button>
          <button className={tool} title={t('diagram.fit')} onClick={reset}>
            <ScanIcon className="size-4" />
          </button>
        </div>
      </div>
      <div
        ref={stage}
        className="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden active:cursor-grabbing"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const from = drag.current;
          if (!from) return;
          drag.current = { x: e.clientX, y: e.clientY };
          setView((v) => ({ ...v, x: v.x + e.clientX - from.x, y: v.y + e.clientY - from.y }));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onDoubleClick={reset}
      >
        <div
          className="h-full w-full origin-top-left select-none p-6 [&_svg]:h-full [&_svg]:w-full [&_svg]:max-w-none!"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  );
}
