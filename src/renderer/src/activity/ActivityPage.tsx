// The Activity page, opened from the sidebar's Pi Desktop menu: how the user has been using the app lately,
// from their own prompts (Code and Work together). Every number follows the chosen range.
import { XIcon } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Segmented } from '@/components/common/Segmented';
import { call } from '@/lib/api';
import { fname } from '@/lib/format';
import { cn } from '@/lib/utils';
import { openSession, showWelcome } from '@/store/actions';
import { useApp } from '@/store/app';
import { activityLevels, HOURS_PER_DAY, rangeDays, rangeStats, summarize, TEMPORARY_WORKSPACE, type ActivityLog } from '@shared/activity';
import { fmtDay, Heatmap, Legend } from './Heatmap';

const RANGES = [
  { id: '13', label: '3 个月', weeks: 13, previous: '前 3 个月' },
  { id: '26', label: '半年', weeks: 26, previous: '前半年' },
  { id: '52', label: '1 年', weeks: 52, previous: '前一年' },
] as const;
const RANGE_OPTIONS = RANGES.map(({ id, label }) => ({ id, label }));
/** Parts of the day for "when do you work", by local hour [from, to). */
const DAY_PARTS = [{ label: '凌晨', from: 0, to: 6 }, { label: '上午', from: 6, to: 12 }, { label: '下午', from: 12, to: 18 }, { label: '晚上', from: 18, to: 24 }];
const TOP_PROJECTS = 6;
/** Hours that get an axis label. */
const HOUR_TICKS = [0, 6, 12, 18];

const percent = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
const projectName = (path: string) => (path === TEMPORARY_WORKSPACE ? '临时工作区' : fname(path));

