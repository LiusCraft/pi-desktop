// The Activity heatmap: what the user did in Pi Desktop each day. Recorded by the app itself (never read
// back from pi's session files), shared by the agent host that writes it and the renderer that draws it.
import type { SessionKind } from './protocol';

/** One local calendar day. A prompt counts only when the user sent it, not when a task, peer or PR watch did. */
export interface ActivityDay {
  prompts: Record<SessionKind, number>;
  /** Sessions the user prompted that day, in first-touched order. */
  sessions: string[];
  /** Prompts per local hour of the day, index 0..HOURS_PER_DAY-1. */
  hours: number[];
  /** Prompts per project folder; `TEMPORARY_WORKSPACE` stands for a work session's scratch folder. */
  projects: Record<string, number>;
}

export const HOURS_PER_DAY = 24;
export const TEMPORARY_WORKSPACE = '';

export const emptyDay = (): ActivityDay => ({ prompts: { code: 0, work: 0 }, sessions: [], hours: Array(HOURS_PER_DAY).fill(0), projects: {} });

/** Keyed by `dayKey`. */
export type ActivityLog = Record<string, ActivityDay>;

/** How many colour steps (besides "none") the heatmap has. */
export const ACTIVITY_LEVELS = 4;

const pad = (n: number) => String(n).padStart(2, '0');

/** Local-time `YYYY-MM-DD`, so late-night work stays on the day it happened. */
export function dayKey(at: number | Date): string {
  const d = typeof at === 'number' ? new Date(at) : at;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const dayTotal = (day: ActivityDay | undefined) => (day ? day.prompts.code + day.prompts.work : 0);

/**
 * Colour step 0..ACTIVITY_LEVELS for a day's total. Steps are quartiles of the user's own non-zero days,
 * so a light user and a heavy one both get a spread instead of one fixed scale.
 */
export function activityLevels(log: ActivityLog): (total: number) => number {
  const totals = Object.values(log).map(dayTotal).filter((n) => n > 0).sort((a, b) => a - b);
  const at = (q: number) => totals[Math.min(totals.length - 1, Math.floor(q * totals.length))];
  const cuts = totals.length ? [at(0.25), at(0.5), at(0.75)] : [];
  return (total) => {
    if (total <= 0) return 0;
    let level = 1;
    for (const cut of cuts) if (total > cut) level++;
    return Math.min(level, ACTIVITY_LEVELS);
  };
}

export interface ActivitySummary {
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
}

/** Streaks over consecutive local days; today may still be empty without breaking the current one. */
export function summarize(log: ActivityLog, today = new Date()): ActivitySummary {
  const active = (d: Date) => dayTotal(log[dayKey(d)]) > 0;
  const days = Object.keys(log).filter((k) => dayTotal(log[k]) > 0).sort();
  let longest = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const key of days) {
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    run = prev && Math.round((date.getTime() - prev.getTime()) / 86_400_000) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = date;
  }
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!active(cursor)) cursor.setDate(cursor.getDate() - 1);
  let current = 0;
  while (active(cursor)) {
    current++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { activeDays: days.length, currentStreak: current, longestStreak: longest };
}

/** The days the heatmap shows for `weeks` columns (Sunday first, last column ending today): stats use the same window. */
export const rangeDays = (weeks: number, today: Date) => (weeks - 1) * 7 + today.getDay() + 1;

export interface RangeStats {
  days: number;
  prompts: number;
  code: number;
  work: number;
  activeDays: number;
  busiest: { key: string; total: number } | null;
  hours: number[];
  /** Most-prompted first. */
  projects: { path: string; count: number }[];
}

/** Totals over the `days` local days ending on `end` (inclusive). */
export function rangeStats(log: ActivityLog, end: Date, days: number): RangeStats {
  const stats: RangeStats = { days, prompts: 0, code: 0, work: 0, activeDays: 0, busiest: null, hours: Array(HOURS_PER_DAY).fill(0), projects: [] };
  const projects = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const key = dayKey(new Date(end.getFullYear(), end.getMonth(), end.getDate() - i));
    const day = log[key];
    const total = dayTotal(day);
    if (!day || !total) continue;
    stats.prompts += total;
    stats.code += day.prompts.code;
    stats.work += day.prompts.work;
    stats.activeDays++;
    if (!stats.busiest || total > stats.busiest.total) stats.busiest = { key, total };
    day.hours?.forEach((n, h) => (stats.hours[h] += n));
    for (const [path, n] of Object.entries(day.projects ?? {})) projects.set(path, (projects.get(path) ?? 0) + n);
  }
  stats.projects = [...projects].map(([path, count]) => ({ path, count })).sort((a, b) => b.count - a.count);
  return stats;
}
