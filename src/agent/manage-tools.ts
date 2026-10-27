/**
 * Tools that let the model manage what the Scheduled and Customize pages manage, so "run this
 * every morning" or "add the GitHub connector" can be said in the chat. They call the same
 * backends as the pages (`Scheduler`, `customize.ts`), so the UI and the model always agree.
 * The `*_manage` tools change things and are not read-only: plan mode blocks them and auto mode asks.
 */
import { StringEnum } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type, type Static } from 'typebox';
import type { CustomizeCatalog, SessionKind } from '@shared/protocol';
import { describeSchedule, validateSchedule, type ScheduledTask, type TaskDraft, type TaskSchedule } from '@shared/schedule';
import { PERMISSION_MODES } from '@shared/protocol';

export interface ScheduleHost {
  list(): ScheduledTask[];
  save(draft: TaskDraft): ScheduledTask[];
  setEnabled(id: string, enabled: boolean): ScheduledTask[];
  remove(id: string): ScheduledTask[];
  runNow(id: string): Promise<{ id: string }>;
  /** What a task created from this session defaults to: its tab and its project. */
  defaults: { kind: SessionKind; projectPath: string | null };
}

export interface CustomizeHost {
  list(): Promise<CustomizeCatalog>;
  createSkill(draft: { name: string; description: string; body: string; scope: 'user' | 'project' }): Promise<unknown>;
  setSkillDisabled(file: string, disabled: boolean): Promise<unknown>;
  saveConnector(draft: {
    originalName?: string; name: string; scope: 'user' | 'project'; transport: 'stdio' | 'http';
    command?: string; args?: string[]; url?: string; pairs?: string[]; description?: string;
  }): Promise<unknown>;
  setConnectorEnabled(name: string, scope: 'user' | 'project', enabled: boolean): Promise<unknown>;
  removeConnector(name: string, scope: 'user' | 'project'): Promise<unknown>;
  installPlugin(source: string, scope: 'user' | 'project'): Promise<unknown>;
  removePlugin(source: string, scope: 'user' | 'project'): Promise<unknown>;
}

const text = (t: string, details: unknown = {}) => ({ content: [{ type: 'text' as const, text: t }], details });
const when = (ms: number | null) => (ms === null ? '—' : new Date(ms).toLocaleString());
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);

// ------------------------------------------------------------ schedule

const Schedule = Type.Object({
  type: StringEnum(['manual', 'hourly', 'daily', 'weekdays', 'weekly', 'once', 'cron'] as const),
  time: Type.Optional(Type.String({ description: 'HH:MM, 24-hour local time (daily, weekdays, weekly)' })),
  day: Type.Optional(Type.Number({ description: 'Weekly: 0 = Sunday … 6 = Saturday' })),
  at: Type.Optional(Type.String({ description: 'Once: local date and time, e.g. 2026-11-02T09:30' })),
  expr: Type.Optional(Type.String({ description: 'Cron: "min hour day-of-month month day-of-week" in local time; runs must be at least an hour apart' })),
});

function toSchedule(s: Static<typeof Schedule>): TaskSchedule {
  switch (s.type) {
    case 'manual':
    case 'hourly':
      return { type: s.type };
    case 'daily':
    case 'weekdays':
      return { type: s.type, time: s.time ?? '' };
    case 'weekly':
      return { type: 'weekly', time: s.time ?? '', day: s.day ?? -1 };
    case 'once':
      return { type: 'once', at: Date.parse(s.at ?? '') };
    case 'cron':
      return { type: 'cron', expr: s.expr ?? '' };
  }
}

function describeTask(t: ScheduledTask) {
  const head = `- ${t.id} · ${t.name} · ${t.enabled ? 'on' : 'off'} · ${describeSchedule(t.schedule)} · next ${when(t.nextRunAt)} · last ${when(t.lastRunAt)}`;
  const where = t.kind === 'work' ? `Work${t.projectPath ? ` in ${t.projectPath}` : ' (fresh workspace)'}` : `Code in ${t.projectPath}${t.worktree ? ' (own worktree)' : ''}`;
  return `${head}\n  ${where} · mode ${t.mode}${t.model ? ` · model ${t.model}` : ''}\n  prompt: ${clip(t.prompt.replace(/\s+/g, ' '), 300)}`;
}

