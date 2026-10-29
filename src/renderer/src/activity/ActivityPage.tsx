// The Activity page, opened from the sidebar's Pi Desktop menu: how the user has been using the app lately,
// from their own prompts (Code and Work together). Every number follows the chosen range.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Segmented } from '@/components/common/Segmented';
import { call } from '@/lib/api';
import { t as tr, useT } from '@/lib/i18n';
import { fname } from '@/lib/format';
import { cn } from '@/lib/utils';
import { openSession } from '@/store/actions';
import { useApp } from '@/store/app';
import { activityLevels, HOURS_PER_DAY, rangeDays, rangeStats, summarize, TEMPORARY_WORKSPACE, type ActivityLog } from '@shared/activity';
import { fmtDay, Heatmap, Legend } from './Heatmap';
import { UsagePanel } from './UsagePanel';
import { DEFAULT_USAGE_RANGE, USAGE_RANGES, type UsageRange } from '@shared/request-log';

const TAB = { activity: 'activity', usage: 'usage' } as const;
type Tab = (typeof TAB)[keyof typeof TAB];

const RANGES = [
  { id: '13', weeks: 13 },
  { id: '26', weeks: 26 },
  { id: '52', weeks: 52 },
] as const;
/** Parts of the day for "when do you work", by local hour [from, to). */
const DAY_PARTS = [{ label: 'activity.night', from: 0, to: 6 }, { label: 'activity.morning', from: 6, to: 12 }, { label: 'activity.afternoon', from: 12, to: 18 }, { label: 'activity.evening', from: 18, to: 24 }] as const;
const TOP_PROJECTS = 6;
/** Hours that get an axis label. */
const HOUR_TICKS = [0, 6, 12, 18];

const percent = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
const projectName = (path: string) => (path === TEMPORARY_WORKSPACE ? tr('activity.tempWorkspace') : fname(path));

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
  const t = useT();
  const sessions = useApp((s) => s.sessions);
  const [log, setLog] = useState<ActivityLog | null>(null);
  const [range, setRange] = useState<(typeof RANGES)[number]['id']>('26');
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(TAB.activity);
  const [usageDays, setUsageDays] = useState<UsageRange>(DEFAULT_USAGE_RANGE);
  useEffect(() => {
    void call('activity:get').then(setLog).catch(() => setLog({}));
  }, []);

  const today = useMemo(() => new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()), []);
  const levelOf = useMemo(() => activityLevels(log ?? {}), [log]);
  const { weeks } = RANGES.find((r) => r.id === range)!;
  const rangeOptions = RANGES.map(({ id }) => ({ id, label: t(`activity.range${id}`) }));
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
      <div className="mx-auto max-w-4xl animate-in space-y-4 px-8 py-8 duration-200 fade-in-0 slide-in-from-bottom-1">
        <div>
          <div className="flex items-center gap-3">
            <Segmented value={tab} onChange={setTab} options={[{ id: TAB.activity, label: t('activity.tab.activity') }, { id: TAB.usage, label: t('activity.tab.usage') }]} />
            <span className="flex-1" />
            {tab === TAB.activity
              ? <Segmented value={range} onChange={(id) => { setRange(id); setSelected(null); }} options={rangeOptions} />
              : <Segmented value={String(usageDays)} onChange={(v) => setUsageDays(Number(v) as UsageRange)} options={USAGE_RANGES.map((n) => ({ id: String(n), label: n === 1 ? t('privacy.range.today') : t('privacy.range', { n }) }))} />}
          </div>
          <p className="mt-2 px-1 text-sm text-muted-foreground">{t(tab === TAB.activity ? 'activity.sub' : 'activity.usage.sub')}</p>
        </div>

        {tab === TAB.usage ? <UsagePanel days={usageDays} /> : (
        <>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat
            label={t('activity.prompts')} value={now.prompts} unit={t('activity.times')}
            note={delta === null ? (now.prompts ? t('activity.noBaseline') : '') : t('activity.vs', { pct: `${delta > 0 ? '+' : ''}${delta}%`, previous: t(`activity.prev${range}`) })}
            tone={delta !== null && delta > 0 ? 'up' : undefined}
          />
          <Stat label={t('activity.activeDays')} value={now.activeDays} unit={t('activity.ofDays', { n: now.days })} note={now.prompts ? t('activity.activeShare', { pct: percent(now.activeDays, now.days) }) : ''} />
          <Stat label={t('activity.streak')} value={streak.currentStreak} unit={t('activity.days')} note={t('activity.longest', { n: streak.longestStreak })} />
          <Stat label={t('activity.busiest')} value={now.busiest?.total ?? 0} unit={t('activity.times')} note={now.busiest ? fmtDay(new Date(`${now.busiest.key}T00:00:00`)) : ''} />
        </div>

        <Card title={t('activity.daily')} aside={<Legend />}>
          <Heatmap log={log} weeks={weeks} today={today} levelOf={levelOf} selected={selected} onSelect={setSelected} />
          {!now.prompts && <p className="mt-3 text-sm text-muted-foreground">{t('activity.noRecords')}</p>}
          {selected && (
            <div className="mt-3 border-t pt-3">
              <div className="mb-1.5 text-sm">
                <span className="font-medium">{fmtDay(new Date(`${selected}T00:00:00`))}</span>
                <span className="ml-2 text-muted-foreground">{day ? t('activity.dayDetail', { n: day.prompts.code + day.prompts.work, code: day.prompts.code, work: day.prompts.work }) : t('activity.noActivity')}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {day?.sessions.map((id) => {
                  const s = sessions[id];
                  return (
                    <button key={id} disabled={!s || s.meta.archived} title={s?.meta.archived ? t('activity.archivedHint') : undefined} className="max-w-xs truncate rounded-md border px-2.5 py-1 text-xs enabled:hover:bg-accent disabled:text-muted-foreground" onClick={() => void openSession(id)}>
                      {s?.meta.title ?? t('activity.deletedSession')}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="flex flex-col" title={t('activity.hours')} aside={peakHour >= 0 && <span className="text-xs text-muted-foreground">{t('activity.peak', { hour: peakHour, part: t(part.label), pct: percent(part.count, now.prompts) })}</span>}>
            <div className="flex min-h-24 flex-1 items-end gap-[3px]">
              {now.hours.map((n, h) => (
                <div key={h} className="flex h-full flex-1 items-end" title={t('activity.hourBar', { from: h, to: h + 1, n })}>
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

          <Card title={t('activity.projects')} aside={now.prompts > 0 && <span className="text-xs text-muted-foreground">Code {percent(now.code, now.prompts)}% · Work {percent(now.work, now.prompts)}%</span>}>
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
              {!now.projects.length && <p className="text-sm text-muted-foreground">{t('activity.noProjects')}</p>}
            </div>
          </Card>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
