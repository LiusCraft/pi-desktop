import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CreateSessionOptions, SessionMeta } from '../src/shared/protocol';
import { nextRun, validateSchedule } from '../src/shared/schedule';
import { Scheduler, type SchedulerHub } from '../src/agent/scheduler';
import { Store } from '../src/agent/store';
import { setActiveLocale } from '../src/shared/i18n/runtime';

// These assertions read the host's Chinese messages.
setActiveLocale('zh');

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

describe('nextRun', () => {
  it('finds the next daily time, today or tomorrow', () => {
    const s = { type: 'daily', time: '09:00' } as const;
    expect(nextRun(s, at(2026, 10, 27, 8, 0))).toBe(at(2026, 10, 27, 9, 0));
    expect(nextRun(s, at(2026, 10, 27, 9, 0))).toBe(at(2026, 10, 28, 9, 0));
  });
  it('skips the weekend for weekdays', () => {
    // 2026-10-30 is a Friday.
    expect(nextRun({ type: 'weekdays', time: '09:00' }, at(2026, 10, 30, 10, 0))).toBe(at(2026, 11, 2, 9, 0));
  });
  it('waits for the chosen day of the week', () => {
    expect(nextRun({ type: 'weekly', time: '18:30', day: 1 }, at(2026, 10, 27, 12, 0))).toBe(at(2026, 11, 2, 18, 30));
  });
  it('is hourly on the hour, and a one-off only while it is ahead', () => {
    expect(nextRun({ type: 'hourly' }, at(2026, 10, 27, 8, 20))).toBe(at(2026, 10, 27, 9, 0));
    expect(nextRun({ type: 'once', at: at(2026, 11, 1) }, at(2026, 10, 27))).toBe(at(2026, 11, 1));
    expect(nextRun({ type: 'once', at: at(2026, 10, 1) }, at(2026, 10, 27))).toBeNull();
    expect(nextRun({ type: 'manual' }, 0)).toBeNull();
  });
  it('follows a cron expression', () => {
    expect(nextRun({ type: 'cron', expr: '0 9 * * 1-5' }, at(2026, 10, 30, 10, 0))).toBe(at(2026, 11, 2, 9, 0));
    expect(nextRun({ type: 'cron', expr: '30 */2 * * *' }, at(2026, 10, 27, 8, 40))).toBe(at(2026, 10, 27, 10, 30));
    expect(nextRun({ type: 'cron', expr: '0 0 1 1 *' }, at(2026, 10, 27))).toBe(at(2027, 1, 1, 0, 0));
  });
});

describe('validateSchedule', () => {
  const now = at(2026, 10, 27);
  it('rejects bad input', () => {
    expect(validateSchedule({ type: 'daily', time: '25:00' }, now)).toBeTruthy();
    expect(validateSchedule({ type: 'once', at: now - 1 }, now)).toBeTruthy();
    expect(validateSchedule({ type: 'cron', expr: '* * * *' }, now)).toBeTruthy();
    expect(validateSchedule({ type: 'cron', expr: '0 9 * * mon' }, now)).toBeTruthy();
    expect(validateSchedule({ type: 'cron', expr: '*/5 * * * *' }, now)).toContain('1 小时');
  });
  it('accepts good input', () => {
    expect(validateSchedule({ type: 'weekly', time: '09:00', day: 3 }, now)).toBeNull();
    expect(validateSchedule({ type: 'cron', expr: '0 */2 * * *' }, now)).toBeNull();
  });
});

