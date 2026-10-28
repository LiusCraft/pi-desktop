/**
 * Tools that let the model manage what the app's pages manage, so "run this
 * every morning", "add the GitHub connector" or "shorten this project's instructions" can be said in the chat.
 * They call the same backends as the pages (`Scheduler`, `customize.ts`, `ProjectBook`), so the UI and the model always agree.
 * Each group is on by default and can be switched off under Settings → 通用 → AI 工具; it is read when a session starts.
 * The tools that change things are not read-only: plan mode blocks them and auto mode asks.
 */
import { StringEnum } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type, type Static } from 'typebox';
import type { CustomizeCatalog, SessionKind, Settings, WorkProject } from '@shared/protocol';
import { AI_SETTING_FIELDS, AI_SETTING_KEYS, checkAiSettingsPatch } from '@shared/ai-settings';
import { describeSchedule, validateSchedule, type ScheduledTask, type TaskDraft, type TaskSchedule } from '@shared/schedule';
import { PERMISSION_MODES, PROJECT_LIMITS } from '@shared/protocol';
import { publishState, type ArtifactMeta } from '@shared/artifacts';
import { STORAGE_NOT_CONFIGURED } from '@shared/storage';
import { BUILTIN_PETS, PET_GRID, PET_LIMITS, PET_PARTS, type PetDef } from '@shared/pets';
import { SOUND_EVENTS, SOUND_LIMITS, SOUND_WAVES } from '@shared/sounds';
import type { ProjectEdit } from './work-project';

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

export interface PetHost {
  /** The user's own skins (the built-in ones are in `BUILTIN_PETS`). */
  list(): PetDef[];
  /** Validates, stores and returns the skin; throws a readable message for a bad definition. */
  save(raw: unknown): PetDef;
  remove(id: string): void;
}

export interface SettingsHost {
  get(): Settings;
  /** Every pet skin id a `petSkin` may name: the built-in ones and the user's own. */
  petIds(): string[];
  save(patch: Partial<Settings>): void;
}

export interface ArtifactHost {
  list(): ArtifactMeta[];
  save(input: { id?: string; title?: string; source: string }): ArtifactMeta;
  publish(id: string): Promise<ArtifactMeta>;
  unpublish(id: string): Promise<ArtifactMeta>;
  remove(id: string, unpublish?: boolean): Promise<void>;
  /** Whether the user's bucket is set up, i.e. whether publishing can work at all. */
  storageReady(): boolean;
}

