// The chat tools for the Scheduled and Customize pages drive the same backends as the pages.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  catalog,
  createSkill,
  removeConnector,
  saveConnector,
  setConnectorEnabled,
  setSkillDisabled,
  type CustomizeEnv,
} from '../src/agent/customize';
import {
  registerManageTools,
  type CustomizeHost,
  type ProjectHost,
  type ScheduleHost,
} from '../src/agent/manage-tools';
import type { ScheduledTask, TaskDraft } from '../src/shared/schedule';
import type { WorkProject } from '../src/shared/protocol';

function setup() {
  const tools = new Map<string, any>();
  const tasks: ScheduledTask[] = [];
  const schedule: ScheduleHost = {
    list: () => tasks,
    save: (d: TaskDraft) => {
      const existing = tasks.find((t) => t.id === d.id);
      if (existing) Object.assign(existing, d);
      else
        tasks.unshift({
          ...d,
          id: `t${tasks.length}`,
          enabled: true,
          createdAt: 0,
          nextRunAt: 1,
          lastRunAt: null,
          runs: [],
        } as ScheduledTask);
      return tasks;
    },
    setEnabled: (id, enabled) => ((tasks.find((t) => t.id === id)!.enabled = enabled), tasks),
    remove: (id) => (
      tasks.splice(
        tasks.findIndex((t) => t.id === id),
        1,
      ),
      tasks
    ),
    runNow: async () => ({ id: 's1' }),
    defaults: { kind: 'code', projectPath: '/p' },
  };
  registerManageTools({ registerTool: (t: any) => tools.set(t.name, t) } as any, { schedule });
  return { tools, tasks };
}

describe('pidesk_schedule_manage', () => {
  it('creates a task in the session’s project and lists it', async () => {
    const { tools, tasks } = setup();
    const out = await tools
      .get('pidesk_schedule_manage')
      .execute('c', { action: 'create', name: 'Daily', prompt: 'do it', schedule: { type: 'daily', time: '09:00' } });
    expect(out.content[0].text).toMatch(/Created scheduled task "Daily"/);
    expect(tasks[0]).toMatchObject({
      kind: 'code',
      projectPath: '/p',
      mode: 'auto',
      schedule: { type: 'daily', time: '09:00' },
    });
    expect((await tools.get('pidesk_schedule_list').execute()).content[0].text).toContain('Daily');
  });

  it('refuses a bad schedule and an unknown id', async () => {
    const { tools } = setup();
    const manage = tools.get('pidesk_schedule_manage');
    await expect(
      manage.execute('c', { action: 'create', name: 'x', prompt: 'y', schedule: { type: 'daily', time: '25:99' } }),
    ).rejects.toThrow(/HH:MM/);
    await expect(manage.execute('c', { action: 'delete', id: 'nope' })).rejects.toThrow(/No scheduled task/);
  });

  it('is not read-only, so plan mode blocks it and auto mode asks', () => {
    const { tools } = setup();
    expect(tools.get('pidesk_schedule_manage').annotations).toEqual({ destructiveHint: true });
    expect(tools.get('pidesk_schedule_list').annotations).toEqual({ readOnlyHint: true });
  });
});

describe('pidesk_schedule_manage, the rest of the actions', () => {
  it('updates, switches, runs and deletes by id', async () => {
    const { tools, tasks } = setup();
    const manage = tools.get('pidesk_schedule_manage');
    await manage.execute('c', {
      action: 'create',
      name: 'Daily',
      prompt: 'do it',
      schedule: { type: 'daily', time: '09:00' },
    });
    const id = tasks[0].id;
    await manage.execute('c', {
      action: 'update',
      id,
      prompt: 'new prompt',
      schedule: { type: 'weekdays', time: '08:30' },
    });
    expect(tasks[0]).toMatchObject({
      prompt: 'new prompt',
      schedule: { type: 'weekdays', time: '08:30' },
      name: 'Daily',
    });
    await manage.execute('c', { action: 'disable', id });
    expect(tasks[0].enabled).toBe(false);
    await manage.execute('c', { action: 'enable', id });
    expect(tasks[0].enabled).toBe(true);
    expect((await manage.execute('c', { action: 'run', id })).details).toEqual({ session: 's1' });
    await manage.execute('c', { action: 'delete', id });
    expect(tasks).toHaveLength(0);
  });
});