function registerSchedule(pi: ExtensionAPI, host: ScheduleHost) {
  pi.registerTool({
    name: 'pidesk_schedule_list',
    label: 'Scheduled tasks',
    description: 'List the scheduled tasks (the Scheduled page): id, schedule, next and last run, prompt. Use it before changing or removing one.',
    parameters: Type.Object({}),
    annotations: { readOnlyHint: true },
    async execute() {
      const tasks = host.list();
      return text(tasks.length ? tasks.map(describeTask).join('\n') : 'There are no scheduled tasks.', { tasks });
    },
  });

  pi.registerTool({
    name: 'pidesk_schedule_manage',
    label: 'Manage scheduled task',
    description:
      'Create, update, enable, disable, delete or run a scheduled task. Each run starts a fresh session that gets the task prompt, ' +
      'so the prompt must be complete and self-contained. Tasks only fire while Pi Desktop is running. ' +
      'create needs name, prompt and schedule; update needs id plus the fields to change; enable / disable / delete / run need id (see pidesk_schedule_list).',
    promptSnippet: 'Create and manage scheduled (recurring) tasks',
    parameters: Type.Object({
      action: StringEnum(['create', 'update', 'enable', 'disable', 'delete', 'run'] as const),
      id: Type.Optional(Type.String({ description: 'Task id, for everything except create' })),
      name: Type.Optional(Type.String({ description: 'Short unique name' })),
      prompt: Type.Optional(Type.String({ description: 'What to do on every run, written for a session that knows nothing else' })),
      schedule: Type.Optional(Schedule),
      project_path: Type.Optional(Type.String({ description: 'Folder to run in; defaults to this session’s project' })),
      worktree: Type.Optional(Type.Boolean({ description: 'Code tasks: run each time in its own git worktree' })),
      mode: Type.Optional(StringEnum([...PERMISSION_MODES] as [string, ...string[]], { description: 'Permission mode of the runs; unattended runs usually want auto (the default)' })),
      model: Type.Optional(Type.String({ description: 'Model id, or omit for the default' })),
    }),
    annotations: { destructiveHint: true },
    async execute(_id, p) {
      const need = () => {
        if (!p.id) throw new Error(`${p.action} needs the task id (pidesk_schedule_list shows them)`);
        const t = host.list().find((x) => x.id === p.id);
        if (!t) throw new Error(`No scheduled task ${p.id}`);
        return t;
      };
      switch (p.action) {
        case 'create': {
          const { name, prompt } = p;
          if (!name || !prompt || !p.schedule) throw new Error('create needs name, prompt and schedule');
          const schedule = toSchedule(p.schedule);
          const bad = validateSchedule(schedule);
          if (bad) throw new Error(bad);
          const { kind, projectPath } = host.defaults;
          const tasks = host.save({
            name, prompt, kind, projectPath: p.project_path ?? projectPath,
            worktree: p.worktree ?? false, mode: (p.mode as TaskDraft['mode']) ?? 'auto', model: p.model ?? null, schedule,
          });
          const made = tasks.find((t) => t.name === name.trim() && t.kind === kind) ?? tasks[0];
          return text(`Created scheduled task "${made.name}" (${made.id}): ${describeSchedule(made.schedule)}, next run ${when(made.nextRunAt)}.`, { task: made });
        }
        case 'update': {
          const t = need();
          const schedule = p.schedule ? toSchedule(p.schedule) : t.schedule;
          const bad = p.schedule && validateSchedule(schedule);
          if (bad) throw new Error(bad);
          const tasks = host.save({
            id: t.id, name: p.name ?? t.name, prompt: p.prompt ?? t.prompt, kind: t.kind, projectPath: p.project_path ?? t.projectPath,
            worktree: p.worktree ?? t.worktree, mode: (p.mode as TaskDraft['mode']) ?? t.mode, model: p.model ?? t.model, schedule,
          });
          const now = tasks.find((x) => x.id === t.id)!;
          return text(`Updated "${now.name}": ${describeSchedule(now.schedule)}, next run ${when(now.nextRunAt)}.`, { task: now });
        }
        case 'enable':
        case 'disable': {
          const t = need();
          const now = host.setEnabled(t.id, p.action === 'enable').find((x) => x.id === t.id)!;
          return text(`"${now.name}" is now ${now.enabled ? 'on' : 'off'}${now.nextRunAt ? `, next run ${when(now.nextRunAt)}` : ''}.`, { task: now });
        }
        case 'delete': {
          const t = need();
          host.remove(t.id);
          return text(`Deleted scheduled task "${t.name}".`);
        }
        case 'run': {
          const t = need();
          const session = await host.runNow(t.id);
          return text(`Started "${t.name}" now in a new session (${session.id}). Its schedule is unchanged.`, { session: session.id });
        }
      }
    },
  });
}

// ------------------------------------------------------------ customize

const Scope = StringEnum(['user', 'project'] as const, { description: 'user = every project, project = only the current project’s .pi folder' });

function describeCatalog(c: CustomizeCatalog) {
  const none = '  (none)';
  const skills = c.skills.map((s) => `  - ${s.name} · ${s.scope}${s.disabled ? ' · off' : ''}${s.manualOnly ? ' · manual only' : ''} · ${clip(s.description, 120)}\n    file: ${s.file}`);
  const connectors = c.connectors.map((s) => `  - ${s.name} · ${s.scope} · ${s.transport} · ${s.enabled ? 'on' : 'off'} · ${clip(s.target, 120)} · ${s.tools.length} tools`);
  const plugins = c.plugins.map((p) => `  - ${p.source} · ${p.scope}`);
  const prompts = c.prompts.map((p) => `  - /${p.name} · ${p.scope} · ${clip(p.description, 100)}`);
  return [
    `Project: ${c.project ?? '(none selected)'}`,
    `Skills:\n${skills.join('\n') || none}`,
    `Connectors (MCP servers):\n${connectors.join('\n') || none}`,
    `Plugins (pi packages):\n${plugins.join('\n') || none}`,
    `Prompt templates:\n${prompts.join('\n') || none}`,
  ].join('\n');
}

