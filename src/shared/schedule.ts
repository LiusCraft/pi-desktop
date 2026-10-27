// Scheduled tasks: the saved task shape and the schedule maths, shared by the agent host (which
// fires them) and the renderer (which shows "next run"). Pure functions, local time throughout.
import { tr } from './i18n/runtime';
import type { PermissionMode, SessionKind } from './protocol';

export type TaskSchedule =
  | { type: 'manual' }
  | { type: 'hourly' }
  | { type: 'daily'; time: string }
  | { type: 'weekdays'; time: string }
  | { type: 'weekly'; time: string; day: number }
  /** One run at an absolute time, then the task turns itself off. */
  | { type: 'once'; at: number }
  | { type: 'cron'; expr: string };

export interface TaskRun {
  at: number;
  /** The session the run started; absent for a skipped run. */
  sessionId?: string;
  status: 'started' | 'skipped';
  /** Why a run was skipped, or that it was a catch-up for a missed time. */
  note?: string;
}

export interface ScheduledTask {
  id: string;
  name: string;
  /** What Pi Desktop is asked to do on every run. */
  prompt: string;
  /** Which tab the task belongs to, and so what kind of session each run starts. */
  kind: SessionKind;
  /** Code: the project. Work: the folder, or null for a fresh scratch workspace per run. */
  projectPath: string | null;
  /** Code only: run each time in its own git worktree instead of the working directory. */
  worktree: boolean;
  mode: PermissionMode;
  model: string | null;
  schedule: TaskSchedule;
  enabled: boolean;
  createdAt: number;
  nextRunAt: number | null;
  lastRunAt: number | null;
  /** Newest first, capped. */
  runs: TaskRun[];
}

export interface TaskDraft {
  /** Set when editing. */
  id?: string;
  name: string;
  prompt: string;
  kind: SessionKind;
  projectPath: string | null;
  worktree: boolean;
  mode: PermissionMode;
  model: string | null;
  schedule: TaskSchedule;
}

const WEEKDAY_KEYS = ['schedule.sun', 'schedule.mon', 'schedule.tue', 'schedule.wed', 'schedule.thu', 'schedule.fri', 'schedule.sat'] as const;
/** Day 0 is Sunday; the name follows the language of the running process. */
export const weekdayName = (day: number) => (WEEKDAY_KEYS[day] ? tr(WEEKDAY_KEYS[day]) : '');
export const MAX_TASK_RUNS = 30;
/** A task whose app was closed catches up on at most one run, and only if the miss is this recent. */
export const CATCH_UP_MS = 7 * 24 * 3600_000;

const HOUR = 3600_000;

export function parseTime(time: string): { h: number; m: number } | null {
  const hit = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!hit) return null;
  const h = Number(hit[1]), m = Number(hit[2]);
  return h < 24 && m < 60 ? { h, m } : null;
}

// ------------------------------------------------------------ cron

const FIELDS = [
  { name: 'schedule.field.minute', min: 0, max: 59 },
  { name: 'schedule.field.hour', min: 0, max: 23 },
  { name: 'schedule.field.day', min: 1, max: 31 },
  { name: 'schedule.field.month', min: 1, max: 12 },
  { name: 'schedule.field.weekday', min: 0, max: 6 },
] as const;

function parseField(text: string, f: (typeof FIELDS)[number]): Set<number> {
  const out = new Set<number>();
  for (const part of text.split(',')) {
    const [range, step, extra] = part.split('/');
    const n = step === undefined ? 1 : Number(step);
    if (extra !== undefined || !Number.isInteger(n) || n < 1) throw new Error(tr('schedule.err.step', { field: tr(f.name), part }));
    let lo: number, hi: number;
    if (range === '*') [lo, hi] = [f.min, f.max];
    else {
      const [a, b, more] = range.split('-');
      lo = Number(a);
      hi = b === undefined ? (step === undefined ? lo : f.max) : Number(b);
      if (more !== undefined || !/^\d+$/.test(a) || (b !== undefined && !/^\d+$/.test(b))) throw new Error(tr('schedule.err.field', { field: tr(f.name), part }));
    }
    if (lo < f.min || hi > f.max || lo > hi) throw new Error(tr('schedule.err.range', { field: tr(f.name), min: f.min, max: f.max, part }));
    for (let v = lo; v <= hi; v += n) out.add(v);
  }
  return out;
}

