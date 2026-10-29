// The Activity page's Usage tab: totals as cards, a chart over time, and the split by model or provider.
// The chart is plain SVG: the app has no charting library and this is the only chart in it.
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  NO_SESSION_KEY,
  USAGE_SPLIT,
  type UsageRange,
  type UsageSeries,
  type UsageSplit,
  type UsageSummary,
  type UsageTotals,
} from '@shared/request-log';
import { cacheHitRate } from '@shared/usage';
import type { MessageKey } from '@shared/i18n';
import { Segmented } from '@/components/common/Segmented';
import { Tip } from '@/components/common/Tip';
import { call, errText } from '@/lib/api';
import { fmtCost } from '@/lib/format';
import { t as tr, useT } from '@/lib/i18n';
import { useApp } from '@/store/app';
import { purposeLabel } from './origin';
import { RequestList } from './RequestList';

const fail = (err: unknown) => toast.error(errText(err));

const METRIC = { tokens: 'tokens', cost: 'cost', requests: 'requests', speed: 'speed' } as const;
type Metric = (typeof METRIC)[keyof typeof METRIC];
const CHART = { bar: 'bar', line: 'line' } as const;
type Chart = (typeof CHART)[keyof typeof CHART];

const METRIC_LABEL: Record<Metric, MessageKey> = {
  tokens: 'privacy.metric.tokens',
  cost: 'privacy.metric.cost',
  requests: 'privacy.metric.requests',
  speed: 'privacy.metric.speed',
};
const SPLIT_LABEL: Record<UsageSplit, MessageKey> = {
  model: 'privacy.split.model',
  modelProvider: 'privacy.split.modelProvider',
  provider: 'privacy.split.provider',
  session: 'privacy.split.session',
  purpose: 'privacy.split.purpose',
};

/** Series colours, in order; a 9th series starts over. */
const SERIES_COLORS = ['#a5b4fc', '#7dd3fc', '#86efac', '#fcd34d', '#fda4af', '#d8b4fe', '#fdba74', '#5eead4'];
const colorOf = (i: number) => SERIES_COLORS[i % SERIES_COLORS.length];

const CHART_WIDTH = 720;
const CHART_HEIGHT = 240;
const PAD = { left: 44, right: 8, top: 10, bottom: 24 };
const GRID_LINES = 4;
/** At most this many x-axis labels. */
const MAX_X_LABELS = 8;

const allTokens = (t: UsageTotals) => t.input + t.output + t.cacheRead + t.cacheWrite;
const perSecond = (tokens: number, ms: number) => (ms > 0 ? (tokens / ms) * 1000 : 0);
const speedOf = (t: UsageTotals) => perSecond(t.speedTokens, t.speedMs);
const fmtSpeed = (n: number) => String(Math.round(n));
const fmtInt = (n: number) => n.toLocaleString();
/** 1.2k / 105M / 3.4B: token counts here run into the millions. */
function fmtTok(n: number): string {
  const [unit, suffix] = n >= 1e9 ? [1e9, 'B'] : n >= 1e6 ? [1e6, 'M'] : n >= 1e3 ? [1e3, 'k'] : [1, ''];
  const v = n / unit;
  return `${v >= 100 || unit === 1 ? Math.round(v) : v.toFixed(1).replace(/.0$/, '')}${suffix}`;
}

/** The metric's value for one series in one bucket. */
function valueAt(s: UsageSeries, metric: Metric, i: number): number {
  switch (metric) {
    case METRIC.tokens:
      return s.tokens[i];
    case METRIC.cost:
      return s.cost[i];
    case METRIC.requests:
      return s.requests[i];
    case METRIC.speed:
      return perSecond(s.speedTokens[i], s.speedMs[i]);
  }
}

const fmtMetric = (metric: Metric, n: number) =>
  metric === METRIC.cost
    ? fmtCost(n)
    : metric === METRIC.tokens
      ? fmtTok(n)
      : metric === METRIC.speed
        ? fmtSpeed(n)
        : fmtInt(Math.round(n));

/** A round maximum at or above `max`, so the grid lines land on readable numbers. */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const rough = max / GRID_LINES;
  const exp = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * exp >= rough) ?? 10;
  return step * exp * GRID_LINES;
}