export interface ProjectHost {
  /** The Work project this session runs in; throws a readable message when the folder is no longer one. */
  get(): WorkProject;
  /** Saves the fields given (an empty string clears the description or instructions) and returns the project as saved. */
  update(patch: ProjectEdit): WorkProject;
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

// ------------------------------------------------------------ pets

const PetPartField = StringEnum([...PET_PARTS] as [string, ...string[]], { description: 'Animated part; omit for plain body pixels' });
const PetRectField = Type.Object({
  x: Type.Integer(), y: Type.Integer(), w: Type.Integer({ minimum: 1 }), h: Type.Integer({ minimum: 1 }), part: Type.Optional(PetPartField),
});
const PetShapeField = Type.Object({
  fill: Type.String({ description: 'Hex colour, e.g. #d97757' }),
  part: Type.Optional(PetPartField),
  rects: Type.Array(PetRectField, { minItems: 1 }),
});

function registerPets(pi: ExtensionAPI, host: PetHost) {
  const json = (pet: PetDef) => JSON.stringify(pet);
  pi.registerTool({
    name: 'pidesk_pet_list',
    label: 'Pets',
    description:
      'Show the desktop pet skins and how a skin is built. A skin is a pixel drawing made of filled rectangles on an integer grid: ' +
      `x ${PET_GRID.minX}..${PET_GRID.maxX}, y ${PET_GRID.minY}..${PET_GRID.maxY}, the body sitting around x 0..22 and y -4..14 with its feet at y 14. ` +
      `A rectangle may carry a part (${PET_PARTS.join(', ')}) and the app animates parts by name: legs step, arms tap, eyes blink, the mouth talks, the tail swings. ` +
      'Always call this before designing a skin: the built-in pets it prints are the reference to copy the structure and proportions from.',
    parameters: Type.Object({}),
    annotations: { readOnlyHint: true },
    async execute() {
      const custom = host.list();
      return text(
        [
          'Built-in pets (copy their structure for a new skin):',
          ...BUILTIN_PETS.map((p) => `- ${p.id}: ${json(p)}`),
          `Custom pets:${custom.length ? '' : ' (none)'}`,
          ...custom.map((p) => `- ${p.id} · ${p.label}`),
        ].join('\n'),
        { builtin: BUILTIN_PETS, custom },
      );
    },
  });

  pi.registerTool({
    name: 'pidesk_pet_manage',
    label: 'Manage pet',
    description:
      'Create, replace or delete a custom desktop pet skin; it shows up under Settings → Appearance → Pet skin. ' +
      'save needs id (lowercase letters, digits, -), label (the name shown, up to ' + PET_LIMITS.label + ' characters) and shapes, a list of {fill, part?, rects:[{x,y,w,h,part?}]} painted first to last. ' +
      'Build it like the built-in pets (see pidesk_pet_list): a body block, four legs (parts "leg a" / "leg b" alternating), arms (parts "arm l" / "arm r"), ' +
      'eyes as a shape with part "eyes", a one-pixel-high rectangle with part "mouth", an optional "tail". Keep feet at y 14 and the head near y 0. ' +
      `Optionally sounds: its own synthesized voices, an object keyed by event (${SOUND_EVENTS.join(', ')}); each is {wave, gain, notes:[{freq,at,len}]}. Events left out play the default. ` +
      'delete needs id. Saving an existing id replaces it. Tell the user to pick the skin in Settings → Appearance.',
    promptSnippet: 'Create custom desktop pet skins in the built-in pets’ pixel format',
    parameters: Type.Object({
      action: StringEnum(['save', 'delete'] as const),
      id: Type.String({ description: 'Skin id' }),
      label: Type.Optional(Type.String({ description: 'save: the name shown in Settings' })),
      shapes: Type.Optional(Type.Array(PetShapeField, { description: `save: the drawing (at most ${PET_LIMITS.shapes} shapes, ${PET_LIMITS.rects} rectangles in all)` })),
      sounds: Type.Optional(Type.Any({ description: `save: the pet's voices; wave ${SOUND_WAVES.join('/')}, gain 0..${SOUND_LIMITS.gain}, at most ${SOUND_LIMITS.notes} notes (freq ${SOUND_LIMITS.freq.min}-${SOUND_LIMITS.freq.max} Hz, at 0-${SOUND_LIMITS.at.max} s, len ${SOUND_LIMITS.len.min}-${SOUND_LIMITS.len.max} s)` })),
    }),
    annotations: { destructiveHint: true },
    async execute(_id, p) {
      if (p.action === 'delete') {
        host.remove(p.id);
        return text(`Deleted pet ${p.id}.`);
      }
      const pet = host.save({ id: p.id, label: p.label, shapes: p.shapes, sounds: p.sounds });
      return text(`Saved pet "${pet.label}" (${pet.id}). It is listed under Settings → Appearance → Pet skin.`, { pet });
    },
  });
}

// ------------------------------------------------------------ app settings

function registerSettings(pi: ExtensionAPI, host: SettingsHost) {
  const describe = () => {
    const current = host.get();
    return AI_SETTING_KEYS.map((key) => `- ${key} = ${JSON.stringify(current[key])}  (${AI_SETTING_FIELDS[key].hint})`).join('\n');
  };

  pi.registerTool({
    name: 'pidesk_settings_list',
    label: 'App settings',
    description: 'Show the app settings you may change (Settings page) with their current values and what each accepts.',
    parameters: Type.Object({}),
    annotations: { readOnlyHint: true },
    async execute() {
      return text(describe(), { settings: host.get() });
    },
  });

  pi.registerTool({
    name: 'pidesk_settings_manage',
    label: 'Change app settings',
    description:
      'Change app settings on the Settings page: set takes values, an object of setting name to new value (see pidesk_settings_list for the names and accepted values). ' +
      'Only change what the user asked for. Other settings (API keys, the terminal shell, folders, this switch itself) are not available here and are changed on the Settings page. ' +
      'Changes apply at once and are shared by every window.',
    promptSnippet: 'Change app settings (theme, pet, notifications, input prediction …)',
    parameters: Type.Object({
      action: StringEnum(['set'] as const),
      values: Type.Record(Type.String(), Type.Unknown(), { description: 'Setting name → new value, e.g. {"theme":"dark","pet":false}' }),
    }),
    annotations: { destructiveHint: true },
    async execute(_id, p) {
      const patch = checkAiSettingsPatch(p.values, host.petIds());
      host.save(patch);
      return text(`Changed ${Object.keys(patch).join(', ')}.\n${describe()}`, { settings: host.get() });
    },
  });
}

// ------------------------------------------------------------ artifacts

const ARTIFACT_STATE_LABEL = { draft: 'not published', published: 'published', outdated: 'published, newer version not uploaded' } as const;

function describeArtifact(a: ArtifactMeta) {
  const state = ARTIFACT_STATE_LABEL[publishState(a)];
  return `- ${a.id} · ${a.title} · v${a.version} · ${a.files.length} file(s) · ${state}${a.publishedUrl ? ` · ${a.publishedUrl}` : ''}`;
}

function registerArtifacts(pi: ExtensionAPI, host: ArtifactHost) {
  pi.registerTool({
    name: 'pidesk_artifact_list',
    label: 'Artifacts',
    description: 'List the saved artifacts (id, title, version, whether and where each is published) and whether publishing is set up.',
    parameters: Type.Object({}),
    annotations: { readOnlyHint: true },
    async execute() {
      const artifacts = host.list();
      const storage = host.storageReady() ? 'Publishing is set up.' : 'Publishing is NOT set up (the user configures a bucket in Settings → Storage); artifacts can still be previewed.';
      return text([storage, ...(artifacts.length ? artifacts.map(describeArtifact) : ['There are no artifacts.'])].join('\n'), { artifacts });
    },
  });

  pi.registerTool({
    name: 'pidesk_artifact_manage',
    label: 'Manage artifact',
    description:
      'An artifact is a web page (or small site) shown to the user in a preview window and, once published, at a link anyone can open. ' +
      'Build it as an ordinary file first (a self-contained .html with inline CSS and JS works best; external scripts only from a CDN), then: ' +
      'save needs path (the .html file, or a folder with an index.html; optional title) and creates an artifact, or id to save a new version of an existing one; ' +
      'publish / unpublish need id and upload / take down the copy in the user\'s own S3 bucket; delete needs id. ' +
      'Publishing only works when the user has configured a bucket in Settings → Storage, and it makes the page public: publish only when the user asked to share it. ' +
      'Saving does not need any setup, so save first and tell the user they can open it from the Artifacts page in the sidebar.',
    promptSnippet: 'Save web pages as artifacts the user can preview and publish',
    parameters: Type.Object({
      action: StringEnum(['save', 'publish', 'unpublish', 'delete'] as const),
      id: Type.Optional(Type.String({ description: 'Artifact id; for save it updates that artifact instead of creating one' })),
      path: Type.Optional(Type.String({ description: 'save: the .html file, or a folder that contains index.html' })),
      title: Type.Optional(Type.String({ description: 'save: the name shown to the user' })),
    }),
    annotations: { destructiveHint: true },
    async execute(_id, p) {
      const need = () => {
        if (!p.id) throw new Error(`${p.action} needs the artifact id (pidesk_artifact_list shows them)`);
        return p.id;
      };
      switch (p.action) {
        case 'save': {
          if (!p.path) throw new Error('save needs path');
          const a = host.save({ id: p.id, title: p.title, source: p.path });
          const next = host.storageReady() ? 'Publish it when the user wants a link.' : 'Publishing is not set up yet, so it is preview-only.';
          return text(`Saved artifact "${a.title}" (${a.id}) as version ${a.version}, ${a.files.length} file(s). The user can open it from the Artifacts page in the sidebar. ${next}`, { artifact: a });
        }
        case 'publish': {
          if (!host.storageReady()) throw new Error(STORAGE_NOT_CONFIGURED);
          const a = await host.publish(need());
          return text(`Published "${a.title}" (version ${a.version}): ${a.publishedUrl}`, { artifact: a });
        }
        case 'unpublish': {
          const a = await host.unpublish(need());
          return text(`Took "${a.title}" down from the bucket. The local artifact is kept.`, { artifact: a });
        }
        case 'delete':
          await host.remove(need());
          return text(`Deleted artifact ${p.id}.`);
      }
    },
  });
}

// ------------------------------------------------------------ work project

const size = (value: string | undefined, max: number) => `${value?.length ?? 0}/${max} characters`;

function describeProject(p: WorkProject) {
  const links = p.links ?? [];
  return [
    `Project "${p.name}" — ${p.path}`,
    `Description (${size(p.description, PROJECT_LIMITS.description)}): ${p.description?.trim() || '(empty)'}`,
    `Instructions (${size(p.instructions, PROJECT_LIMITS.instructions)}):\n${p.instructions?.trim() || '(empty)'}`,
    `Links (${links.length}/${PROJECT_LIMITS.links}):\n${links.length ? links.map((l) => `- ${l.title ? `${l.title}: ` : ''}${l.url}`).join('\n') : '(none)'}`,
    `Memory (${size(p.memory, PROJECT_LIMITS.memory)}; use pidesk_remember to change it):\n${p.memory?.trim() || '(empty)'}`,
  ].join('\n\n');
}

function registerProject(pi: ExtensionAPI, host: ProjectHost) {
  pi.registerTool({
    name: 'pidesk_project_manage',
    label: 'Work project',
    description:
      'Read or change the Work project this session runs in: the name, description, instructions (standing context every task in the project starts with) and reference links ' +
      'that the Projects page edits. show returns all of them; update changes only the fields you pass, "" clears the description or instructions, and links replaces the whole list ([] clears it). ' +
      `Limits: name ${PROJECT_LIMITS.name}, description ${PROJECT_LIMITS.description}, instructions ${PROJECT_LIMITS.instructions} characters, at most ${PROJECT_LIMITS.links} http(s) links. ` +
      'The memory is the model\'s own notes and is changed with pidesk_remember, not here. This cannot add, move or remove projects.',
    promptSnippet: 'Read or edit the current Work project (name, description, instructions, links)',
    parameters: Type.Object({
      action: StringEnum(['show', 'update'] as const),
      name: Type.Optional(Type.String({ description: `update: the name (up to ${PROJECT_LIMITS.name} characters, not empty)` })),
      description: Type.Optional(Type.String({ description: `update: what the project is for (up to ${PROJECT_LIMITS.description} characters); "" clears it` })),
      instructions: Type.Optional(Type.String({ description: `update: how tasks in the project should be done (up to ${PROJECT_LIMITS.instructions} characters); "" clears it` })),
      links: Type.Optional(Type.Array(
        Type.Object({ title: Type.Optional(Type.String({ description: 'Shown name' })), url: Type.String({ description: 'An http:// or https:// address' }) }),
        { description: `update: the complete list of reference links (at most ${PROJECT_LIMITS.links}); [] clears it` },
      )),
    }),
    async execute(_id, p) {
      if (p.action === 'show') {
        const project = host.get();
        return text(describeProject(project), { project });
      }
      const patch: ProjectEdit = {};
      if (p.name !== undefined) patch.name = p.name;
      if (p.description !== undefined) patch.description = p.description;
      if (p.instructions !== undefined) patch.instructions = p.instructions;
      if (p.links !== undefined) patch.links = p.links.map((l) => ({ title: l.title ?? '', url: l.url }));
      const project = host.update(patch);
      const changed = Object.keys(patch);
      return text(`Updated ${changed.join(', ')} of project "${project.name}".\n\n${describeProject(project)}`, { project, changed });
    },
  });
}

export function registerManageTools(pi: ExtensionAPI, host: { schedule?: ScheduleHost; customize?: CustomizeHost; pets?: PetHost; settings?: SettingsHost; artifacts?: ArtifactHost; project?: ProjectHost }) {
  if (host.schedule) registerSchedule(pi, host.schedule);
  if (host.customize) registerCustomize(pi, host.customize);
  if (host.pets) registerPets(pi, host.pets);
  if (host.settings) registerSettings(pi, host.settings);
  if (host.artifacts) registerArtifacts(pi, host.artifacts);
  if (host.project) registerProject(pi, host.project);
}