export interface Cron {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domAny: boolean;
  dowAny: boolean;
}

/** Five fields — minute hour day-of-month month day-of-week (0 is Sunday) — in local time. */
export function parseCron(expr: string): Cron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(tr('schedule.err.fields'));
  const [minute, hour, dom, month, dow] = parts.map((p, i) => parseField(p, FIELDS[i]));
  return { minute, hour, dom, month, dow, domAny: parts[2] === '*', dowAny: parts[4] === '*' };
}

function dayMatches(c: Cron, d: Date) {
  if (!c.month.has(d.getMonth() + 1)) return false;
  const dom = c.dom.has(d.getDate()), dow = c.dow.has(d.getDay());
  // Like cron: when both day fields are restricted, either one matching is enough.
  return c.domAny || c.dowAny ? dom && dow : dom || dow;
}

/** The first minute strictly after `after` that the expression matches, looking up to a year ahead. */
export function nextCron(c: Cron, after: number): number | null {
  const d = new Date(after);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const limit = after + 367 * 24 * HOUR;
  while (d.getTime() < limit) {
    // Skip a whole non-matching day or hour at a time.
    if (!dayMatches(c, d)) d.setHours(24, 0, 0, 0);
    else if (!c.hour.has(d.getHours())) d.setHours(d.getHours() + 1, 0, 0, 0);
    else if (c.minute.has(d.getMinutes())) return d.getTime();
    else d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

// ------------------------------------------------------------ schedules

/** An error message when the schedule can't be saved, else null. */
export function validateSchedule(s: TaskSchedule, now = Date.now()): string | null {
  switch (s.type) {
    case 'manual':
    case 'hourly':
      return null;
    case 'daily':
    case 'weekdays':
      return parseTime(s.time) ? null : tr('schedule.err.time');
    case 'weekly':
      return parseTime(s.time) && Number.isInteger(s.day) && s.day >= 0 && s.day <= 6 ? null : tr('schedule.err.weekTime');
    case 'once':
      return Number.isFinite(s.at) && s.at > now ? null : tr('schedule.err.future');
    case 'cron':
      try {
        const c = parseCron(s.expr);
        const a = nextCron(c, now);
        const b = a && nextCron(c, a);
        if (a && b && b - a < HOUR) return tr('schedule.err.interval');
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
  }
}

/** The next time the schedule fires after `after`, or null for manual and finished one-offs. */
export function nextRun(s: TaskSchedule, after: number): number | null {
  const at = (time: string, dayStep: (d: Date) => boolean) => {
    const t = parseTime(time);
    if (!t) return null;
    const d = new Date(after);
    for (let i = 0; i < 9; i++) {
      d.setHours(t.h, t.m, 0, 0);
      if (d.getTime() > after && dayStep(d)) return d.getTime();
      d.setDate(d.getDate() + 1);
    }
    return null;
  };
  switch (s.type) {
    case 'manual':
      return null;
    case 'hourly': {
      const d = new Date(after);
      d.setMinutes(0, 0, 0);
      return d.getTime() + HOUR;
    }
    case 'daily':
      return at(s.time, () => true);
    case 'weekdays':
      return at(s.time, (d) => d.getDay() !== 0 && d.getDay() !== 6);
    case 'weekly':
      return at(s.time, (d) => d.getDay() === s.day);
    case 'once':
      return s.at > after ? s.at : null;
    case 'cron':
      try {
        return nextCron(parseCron(s.expr), after);
      } catch {
        return null;
      }
  }
}

export function describeSchedule(s: TaskSchedule): string {
  switch (s.type) {
    case 'manual': return tr('schedule.manual');
    case 'hourly': return tr('schedule.hourly');
    case 'daily': return tr('schedule.daily', { time: s.time });
    case 'weekdays': return tr('schedule.weekdays', { time: s.time });
    case 'weekly': return tr('schedule.weekly', { day: weekdayName(s.day), time: s.time });
    case 'once': return tr('schedule.once', { at: new Date(s.at).toLocaleString() });
    case 'cron': return `cron ${s.expr}`;
  }
}
