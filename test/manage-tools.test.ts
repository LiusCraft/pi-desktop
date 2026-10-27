// The chat tools for the Scheduled and Customize pages drive the same backends as the pages.
import { describe, expect, it } from 'vitest';
import { registerManageTools, type ScheduleHost } from '../src/agent/manage-tools';
import type { ScheduledTask, TaskDraft } from '../src/shared/schedule';

function setup() {
  const tools = new Map<string, any>();
  const tasks: ScheduledTask[] = [];
  const schedule: ScheduleHost = {
    list: () => tasks,
    save: (d: TaskDraft) => {
      tasks.unshift({ ...d, id: `t${tasks.length}`, enabled: true, createdAt: 0, nextRunAt: 1, lastRunAt: null, runs: [] } as ScheduledTask);
      return tasks;
    },
    setEnabled: (id, enabled) => (tasks.find((t) => t.id === id)!.enabled = enabled, tasks),
    remove: (id) => (tasks.splice(tasks.findIndex((t) => t.id === id), 1), tasks),
    runNow: async () => ({ id: 's1' }),
    defaults: { kind: 'code', projectPath: '/p' },
  };
  registerManageTools({ registerTool: (t: any) => tools.set(t.name, t) } as any, { schedule });
  return { tools, tasks };
}

describe('pidesk_schedule_manage', () => {
  it('creates a task in the session’s project and lists it', async () => {
    const { tools, tasks } = setup();
    const out = await tools.get('pidesk_schedule_manage').execute('c', { action: 'create', name: 'Daily', prompt: 'do it', schedule: { type: 'daily', time: '09:00' } });
    expect(out.content[0].text).toMatch(/Created scheduled task "Daily"/);
    expect(tasks[0]).toMatchObject({ kind: 'code', projectPath: '/p', mode: 'auto', schedule: { type: 'daily', time: '09:00' } });
    expect((await tools.get('pidesk_schedule_list').execute()).content[0].text).toContain('Daily');
  });

  it('refuses a bad schedule and an unknown id', async () => {
    const { tools } = setup();
    const manage = tools.get('pidesk_schedule_manage');
    await expect(manage.execute('c', { action: 'create', name: 'x', prompt: 'y', schedule: { type: 'daily', time: '25:99' } })).rejects.toThrow(/HH:MM/);
    await expect(manage.execute('c', { action: 'delete', id: 'nope' })).rejects.toThrow(/No scheduled task/);
  });

  it('is not read-only, so plan mode blocks it and auto mode asks', () => {
    const { tools } = setup();
    expect(tools.get('pidesk_schedule_manage').annotations).toEqual({ destructiveHint: true });
    expect(tools.get('pidesk_schedule_list').annotations).toEqual({ readOnlyHint: true });
  });
});