describe('pidesk_customize_*', () => {
  let root: string;
  let env: CustomizeEnv;
  let tools: Map<string, any>;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-manage-'));
    env = {
      agentDir: path.join(root, 'agent'),
      project: path.join(root, 'project'),
      projectTrusted: true,
      claudeSkillsDeclined: true,
    };
    fs.mkdirSync(env.agentDir, { recursive: true });
    fs.mkdirSync(env.project!, { recursive: true });
    tools = new Map();
    const customize: CustomizeHost = {
      list: () => catalog(env),
      createSkill: (d) => createSkill(env, d),
      setSkillDisabled: (f, d) => setSkillDisabled(env, f, d),
      saveConnector: async (d) => saveConnector(env, d),
      setConnectorEnabled: async (n, s, e) => setConnectorEnabled(env, n, s, e),
      removeConnector: async (n, s) => removeConnector(env, n, s),
      installPlugin: async () => {},
      removePlugin: async () => {},
    };
    registerManageTools({ registerTool: (t: any) => tools.set(t.name, t) } as any, { customize });
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('creates a skill, switches it off and shows both in the list', async () => {
    const manage = tools.get('pidesk_customize_manage');
    await manage.execute('c', {
      action: 'create_skill',
      name: 'gamma',
      description: 'Third',
      body: 'Do gamma.',
      scope: 'project',
    });
    const file = path.join(env.project!, '.pi', 'skills', 'gamma', 'SKILL.md');
    expect(fs.existsSync(file)).toBe(true);
    const listed = (await tools.get('pidesk_customize_list').execute()).content[0].text as string;
    expect(listed).toContain('gamma · project');
    await manage.execute('c', { action: 'set_skill_disabled', file, disabled: true });
    expect((await tools.get('pidesk_customize_list').execute()).content[0].text).toContain('gamma · project · off');
  });

  it('saves, switches off and removes a connector', async () => {
    const manage = tools.get('pidesk_customize_manage');
    await manage.execute('c', {
      action: 'save_connector',
      name: 'docs',
      transport: 'http',
      url: 'https://example.com/mcp',
    });
    expect((await tools.get('pidesk_customize_list').execute()).content[0].text).toContain('docs · user · http · on');
    await manage.execute('c', { action: 'set_connector_enabled', name: 'docs', enabled: false });
    expect((await tools.get('pidesk_customize_list').execute()).content[0].text).toContain('docs · user · http · off');
    await manage.execute('c', { action: 'remove_connector', name: 'docs' });
    expect((await tools.get('pidesk_customize_list').execute()).content[0].text).not.toContain('docs · user');
  });

  it('names the missing field instead of guessing', async () => {
    const manage = tools.get('pidesk_customize_manage');
    await expect(manage.execute('c', { action: 'create_skill', name: 'x' })).rejects.toThrow(
      'create_skill needs description',
    );
    await expect(manage.execute('c', { action: 'install_plugin' })).rejects.toThrow('install_plugin needs source');
  });

  it('marks the changing tool destructive and the listing read-only', () => {
    expect(tools.get('pidesk_customize_manage').annotations).toEqual({ destructiveHint: true });
    expect(tools.get('pidesk_customize_list').annotations).toEqual({ readOnlyHint: true });
  });
});

describe('pidesk_project_manage', () => {
  function setup(project?: ProjectHost) {
    const tools = new Map<string, any>();
    registerManageTools({ registerTool: (t: any) => tools.set(t.name, t) } as any, { project });
    return tools;
  }
  const makeProject = (): WorkProject => ({
    path: '/work/acme',
    name: 'Acme',
    addedAt: 0,
    description: 'Quarterly reports',
    instructions: 'Answer in Chinese',
    links: [{ title: 'Board', url: 'https://example.com/board' }],
    memory: '- uses CSV',
  });

  it('is left out when the session has no project to manage', () => {
    expect(setup().has('pidesk_project_manage')).toBe(false);
  });

  it('shows every field with its size and the links', async () => {
    const project = makeProject();
    const tools = setup({ get: () => project, update: () => project });
    const out = await tools.get('pidesk_project_manage').execute('c', { action: 'show' });
    const shown = out.content[0].text as string;
    expect(shown).toContain('Project "Acme" — /work/acme');
    expect(shown).toContain('Quarterly reports');
    expect(shown).toContain('Answer in Chinese');
    expect(shown).toContain('- Board: https://example.com/board');
    expect(shown).toContain('uses CSV');
    expect(shown).toContain('pidesk_remember');
  });

  it('passes only the fields given, so the rest stays as it is', async () => {
    let project = makeProject();
    const patches: unknown[] = [];
    const tools = setup({
      get: () => project,
      update: (patch) => (patches.push(patch), (project = { ...project, ...patch })),
    });
    const out = await tools.get('pidesk_project_manage').execute('c', { action: 'update', description: '', links: [] });
    expect(patches).toEqual([{ description: '', links: [] }]);
    expect(project).toMatchObject({ name: 'Acme', instructions: 'Answer in Chinese', description: '', links: [] });
    expect(out.content[0].text).toContain('Updated description, links of project "Acme"');
  });
});