function registerCustomize(pi: ExtensionAPI, host: CustomizeHost) {
  pi.registerTool({
    name: 'pidesk_customize_list',
    label: 'Customize',
    description: 'List what is installed on the Customize page: skills (with their file paths), connectors (MCP servers), plugins and prompt templates.',
    parameters: Type.Object({}),
    annotations: { readOnlyHint: true },
    async execute() {
      const catalog = await host.list();
      return text(describeCatalog(catalog), { catalog });
    },
  });

  pi.registerTool({
    name: 'pidesk_customize_manage',
    label: 'Manage customization',
    description:
      'Add, switch on/off or remove skills, connectors (MCP servers) and plugins. Actions: ' +
      'create_skill (name, description, body, scope); set_skill_disabled (file from pidesk_customize_list, disabled); ' +
      'save_connector (name, scope, transport, then command/args/env for stdio or url/headers for http; original_name to rename); ' +
      'set_connector_enabled (name, scope, enabled); remove_connector (name, scope); ' +
      'install_plugin / remove_plugin (source like npm:pi-web-access or git:github.com/user/repo, scope). ' +
      'Connectors and plugins run code on this machine: only add ones the user asked for. New connectors and plugins load in new sessions.',
    promptSnippet: 'Manage skills, connectors (MCP servers) and plugins',
    parameters: Type.Object({
      action: StringEnum([
        'create_skill', 'set_skill_disabled', 'save_connector', 'set_connector_enabled', 'remove_connector', 'install_plugin', 'remove_plugin',
      ] as const),
      name: Type.Optional(Type.String({ description: 'Skill or connector name (letters, digits, - and _)' })),
      original_name: Type.Optional(Type.String({ description: 'save_connector: the current name, when renaming or editing an existing connector' })),
      scope: Type.Optional(Scope),
      description: Type.Optional(Type.String({ description: 'Skill: when the model should use it. Connector: what it is for' })),
      body: Type.Optional(Type.String({ description: 'Skill: the Markdown instructions' })),
      file: Type.Optional(Type.String({ description: 'Skill file path from pidesk_customize_list' })),
      disabled: Type.Optional(Type.Boolean()),
      enabled: Type.Optional(Type.Boolean()),
      transport: Type.Optional(StringEnum(['stdio', 'http'] as const)),
      command: Type.Optional(Type.String({ description: 'stdio connector: the executable, e.g. npx' })),
      args: Type.Optional(Type.Array(Type.String(), { description: 'stdio connector: arguments' })),
      url: Type.Optional(Type.String({ description: 'http connector: the endpoint' })),
      pairs: Type.Optional(Type.Array(Type.String(), { description: 'stdio: KEY=VALUE env entries. http: "Header: value" entries' })),
      source: Type.Optional(Type.String({ description: 'Plugin source, e.g. npm:pi-web-access' })),
    }),
    annotations: { destructiveHint: true },
    async execute(_id, p) {
      const scope = p.scope ?? 'user';
      const must = <T>(value: T | undefined, field: string): T => {
        if (value === undefined || value === '') throw new Error(`${p.action} needs ${field}`);
        return value;
      };
      switch (p.action) {
        case 'create_skill':
          await host.createSkill({ name: must(p.name, 'name'), description: must(p.description, 'description'), body: must(p.body, 'body'), scope });
          return text(`Created skill ${p.name} (${scope}). It is available in new sessions.`);
        case 'set_skill_disabled':
          await host.setSkillDisabled(must(p.file, 'file'), must(p.disabled, 'disabled'));
          return text(`Skill ${p.disabled ? 'switched off' : 'switched on'}.`);
        case 'save_connector':
          await host.saveConnector({
            originalName: p.original_name, name: must(p.name, 'name'), scope, transport: must(p.transport, 'transport'),
            command: p.command, args: p.args, url: p.url, pairs: p.pairs, description: p.description,
          });
          return text(`Saved connector ${p.name} (${scope}). It connects in new sessions.`);
        case 'set_connector_enabled':
          await host.setConnectorEnabled(must(p.name, 'name'), scope, must(p.enabled, 'enabled'));
          return text(`Connector ${p.name} ${p.enabled ? 'switched on' : 'switched off'}.`);
        case 'remove_connector':
          await host.removeConnector(must(p.name, 'name'), scope);
          return text(`Removed connector ${p.name}.`);
        case 'install_plugin':
          await host.installPlugin(must(p.source, 'source'), scope);
          return text(`Installed plugin ${p.source} (${scope}). It loads in new sessions.`);
        case 'remove_plugin':
          await host.removePlugin(must(p.source, 'source'), scope);
          return text(`Removed plugin ${p.source}.`);
      }
    },
  });
}

export function registerManageTools(pi: ExtensionAPI, host: { schedule?: ScheduleHost; customize?: CustomizeHost }) {
  if (host.schedule) registerSchedule(pi, host.schedule);
  if (host.customize) registerCustomize(pi, host.customize);
}
