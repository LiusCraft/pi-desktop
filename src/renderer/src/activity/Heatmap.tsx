// The day-by-day grid of the Activity page: one column per week (Sunday first), the last one ending today.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { ACTIVITY_LEVELS, dayKey, dayTotal, type ActivityLog } from '@shared/activity';

/** Cells grow to fill the card, within these bounds (px). */
const MIN_CELL = 9;
const MAX_CELL = 16;
const GAP = 3;
/** Width of the weekday-name column, gap included. */
const LABEL_WIDTH = 32;
/** A month name needs this many columns before the next one starts, or it is left out. */
const MIN_LABEL_GAP = 3;
/** Rows that carry a weekday name (Sunday is 0). */
const WEEKDAY_LABELS: Record<number, string> = { 1: 'Mon', 3: 'Wed', 5: 'Fri' };
/** Share of the accent colour per level; level 0 is the empty-day background. */
const LEVEL_MIX = [0, 32, 55, 78, 100];

export const levelColor = (level: number) => (level ? `color-mix(in oklab, var(--primary) ${LEVEL_MIX[Math.min(level, ACTIVITY_LEVELS)]}%, transparent)` : undefined);
export const fmtDay = (d: Date) => d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export function Heatmap({ log, weeks: weekCount, today, levelOf, selected, onSelect }: {
  log: ActivityLog;
  weeks: number;
  today: Date;
  levelOf: (total: number) => number;
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [cell, setCell] = useState(MIN_CELL);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setCell(Math.max(MIN_CELL, Math.min(MAX_CELL, Math.floor((el.clientWidth - LABEL_WIDTH) / weekCount) - GAP)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [weekCount]);
  const weeks = useMemo(() => {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay() - (weekCount - 1) * 7);
    return Array.from({ length: weekCount }, (_, w) => Array.from({ length: 7 }, (_, d) => {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
      return date <= today ? date : null;
    }));
  }, [today, weekCount]);
  const monthLabels = useMemo(() => {
    const starts = weeks.map((_, w) => w).filter((w) => w === 0 || weeks[w][0]!.getMonth() !== weeks[w - 1][0]!.getMonth());
    const shown = starts.filter((w, i) => i === starts.length - 1 || starts[i + 1] - w >= MIN_LABEL_GAP);
    return new Map(shown.map((w) => [w, weeks[w][0]!.toLocaleDateString(undefined, { month: 'short' })]));
  }, [weeks]);

  return (
    <div ref={box} className="overflow-x-auto pb-1">
      <div className="flex w-max" style={{ gap: GAP }}>
        <div className="grid pt-[18px] text-[10px] leading-none text-muted-foreground" style={{ gridTemplateRows: `repeat(7, ${cell}px)`, gap: GAP }}>
          {Array.from({ length: 7 }, (_, d) => <span key={d} className="flex items-center pr-1.5">{WEEKDAY_LABELS[d]}</span>)}
        </div>
        <div>
          <div className="flex pb-1.5 text-[10px] leading-3 text-muted-foreground" style={{ gap: GAP }}>
            {weeks.map((_, w) => <span key={w} className="whitespace-nowrap" style={{ width: cell }}>{monthLabels.get(w)}</span>)}
          </div>
          <div className="flex" style={{ gap: GAP }}>
            {weeks.map((week, w) => (
              <div key={w} className="grid" style={{ gridTemplateRows: `repeat(7, ${cell}px)`, gap: GAP, width: cell }}>
                {week.map((date, d) => {
                  if (!date) return <span key={d} />;
                  const key = dayKey(date);
                  const entry = log[key];
                  const total = dayTotal(entry);
                  return (
                    <button
                      key={d}
                      aria-label={`${fmtDay(date)}: ${total}`}
                      className={cn('rounded-[3px] bg-foreground/[0.07] outline-offset-2 transition-transform hover:scale-125', selected === key && 'outline outline-2 outline-foreground/70')}
                      style={{ backgroundColor: levelColor(levelOf(total)) }}
                      title={`${fmtDay(date)} · ${total ? `${total} 次提问（Code ${entry.prompts.code} / Work ${entry.prompts.work}）` : '没有活动'}`}
                      onClick={() => onSelect(selected === key ? null : key)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Legend() {
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
      少
      {Array.from({ length: ACTIVITY_LEVELS + 1 }, (_, l) => <span key={l} className="size-[11px] rounded-[3px] bg-foreground/[0.07]" style={{ backgroundColor: levelColor(l) }} />)}
      多
    </div>
  );
}