function Card({ title, aside, children, className }: { title?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-xl border bg-card p-4', className)}>
      {title && (
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-sm font-medium">{title}</h3>
          <span className="flex-1" />
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

function Stat({ label, value, unit, note, tone }: { label: string; value: ReactNode; unit?: string; note?: ReactNode; tone?: 'up' }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="font-serif text-3xl leading-none tabular-nums">{value}</span>
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </div>
      <div className={cn('mt-1.5 h-4 truncate text-xs text-muted-foreground', tone === 'up' && 'text-success')}>{note}</div>
    </div>
  );
}

export function ActivityPage() {
  const sessions = useApp((s) => s.sessions);
  const [log, setLog] = useState<ActivityLog | null>(null);
  const [range, setRange] = useState<(typeof RANGES)[number]['id']>('26');
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    void call('activity:get').then(setLog).catch(() => setLog({}));
  }, []);

  const today = useMemo(() => new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()), []);
  const levelOf = useMemo(() => activityLevels(log ?? {}), [log]);
  const { weeks, previous: previousLabel } = RANGES.find((r) => r.id === range)!;
  const stats = useMemo(() => {
    const data = log ?? {};
    const days = rangeDays(weeks, today);
    const before = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days);
    return { now: rangeStats(data, today, days), before: rangeStats(data, before, days), streak: summarize(data, today) };
  }, [log, weeks, today]);
  if (!log) return null;

  const { now, before, streak } = stats;
  const delta = before.prompts ? percent(now.prompts - before.prompts, before.prompts) : null;
  const peakHour = now.prompts ? now.hours.indexOf(Math.max(...now.hours)) : -1;
  const peakHourCount = peakHour >= 0 ? now.hours[peakHour] : 0;
  const part = DAY_PARTS.map((p) => ({ ...p, count: now.hours.slice(p.from, p.to).reduce((a, b) => a + b, 0) })).sort((a, b) => b.count - a.count)[0];
  const day = selected ? log[selected] : undefined;
  const maxProject = now.projects[0]?.count ?? 0;

  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto">
      <button className="absolute right-4 top-3 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="关闭" onClick={() => showWelcome()}>
        <XIcon className="size-4" />
      </button>
      <div className="mx-auto max-w-4xl animate-in space-y-4 px-8 py-8 duration-200 fade-in-0 slide-in-from-bottom-1">
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold">Activity</h2>
            <p className="mt-1 text-sm text-muted-foreground">你在 Pi Desktop 里的使用节奏，Code 和 Work 合在一起算。只统计你自己发出的消息，定时任务和 agent 自动发起的不计入。</p>
          </div>
          <Segmented value={range} onChange={(id) => { setRange(id); setSelected(null); }} options={RANGE_OPTIONS} />
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat
            label="提问" value={now.prompts} unit="次"
            note={delta === null ? (now.prompts ? '之前没有记录可比' : '') : `较${previousLabel} ${delta > 0 ? '+' : ''}${delta}%`}
            tone={delta !== null && delta > 0 ? 'up' : undefined}
          />
          <Stat label="活跃天数" value={now.activeDays} unit={`/ ${now.days} 天`} note={now.prompts ? `${percent(now.activeDays, now.days)}% 的日子你都在用` : ''} />
          <Stat label="连续使用" value={streak.currentStreak} unit="天" note={`最长 ${streak.longestStreak} 天`} />
          <Stat label="最忙的一天" value={now.busiest?.total ?? 0} unit="次" note={now.busiest ? fmtDay(new Date(`${now.busiest.key}T00:00:00`)) : ''} />
        </div>

        <Card title="每日提问" aside={<Legend />}>
          <Heatmap log={log} weeks={weeks} today={today} levelOf={levelOf} selected={selected} onSelect={setSelected} />
          {!now.prompts && <p className="mt-3 text-sm text-muted-foreground">这段时间还没有记录。从现在起，你发出的每条消息都会计入这里。</p>}
          {selected && (
            <div className="mt-3 border-t pt-3">
              <div className="mb-1.5 text-sm">
                <span className="font-medium">{fmtDay(new Date(`${selected}T00:00:00`))}</span>
                <span className="ml-2 text-muted-foreground">{day ? `${day.prompts.code + day.prompts.work} 次提问 · Code ${day.prompts.code} / Work ${day.prompts.work}` : '没有活动'}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {day?.sessions.map((id) => {
                  const s = sessions[id];
                  return (
                    <button key={id} disabled={!s || s.meta.archived} title={s?.meta.archived ? '已归档' : undefined} className="max-w-xs truncate rounded-md border px-2.5 py-1 text-xs enabled:hover:bg-accent disabled:text-muted-foreground" onClick={() => void openSession(id)}>
                      {s?.meta.title ?? '已删除的会话'}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="flex flex-col" title="时段分布" aside={peakHour >= 0 && <span className="text-xs text-muted-foreground">高峰 {peakHour}:00 · {part.label}占 {percent(part.count, now.prompts)}%</span>}>
            <div className="flex min-h-24 flex-1 items-end gap-[3px]">
              {now.hours.map((n, h) => (
                <div key={h} className="flex h-full flex-1 items-end" title={`${h}:00–${h + 1}:00 · ${n} 次`}>
                  <div
                    className="w-full rounded-[3px] bg-foreground/[0.07]"
                    style={{ height: `${Math.max(4, percent(n, peakHourCount))}%`, ...(n ? { backgroundColor: `color-mix(in oklab, var(--primary) ${h === peakHour ? 100 : 50}%, transparent)` } : {}) }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-1.5 flex text-[10px] text-muted-foreground">
              {HOUR_TICKS.map((h) => <span key={h} className="flex-1">{h}:00</span>)}
              <span>{HOURS_PER_DAY}:00</span>
            </div>
          </Card>

          <Card title="项目" aside={now.prompts > 0 && <span className="text-xs text-muted-foreground">Code {percent(now.code, now.prompts)}% · Work {percent(now.work, now.prompts)}%</span>}>
            {now.prompts > 0 && (
              <div className="mb-3 flex h-1.5 overflow-hidden rounded-full bg-foreground/[0.07]">
                <div className="bg-primary" style={{ width: `${percent(now.code, now.prompts)}%` }} />
                <div className="bg-primary/40" style={{ width: `${percent(now.work, now.prompts)}%` }} />
              </div>
            )}
            <div className="space-y-2.5">
              {now.projects.slice(0, TOP_PROJECTS).map(({ path, count }) => (
                <div key={path} title={path || undefined}>
                  <div className="flex items-baseline gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{projectName(path)}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-foreground/[0.07]">
                    <div className="h-full rounded-full bg-primary/70" style={{ width: `${percent(count, maxProject)}%` }} />
                  </div>
                </div>
              ))}
              {!now.projects.length && <p className="text-sm text-muted-foreground">还没有项目数据。</p>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