function Card({
  title,
  tip,
  children,
  sub,
}: {
  title: string;
  tip?: string;
  children: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {title}
        {tip && <Tip>{tip}</Tip>}
      </div>
      <div className="truncate text-2xl font-semibold tabular-nums">{children}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Cards({ total }: { total: UsageTotals }) {
  const t = useT();
  const hit = cacheHitRate(total);
  const speed = speedOf(total);
  return (
    <div className="grid divide-x rounded-xl border bg-card max-sm:grid-cols-2 max-sm:divide-y sm:grid-cols-5">
      <Card
        title={t('privacy.card.token')}
        sub={t('privacy.card.tokenSub', {
          input: fmtTok(total.input),
          output: fmtTok(total.output),
          cache: fmtTok(total.cacheRead + total.cacheWrite),
        })}
      >
        {fmtTok(allTokens(total))}
      </Card>
      <Card
        title={t('privacy.card.requests')}
        sub={
          total.failed > 0 ? (
            <span className="text-destructive">{t('privacy.card.failed', { n: total.failed })}</span>
          ) : (
            t('privacy.card.noFail')
          )
        }
      >
        {fmtInt(total.requests)}
      </Card>
      <Card
        title={t('privacy.card.cost')}
        sub={total.unpriced > 0 ? t('privacy.card.unpriced', { n: total.unpriced }) : undefined}
      >
        {total.unpriced > 0 ? '≈' : ''}
        {fmtCost(total.cost)}
        {total.unpriced > 0 ? '+' : ''}
      </Card>
      <Card
        title={t('privacy.card.cache')}
        sub={
          hit !== null && (
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-emerald-400" style={{ width: `${hit * 100}%` }} />
            </div>
          )
        }
      >
        {hit === null ? '—' : `${(hit * 100).toFixed(1)}%`}
      </Card>
      <Card
        title={t('privacy.card.speed')}
        tip={t('privacy.card.speedTip')}
        sub={speed > 0 ? t('privacy.card.replies', { n: fmtInt(total.timed) }) : t('privacy.card.noSpeed')}
      >
        {speed > 0 ? (
          <>
            ≈{fmtSpeed(speed)}{' '}
            <span className="text-sm font-normal text-muted-foreground">{t('privacy.unit.tokenPerSec')}</span>
          </>
        ) : (
          '—'
        )}
      </Card>
    </div>
  );
}

function bucketLabel(summary: UsageSummary, i: number): string {
  const b = summary.buckets[i];
  return summary.unit === 'hour' ? `${b.padStart(2, '0')}:00` : b.slice(5);
}

function ChartSvg({ summary, metric, kind }: { summary: UsageSummary; metric: Metric; kind: Chart }) {
  const n = summary.buckets.length;
  const stacked = kind === CHART.bar && metric !== METRIC.speed;
  const series = summary.series;

  const peak = useMemo(() => {
    let max = 0;
    for (let i = 0; i < n; i++) {
      const values = series.map((s) => valueAt(s, metric, i));
      max = Math.max(max, stacked ? values.reduce((a, b) => a + b, 0) : Math.max(0, ...values));
    }
    return niceMax(max);
  }, [series, metric, n, stacked]);

  const plotW = CHART_WIDTH - PAD.left - PAD.right;
  const plotH = CHART_HEIGHT - PAD.top - PAD.bottom;
  const slot = plotW / n;
  const x = (i: number) => PAD.left + slot * (i + 0.5);
  const y = (v: number) => PAD.top + plotH - (v / peak) * plotH;
  const labelEvery = Math.ceil(n / MAX_X_LABELS);

  return (
    <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="w-full" role="img">
      {Array.from({ length: GRID_LINES + 1 }, (_, g) => {
        const value = (peak / GRID_LINES) * g;
        return (
          <g key={g}>
            <line
              x1={PAD.left}
              x2={CHART_WIDTH - PAD.right}
              y1={y(value)}
              y2={y(value)}
              className="stroke-border"
              strokeDasharray={g ? '3 3' : undefined}
            />
            <text x={PAD.left - 6} y={y(value) + 4} textAnchor="end" className="fill-muted-foreground text-[10px]">
              {fmtMetric(metric, value)}
            </text>
          </g>
        );
      })}
      {Array.from(
        { length: n },
        (_, i) =>
          i % labelEvery === 0 && (
            <text
              key={i}
              x={x(i)}
              y={CHART_HEIGHT - 6}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {bucketLabel(summary, i)}
            </text>
          ),
      )}
      {stacked
        ? Array.from({ length: n }, (_, i) => {
            let base = 0;
            return series.map((s, k) => {
              const v = valueAt(s, metric, i);
              if (v <= 0) return null;
              const top = y(base + v);
              const h = y(base) - top;
              base += v;
              return (
                <rect
                  key={`${i}-${s.key}`}
                  x={x(i) - Math.min(slot * 0.7, 40) / 2}
                  y={top}
                  width={Math.min(slot * 0.7, 40)}
                  height={Math.max(h, 1)}
                  rx={2}
                  fill={colorOf(k)}
                >
                  <title>{`${bucketLabel(summary, i)} · ${s.label}: ${fmtMetric(metric, v)}`}</title>
                </rect>
              );
            });
          })
        : series.map((s, k) => {
            const points = Array.from({ length: n }, (_, i) => `${x(i)},${y(valueAt(s, metric, i))}`);
            return (
              <g key={s.key}>
                <polyline
                  points={points.join(' ')}
                  fill="none"
                  stroke={colorOf(k)}
                  strokeWidth={2}
                  strokeLinejoin="round"
                />
                {Array.from({ length: n }, (_, i) => {
                  const v = valueAt(s, metric, i);
                  return (
                    v > 0 && (
                      <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={colorOf(k)}>
                        <title>{`${bucketLabel(summary, i)} · ${s.label}: ${fmtMetric(metric, v)}`}</title>
                      </circle>
                    )
                  );
                })}
              </g>
            );
          })}
    </svg>
  );
}

function SeriesList({ summary, metric }: { summary: UsageSummary; metric: Metric }) {
  const t = useT();
  const main = (s: UsageSeries) =>
    metric === METRIC.tokens
      ? allTokens(s.total)
      : metric === METRIC.cost
        ? s.total.cost
        : metric === METRIC.requests
          ? s.total.requests
          : speedOf(s.total);
  const top = Math.max(0, ...summary.series.map(main));
  return (
    <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
      {summary.series.map((s, k) => {
        const hit = cacheHitRate(s.total);
        const speed = speedOf(s.total);
        const share = top > 0 ? (main(s) / top) * 100 : 0;
        return (
          <div key={s.key} className="min-w-0">
            <div className="flex items-center gap-2 text-sm">
              <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: colorOf(k) }} />
              <span className="min-w-0 flex-1 truncate" title={s.label}>
                {s.label}
              </span>
              <span className="shrink-0 tabular-nums">
                {metric === METRIC.cost
                  ? fmtCost(main(s))
                  : metric === METRIC.speed
                    ? `${fmtSpeed(main(s))} ${t('privacy.unit.tokenPerSec')}`
                    : fmtInt(Math.round(main(s)))}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${share}%`, background: colorOf(k) }} />
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground">
              {[
                t('privacy.series.sub', { requests: fmtInt(s.total.requests) }),
                s.total.cost > 0 || s.total.unpriced === 0
                  ? `${s.total.unpriced > 0 ? '≈' : ''}${fmtCost(s.total.cost)}`
                  : null,
                speed > 0 ? `≈${fmtSpeed(speed)} ${t('privacy.unit.tokenPerSec')}` : null,
                hit !== null ? t('privacy.series.hit', { n: Math.round(hit * 100) }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** What a series is called: the model's id as the log has it, but a part of the app or a session by its name. */
function seriesLabel(split: UsageSplit, key: string, fallback: string): string {
  if (split === USAGE_SPLIT.purpose) return purposeLabel(key);
  if (split !== USAGE_SPLIT.session) return fallback;
  if (key === NO_SESSION_KEY) return tr('privacy.session.none');
  return useApp.getState().sessions[key]?.meta.title ?? tr('activity.deletedSession');
}

export function UsagePanel({ days }: { days: UsageRange }) {
  const t = useT();
  const [split, setSplit] = useState<UsageSplit>(USAGE_SPLIT.model);
  const [metric, setMetric] = useState<Metric>(METRIC.tokens);
  const [kind, setKind] = useState<Chart>(CHART.bar);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  useEffect(() => {
    void call('requests:summary', { days, split })
      .then((s) =>
        setSummary({ ...s, series: s.series.map((x) => ({ ...x, label: seriesLabel(split, x.key, x.label) })) }),
      )
      .catch(fail);
  }, [days, split]);

  const metrics = Object.values(METRIC).map((id) => ({ id, label: t(METRIC_LABEL[id]) }));
  const splits = Object.values(USAGE_SPLIT).map((id) => ({ id, label: t(SPLIT_LABEL[id]) }));
  // Speed is a rate per bucket: stacking it would add up rates, so it is always drawn as lines.
  const drawn = metric === METRIC.speed ? CHART.line : kind;

  return (
    <div className="space-y-4">
      {summary &&
        (summary.total.requests === 0 ? (
          <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            {t('privacy.empty')}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <Cards total={summary.total} />
            <div className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Segmented compact value={metric} options={metrics} onChange={setMetric} />
                  <Segmented
                    compact
                    value={drawn}
                    options={[
                      { id: CHART.bar, label: t('privacy.chart.bar'), disabled: metric === METRIC.speed },
                      { id: CHART.line, label: t('privacy.chart.line') },
                    ]}
                    onChange={setKind}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{t('privacy.split')}</span>
                  <Segmented compact value={split} options={splits} onChange={setSplit} />
                </div>
              </div>
              <div className="mt-3 flex flex-col gap-5">
                <ChartSvg summary={summary} metric={metric} kind={drawn} />
                <SeriesList summary={summary} metric={metric} />
              </div>
            </div>
          </div>
        ))}
      <RequestList />
    </div>
  );
}
