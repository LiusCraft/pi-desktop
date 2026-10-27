import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ActivityRecorder } from '../src/agent/activity';
import { Store } from '../src/agent/store';
import { activityLevels, dayKey, emptyDay, rangeStats, summarize, type ActivityLog } from '../src/shared/activity';

const day = (code: number, work = 0) => ({ ...emptyDay(), prompts: { code, work } });

describe('activity recorder', () => {
  it('counts prompts per local day and kind, remembers sessions once, and survives a restart', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-'));
    const at = new Date(2026, 9, 27, 23, 59).getTime();
    const rec = new ActivityRecorder(new Store(dir));
    rec.recordPrompt('code', 'a', '/p/app', at);
    rec.recordPrompt('code', 'a', '/p/app', at);
    rec.recordPrompt('work', 'b', '', at);
    const today = rec.get()['2026-10-27'];
    expect(today.prompts).toEqual({ code: 2, work: 1 });
    expect(today.sessions).toEqual(['a', 'b']);
    expect(today.projects).toEqual({ '/p/app': 2, '': 1 });
    expect(today.hours[23]).toBe(3);
    expect(new ActivityRecorder(new Store(dir)).get()).toEqual(rec.get());
  });
});

describe('activity summary', () => {
  it('keeps the current streak alive while today is still empty', () => {
    const log: ActivityLog = { '2026-10-24': day(1), '2026-10-25': day(2), '2026-10-26': day(1), '2026-10-20': day(1), '2026-10-21': day(1) };
    expect(summarize(log, new Date(2026, 9, 27))).toEqual({ activeDays: 5, currentStreak: 3, longestStreak: 3 });
    expect(summarize(log, new Date(2026, 9, 29)).currentStreak).toBe(0);
  });

  it('formats keys in local time', () => {
    expect(dayKey(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05');
  });

  it('spreads levels over the user\'s own non-zero days', () => {
    const log: ActivityLog = {};
    [1, 2, 3, 4, 5, 6, 7, 8].forEach((n, i) => (log[`2026-10-0${i + 1}`] = day(n)));
    const level = activityLevels(log);
    expect([0, 1, 4, 8].map(level)).toEqual([0, 1, 2, 4]);
    expect(activityLevels({})(3)).toBe(1);
  });
});

describe('range stats', () => {
  it('totals a window of days, ranks projects and finds the busiest day and hour', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-'));
    const rec = new ActivityRecorder(new Store(dir));
    rec.recordPrompt('code', 'a', '/p/app', new Date(2026, 9, 27, 9).getTime());
    rec.recordPrompt('code', 'a', '/p/app', new Date(2026, 9, 26, 21).getTime());
    rec.recordPrompt('code', 'a', '/p/app', new Date(2026, 9, 26, 21).getTime());
    rec.recordPrompt('work', 'b', '', new Date(2026, 9, 26, 22).getTime());
    rec.recordPrompt('code', 'c', '/p/old', new Date(2026, 8, 1, 10).getTime());
    const s = rangeStats(rec.get(), new Date(2026, 9, 27), 7);
    expect(s).toMatchObject({ prompts: 4, code: 3, work: 1, activeDays: 2, busiest: { key: '2026-10-26', total: 3 } });
    expect(s.projects).toEqual([{ path: '/p/app', count: 3 }, { path: '', count: 1 }]);
    expect(s.hours[21]).toBe(2);
  });
});