describe('Scheduler', () => {
  let dir: string;
  let clock: number;
  let created: CreateSessionOptions[];
  let prompts: [string, string][];
  let running: Set<string>;
  const hub: SchedulerHub = {
    async create(opts) {
      created.push(opts);
      return { id: `s${created.length}`, kind: opts.kind, title: opts.title ?? '' } as SessionMeta;
    },
    async prompt(id, payload) {
      prompts.push([id, payload.text]);
    },
    announce() {},
    isRunning: (id) => running.has(id),
  };
  const make = () => new Scheduler(new Store(dir), hub, () => {}, () => clock);
  const draft = { name: 'review', prompt: 'review PRs', kind: 'code' as const, projectPath: '/p', worktree: false, mode: 'auto' as const, model: null };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-sched-'));
    clock = at(2026, 10, 27, 8, 0);
    created = [];
    prompts = [];
    running = new Set();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('fires a due task once and schedules the next run', async () => {
    const s = make();
    s.save({ ...draft, schedule: { type: 'daily', time: '09:00' } });
    await s.tick(false);
    expect(created).toEqual([]);
    clock = at(2026, 10, 27, 9, 1);
    await s.tick(false);
    await s.tick(false);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ kind: 'code', projectPath: '/p', worktree: false, title: 'review' });
    expect(prompts).toEqual([['s1', 'review PRs']]);
    const [t] = s.list();
    expect(t.nextRunAt).toBe(at(2026, 10, 28, 9, 0));
    expect(t.runs[0]).toMatchObject({ status: 'started', sessionId: 's1' });
  });

  it('makes up a missed run once at startup, and drops one older than a week', async () => {
    make().save({ ...draft, schedule: { type: 'daily', time: '09:00' } });
    clock = at(2026, 10, 30, 12, 0);
    await make().tick(true);
    expect(created).toHaveLength(1);
    expect(make().list()[0].runs[0].note).toContain('补跑');
    created = [];
    clock = at(2026, 12, 30, 12, 0);
    await make().tick(true);
    expect(created).toEqual([]);
  });

  it('skips a run while the previous one is still going', async () => {
    const s = make();
    s.save({ ...draft, schedule: { type: 'hourly' } });
    clock = at(2026, 10, 27, 9, 0);
    await s.tick(false);
    running.add('s1');
    clock = at(2026, 10, 27, 10, 0);
    await s.tick(false);
    expect(created).toHaveLength(1);
    expect(s.list()[0].runs[0]).toMatchObject({ status: 'skipped' });
  });

  it('turns a one-off off after it runs, and keeps it off until it is given a new time', async () => {
    const s = make();
    s.save({ ...draft, schedule: { type: 'once', at: at(2026, 10, 27, 9, 0) } });
    clock = at(2026, 10, 27, 9, 0);
    await s.tick(false);
    expect(s.list()[0]).toMatchObject({ enabled: false, nextRunAt: null });
    const id = s.list()[0].id;
    s.save({ ...draft, id, schedule: { type: 'once', at: at(2026, 10, 28, 9, 0) } });
    expect(s.list()[0]).toMatchObject({ enabled: true, nextRunAt: at(2026, 10, 28, 9, 0) });
  });

  it('runs on demand without moving the schedule, and survives a restart', async () => {
    const s = make();
    s.save({ ...draft, schedule: { type: 'daily', time: '09:00' } });
    const { id, nextRunAt } = s.list()[0];
    await s.runNow(id);
    expect(created).toHaveLength(1);
    expect(make().list()[0]).toMatchObject({ id, nextRunAt });
    s.setEnabled(id, false);
    expect(make().list()[0]).toMatchObject({ enabled: false, nextRunAt: null });
  });

  it('validates a draft', () => {
    const s = make();
    expect(() => s.save({ ...draft, name: ' ', schedule: { type: 'hourly' } })).toThrow('名字');
    expect(() => s.save({ ...draft, projectPath: null, schedule: { type: 'hourly' } })).toThrow('项目');
    s.save({ ...draft, schedule: { type: 'hourly' } });
    expect(() => s.save({ ...draft, schedule: { type: 'hourly' } })).toThrow('已经有');
    // The same name is fine in the other tab.
    s.save({ ...draft, kind: 'work', projectPath: null, schedule: { type: 'hourly' } });
    expect(s.list()).toHaveLength(2);
  });
});
