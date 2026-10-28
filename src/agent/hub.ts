// Session hub: every desktop session is an in-process pi AgentSession (through an
// AgentSessionRuntime, so /clear and forks can replace it), plus the session
// metadata, worktrees, CLI-session import and naming around it.
import { tr } from '@shared/i18n/runtime';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createAgentSession, createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices,
  createCodemodeExtension, createMcpExtension, createToolSearchExtension, DefaultResourceLoader, estimateTokens,
  formatSkillsForPrompt, getAgentDir, getLatestCompactionEntry, hasTrustRequiringProjectResources, ModelRuntime, ProjectTrustStore, sessionEntryToContextMessages, SessionManager, SettingsManager,
  type AgentSession, type AgentSessionRuntime, type CreateAgentSessionRuntimeFactory, type ExtensionUIContext,
} from '@earendil-works/pi-coding-agent';
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { buildMessage, decodeUserContent } from '@shared/attachments';
import type {
  AgentDraft, AgentMessage, ConnectorDraft, SkillDraft, ChangeSet, ContextBreakdown, CreateSessionOptions, HostEvent, ImportableSession, ModelInfo, OpenSessionResult, OutputStyle, PermissionMode,
  PrStatus, PrSummary, SessionCleanup, SessionMeta, SessionRemoval, SessionStats, SetupStep, Settings, SideChat, SpawnTask, SubagentProgress, WorkIdea, SessionSummary, SlashCommand, StreamingBehavior, SuggestionOptions, ThinkingLevel, ToolOption, UiRequest, UiRequestInput, UiResponse,
} from '@shared/protocol';
import { MAX_SESSION_TITLE, SHELL_SESSION_MODES } from '@shared/protocol';
import { decodeCommandMessage, isCommandMessage } from '@shared/command-message';
import { decodePeerMessage,encodePeerMessage, isPeerMessage } from '@shared/peer-message';
import { decodePrEvent, encodePrEvent, isPrEvent } from '@shared/pr-event';
import { BUILTIN_PET_IDS } from '@shared/pets';
import { DEFAULT_SETTINGS } from '@shared/settings';
import { appAgentsDir, appPetsDir, appWorkDir, appExtensionsDir, worktreeDir as resolveWorktreeDir } from './app-paths';
import { validatePromptPayload } from './attachments';
import toolsPrompt from './tools-prompt.md?raw';
import workPrompt from './work-prompt.md?raw';
import { registerDemoModel } from './demo-model';
import { applyChildPath } from './env';
import * as customize from './customize';
import { agentCatalog, agentPrompt, loadAgents, removeAgent, saveAgent } from './agents';
import type { CustomizeHost, ScheduleHost, SettingsHost } from './manage-tools';
import { listPets, removePet, savePet } from './pets';
import { ArtifactService } from './artifacts';
import { ObjectStorage } from './storage';
import { WebSearch } from './web-search';
import { createDesktopKit, type KitHost, type KitState, type SubagentRun } from './desktop-kit';
import { toWireEvent } from './events';
import { readSessionFile, readSessionImage, resolveInside, searchSessionFiles } from './files';
import * as git from './git';
import { ModelAdmin } from './model-admin';
import { PrWatcher, type PrPending } from './pr-watch';
import * as naming from './naming';
import type { Scheduler } from './scheduler';
import { pickSideModel } from './side-model';
import { ActivityRecorder } from './activity';
import { Store } from './store';
import { ProjectBook } from './remote/workspace';
import { editProject, projectContext, remember } from './work-project';
import * as prediction from './suggest';
import * as sideChat from './side-chat';
import * as workIdeas from './work-ideas';

const NAMES = ['trusting-maxwell', 'eager-lovelace', 'quiet-hopper', 'brave-turing', 'calm-knuth', 'swift-ritchie', 'bold-curie', 'keen-dijkstra'];
/** Tools on top of pi's defaults (read, bash, edit, write). */
const EXTRA_TOOLS = ['+grep', '+find', '+ls'];
/** Store key: the user said no to importing Claude Code's skills. */
const CLAUDE_SKILLS_DECLINED = 'claudeSkillsDeclined';
/** Defaults minus editing; MCP and other extension tools stay (the plan-mode gate lets only read-only ones run). */
const SUBAGENT_TOOLS = ['-edit', '-write', '+grep', '+find', '+ls'];

interface PendingUi {
  request: UiRequest;
  done: (response: UiResponse, label: string) => void;
}

/** One open session. `runtime.session` changes on /clear and forks; everything else stays. */
interface Live {
  id: string;
  runtime: AgentSessionRuntime;
  kit: KitState;
  pending: Map<string, PendingUi>;
  unsubscribe?: () => void;
  status: 'idle' | 'running';
  /** Bumped on dispose: prompts still preparing must not reach a new session. */
  generation: number;
  historyBusy: boolean;
  disposed: boolean;
  /** Running `task` subagents by tool call id, so one can be stopped on its own. */
  tasks: Map<string, AbortController>;
}

/** Rough token count for text the SDK does not measure for us. */
const approxTokens = (text: string) => Math.ceil(text.length / 4);

/** What a subagent tool call shows in its transcript, and what it is doing meanwhile. */
function subagentStepLabel(name: string, args: any) {
  const a = args ?? {};
  switch (name) {
    case 'bash': return { label: String(a.command ?? ''), activity: 'Running a command' };
    case 'read': return { label: String(a.path ?? ''), activity: `Reading ${path.basename(String(a.path ?? 'a file'))}` };
    case 'grep': return { label: String(a.pattern ?? ''), activity: 'Searching' };
    case 'find': return { label: String(a.pattern ?? a.path ?? ''), activity: 'Finding files' };
    case 'ls': return { label: String(a.path ?? '.'), activity: 'Listing files' };
    default: return { label: name, activity: `Using ${name}` };
  }
}

export interface HubOptions {
  /** Pi Desktop's own data folder (`~/.pi-desktop` unless `PI_DESKTOP_HOME` is set). */
  dataDir: string;
  emit: (event: HostEvent) => void;
  /** pi's config directory (auth.json, models.json, settings, extensions). Default ~/.pi/agent. */
  agentDir?: string;
  /** Where CLI sessions are discovered for import. Default <agentDir>/sessions. */
  cliSessionsDir?: string;
  /** Register the offline demo model (dev and tests only; packaged builds leave it off). */
  demoModel?: boolean;
}


interface PrWatchEntry {
  watcher: PrWatcher;
  /** The PR this entry is watching: a different number means a different comment history. */
  num?: number;
  timer?: ReturnType<typeof setTimeout>;
  /** The `gh` call in flight: disposing has to wait for it, or Windows keeps the worktree locked. */
  read?: Promise<unknown>;
  /** A look is running; another request waits for it instead of reading the same snapshot twice. */
  busy?: boolean;
  again?: boolean;
}

/** Messages the latest compaction summarized away: still in the session entries, no longer in the model's context. */
export function compactedMessages(manager: SessionManager): AgentMessage[] {
  const branch = manager.getBranch();
  const latest = getLatestCompactionEntry(branch);
  if (!latest) return [];
  const at = branch.findIndex((entry) => entry.id === latest.id);
  const kept = branch.findIndex((entry) => entry.id === latest.firstKeptEntryId);
  // Everything before the kept tail, and never the summary itself: it is the card the transcript shows.
  const end = kept >= 0 && (at < 0 || kept < at) ? kept : at;
  if (end < 0) return [];
  // SAFETY: the protocol reads a subset of SDK messages; their content blocks are structured-cloneable.
  return branch.slice(0, end).flatMap((entry) => sessionEntryToContextMessages(entry)) as unknown as AgentMessage[];
}

export class SessionHub {
  readonly agentDir: string;
  models!: ModelRuntime;
  /** Accounts, API keys and custom endpoints; shares auth.json and models.json with pi. */
  admin!: ModelAdmin;
  /** Set by the host once it exists; it needs the hub, so the hub can't build it. */
  scheduler: Scheduler | null = null;
  private readonly store: Store;
  /** The Work projects, kept in the same store the app's Projects page edits. */
  private readonly projects: ProjectBook;
  /** What the user did each day; fed by the handlers, so tasks, peers and PR watches never count. */
  readonly activity: ActivityRecorder;
  /** The user's S3-compatible bucket, for everything the app keeps off this machine. */
  readonly storage: ObjectStorage;
  /** The model's web pages, which can be published to that bucket. */
  readonly artifacts: ArtifactService;
  /** The model's web search and page fetching, with the user's engine keys. */
  readonly web: WebSearch;
  private settings!: SettingsManager;
  private metas: SessionMeta[];
  private readonly live = new Map<string, Live>();
  private readonly opening = new Map<string, Promise<Live>>();
  private readonly trust: ProjectTrustStore;
  private namers = new Set<AbortController>();
  /** In-flight next-message predictions, so a new turn or a closed session can cancel them. */
  private suggesters = new Map<string, AbortController>();
  /** Side chats (/btw) by session, and their in-flight requests. */
  private sideChats = new Map<string, SideChat>();
  private sideRuns = new Map<string, AbortController>();
  /** Model catalog refreshes are serialized: a refresh reloads models.json, so two in flight can drop a provider. */
  private modelRefresh: Promise<unknown> = Promise.resolve();
  /**
   * One PR watcher per live Code session. GitHub is the event source: the bar reads its status,
   * and the session's switches decide which of its changes are worth a turn of their own.
   */
  private readonly prWatches = new Map<string, PrWatchEntry>();

  constructor(private readonly opts: HubOptions) {
    this.agentDir = opts.agentDir ?? getAgentDir();
    this.store = new Store(opts.dataDir);
    this.projects = new ProjectBook(this.store);
    this.activity = new ActivityRecorder(this.store);
    this.storage = new ObjectStorage(opts.dataDir);
    this.artifacts = new ArtifactService(opts.dataDir, this.storage);
    this.web = new WebSearch(opts.dataDir);
    this.metas = this.store.get<SessionMeta[]>('sessions', []);
    this.trust = new ProjectTrustStore(this.agentDir);
  }

  async init() {
    // Every tool spawns children with process.env, and pi resolves bash through PATH.
    applyChildPath();
    // Pi Desktop's own extension folder (distinct from pi's <agentDir>/extensions).
    fs.mkdirSync(appExtensionsDir(this.opts.dataDir), { recursive: true });
    fs.mkdirSync(appAgentsDir(this.opts.dataDir), { recursive: true });
    this.models = await ModelRuntime.create({
      authPath: path.join(this.agentDir, 'auth.json'),
      modelsPath: path.join(this.agentDir, 'models.json'),
      signal: AbortSignal.timeout(15_000),
    });
    if (this.opts.demoModel) registerDemoModel(this.models);
    this.settings = SettingsManager.create(os.homedir(), this.agentDir);
    this.admin = new ModelAdmin({
      agentDir: this.agentDir,
      dataDir: this.opts.dataDir,
      models: () => this.models,
      refresh: (options) => this.refreshModels(options),
      deviceId: () => this.settings.getOrCreateDeviceId(),
      emit: (event) => this.emit(event),
    });
    // Model catalogs refresh in the background, like pi's RPC mode.
    void this.refreshModels({ signal: AbortSignal.timeout(15_000) }).catch(() => {});
  }

  /** Queue a catalog refresh behind any other refresh (each one reloads models.json). */
  refreshModels(options: { allowNetwork?: boolean; providers?: string[]; signal?: AbortSignal } = {}) {
    const run = () => this.models.refresh(options);
    const next = this.modelRefresh.then(run, run);
    this.modelRefresh = next.catch(() => {});
    return next;
  }

  private emit(event: HostEvent) {
    this.opts.emit(event);
  }
  private save() {
    this.store.set('sessions', this.metas);
  }
  meta(id: string) {
    const m = this.metas.find((x) => x.id === id);
    if (!m) throw new Error(`Unknown session ${id}`);
    return m;
  }
  private emitMeta(m: SessionMeta) {
    this.emit({ type: 'meta', sessionId: m.id, meta: { ...m } });
  }
  /** The branch can be switched under the session (by the agent or in a terminal): follow it, so the bar and diff name the real one. */
  private async syncBranch(m: SessionMeta) {
    if (m.kind !== 'code' || !m.branch) return;
    const current = await git.currentBranch(m.cwd);
    if (!current || current === 'HEAD' || current === m.branch) return;
    m.branch = current;
    this.save();
    this.emitMeta(m);
  }
  /** A session made on the host's own initiative (a scheduled task run): tell the renderer it exists. */
  announce(m: SessionMeta) {
    this.emitMeta(m);
  }
  isRunning(id: string) {
    return this.live.get(id)?.status === 'running';
  }
  /** Every session, archived ones included: the UI decides what to show. */
  list(): SessionSummary[] {
    return this.metas.map((m) => ({ ...m, status: this.live.get(m.id)?.status ?? 'idle' }));
  }

  // ------------------------------------------------------------ models

  private modelInfo(m: any): ModelInfo {
    return { provider: m.provider, id: m.id, name: m.name, contextWindow: m.contextWindow, maxTokens: m.maxTokens, reasoning: m.reasoning, input: m.input, cost: m.cost };
  }
  private findModel(id: string | null | undefined) {
    if (!id) return undefined;
    const [provider, ...rest] = id.split('/');
    return this.models.getAvailableSnapshot().find((m) => m.provider === provider && m.id === rest.join('/')) ?? this.models.getModel(provider, rest.join('/'));
  }
  /** Models with working credentials (the availability check runs asynchronously). */
  async listModels() {
    const available = [...(await this.models.getAvailable())];
    // The offline demo model needs no credentials, so it never waits on availability checks.
    for (const m of this.models.getModels('demo')) if (!available.some((a) => a.provider === m.provider && a.id === m.id)) available.push(m);
    const models = available.map((m) => this.modelInfo(m));
    const settings = this.settings ?? SettingsManager.create(os.homedir(), this.agentDir);
    const provider = settings.getDefaultProvider(), model = settings.getDefaultModel();
    const fallback = models.find((m) => m.provider !== 'demo');
    const defaultModel = provider && model ? `${provider}/${model}` : fallback ? `${fallback.provider}/${fallback.id}` : null;
    return { models, defaultModel };
  }
  thinkingLevels(id: string | null): ThinkingLevel[] {
    const model = this.findModel(id);
    if (!model) return [];
    return getSupportedThinkingLevels(model) as ThinkingLevel[];
  }

  // ------------------------------------------------------------ lifecycle

  /** A title passed by the caller is a user choice, unless it is marked as a placeholder (`autoName`). */
  private titleState(title: string | undefined, autoName: boolean | undefined, fallback: string) {
    const custom = typeof title === 'string' && title.trim();
    return {
      title: custom || fallback,
      autoName: autoName === true || !custom,
      titleLocked: Boolean(custom) && autoName !== true,
      autoNamed: false,
      nameAttempted: false,
    };
  }

  async create(opts: CreateSessionOptions): Promise<SessionMeta> {
    const id = crypto.randomUUID();
    const slug = `${NAMES[Math.floor(Math.random() * NAMES.length)]}-${id.slice(0, 6)}`;
    const base = {
      id, model: opts.model ?? null, thinking: opts.thinking ?? null, mode: opts.mode || 'auto', outputStyle: opts.outputStyle || 'default',
      sessionFile: null, createdAt: Date.now(), updatedAt: Date.now(), pr: null,
      ...(opts.parentId ? { parentId: opts.parentId } : {}),
    } satisfies Partial<SessionMeta>;
    let meta: SessionMeta;
    if (opts.kind === 'work') {
      // Work tasks run directly in the chosen folder (or a fresh scratch workspace); no worktree, no diff base.
      let cwd = opts.projectPath;
      if (!cwd) {
        cwd = path.join(appWorkDir(this.opts.dataDir), `${new Date().toISOString().slice(0, 10)}-${slug}`);
        fs.mkdirSync(cwd, { recursive: true });
      }
      meta = {
        ...base, kind: 'work', ...this.titleState(opts.title, opts.autoName, 'New task'),
        projectPath: cwd, cwd, scratch: !opts.projectPath, branch: null, baseBranch: null, baseCommit: null, worktree: false,
      };
    } else {
      const projectPath = opts.projectPath;
      if (!projectPath) throw new Error('Choose a project first');
      const root = await git.repoRoot(projectPath);
      const headCommit = root ? await git.head(root) : null;
      let baseCommit = headCommit;
      let cwd = projectPath;
      let branch = root ? await git.currentBranch(root) : null;
      let baseBranch = branch;
      let external = false;
      let worktreeSetup: SessionMeta['worktreeSetup'];
      if (root && headCommit && opts.adoptPath) {
        // The user's own worktree: work in it as it is, and diff against where it left the main branch.
        if (!fs.existsSync(opts.adoptPath)) throw new Error(`The worktree no longer exists: ${opts.adoptPath}`);
        cwd = opts.adoptPath;
        branch = await git.currentBranch(cwd);
        baseCommit = (await git.mergeBase(cwd, headCommit)) ?? (await git.head(cwd)) ?? headCommit;
        external = true;
      } else if (root && headCommit && opts.worktree !== false) {
        branch = `claude/${slug}`;
        if (opts.baseRef) {
          const from = await git.resolveRef(root, opts.baseRef);
          if (!from) throw new Error(`Branch not found: ${opts.baseRef}`);
          baseCommit = from;
          baseBranch = opts.baseRef;
        }
        // The root is configurable in Settings; existing sessions keep their recorded cwd.
        cwd = path.join(this.worktreeRoot(), `${path.basename(root)}-${slug}`);
        // git is slow here: the first start makes the worktree, so creating the session returns at once.
        worktreeSetup = { root, base: baseCommit ?? headCommit };
      }
      meta = {
        ...base, kind: 'code', ...this.titleState(opts.title, opts.autoName, 'New session'),
        projectPath, cwd, branch, baseBranch, baseCommit, worktree: cwd !== projectPath,
        ...(external ? { external } : {}), ...(worktreeSetup ? { worktreeSetup } : {}),
      };
    }
    this.metas.unshift(meta);
    this.save();
    // Warm up in the background so the agent is ready by the time the first message is sent.
    void this.ensure(id).catch(() => {});
    return meta;
  }

  /** The live session for `id`, starting pi for it on first use. */
  private ensure(id: string): Promise<Live> {
    const existing = this.live.get(id);
    if (existing && !existing.disposed) return Promise.resolve(existing);
    let opening = this.opening.get(id);
    if (!opening) {
      opening = this.start(id).finally(() => this.opening.delete(id));
      this.opening.set(id, opening);
    }
    return opening;
  }

  /** Where new Code-session worktrees go: the setting, or `<dataDir>/.worktree`. */
  private worktreeRoot() {
    const settings = this.store.get<Partial<Settings>>('settings', {});
    return resolveWorktreeDir(this.opts.dataDir, settings.worktreeDir);
  }

  /** Getting a session ready is slow (worktree, extensions, MCP): report each stage so the UI can show it. */
  private async start(id: string): Promise<Live> {
    const m = this.meta(id);
    if (m.archived) throw new Error('This session is archived');
    const steps: SetupStep[] = [];
    if (m.worktreeSetup) steps.push({ id: 'worktree', label: tr('ag.stepWorktree', { branch: m.branch ?? '' }), state: 'running' });
    steps.push({ id: 'agent', label: tr('ag.stepAgent'), state: m.worktreeSetup ? 'pending' : 'running' });
    const send = () => this.emit({ type: 'setup', sessionId: id, steps: steps.map((x) => ({ ...x })) });
    const report = (stage: SetupStep['id'], state: SetupStep['state'], detail?: string) => {
      const step = steps.find((x) => x.id === stage);
      if (step) Object.assign(step, { state, detail });
      send();
    };
    send();
    try {
      if (m.worktreeSetup) {
        await this.createWorktree(m);
        report('worktree', 'done');
        report('agent', 'running');
      }
      const live = await this.startRuntime(id, m);
      this.emit({ type: 'setup', sessionId: id, steps: null });
      return live;
    } catch (err) {
      const stage = steps.find((x) => x.state === 'running');
      if (stage) report(stage.id, 'error', err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  private async createWorktree(m: SessionMeta) {
    const setup = m.worktreeSetup;
    if (!setup || !m.branch) return;
    // A folder with its own .git is a worktree an earlier, interrupted start already made.
    if (!fs.existsSync(path.join(m.cwd, '.git'))) await git.addWorktree(setup.root, m.cwd, m.branch, setup.base);
    delete m.worktreeSetup;
    this.save();
  }

  private async startRuntime(id: string, m: SessionMeta): Promise<Live> {
    if (!fs.existsSync(m.cwd)) throw new Error(`The session folder no longer exists: ${m.cwd}`);
    const live: Live = {
      id,
      // SAFETY: runtime is assigned immediately below before live is published or used.
      runtime: null as unknown as AgentSessionRuntime,
      kit: { mode: m.mode, profile: m.kind, outputStyle: m.outputStyle, allowed: new Set() },
      pending: new Map(), status: 'idle', generation: 0, historyBusy: false, disposed: false, tasks: new Map(),
    };
    const resumed = m.sessionFile && fs.existsSync(m.sessionFile);
    const sessionManager = resumed ? SessionManager.open(m.sessionFile!, undefined, m.cwd) : SessionManager.create(m.cwd);
    if (!resumed) sessionManager.appendSessionInfo(m.title);
    live.runtime = await createAgentSessionRuntime(this.factory(live), { cwd: m.cwd, agentDir: this.agentDir, sessionManager });
    live.runtime.setRebindSession(() => this.bind(live));
    await this.bind(live);
    this.live.set(id, live);
    // Archived or deleted while it was starting: do not leave an agent behind.
    if (m.archived || !this.metas.includes(m)) {
      await this.dispose(id);
      throw new Error('This session was closed while it was starting');
    }
    this.startPrWatch(id);
    return live;
  }

  /** Recreates cwd-bound services; runs for the first session and every replacement. */
  private factory(live: Live): CreateAgentSessionRuntimeFactory {
    return async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
      const m = this.meta(live.id);
      const projectTrusted = !hasTrustRequiringProjectResources(cwd) || this.trust.get(cwd) === true;
      const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted });
      const services = await createAgentSessionServices({
        cwd, agentDir, settingsManager, modelRuntime: this.models,
        resourceLoaderOptions: {
          extensionFactories: [
            createDesktopKit(this.kitHost(live)),
            createCodemodeExtension(),
            createToolSearchExtension(),
            createMcpExtension(),
          ],
          // Pi Desktop's own extensions; pi's <agentDir>/extensions still load as before.
          additionalExtensionPaths: [appExtensionsDir(this.opts.dataDir)],
          appendSystemPrompt: m.kind === 'work' ? [toolsPrompt, workPrompt] : [toolsPrompt],
        },
      });
      const created = await createAgentSessionFromServices({
        services, sessionManager, sessionStartEvent,
        model: this.findModel(m.model),
        thinkingLevel: m.thinking ?? undefined,
        tools: EXTRA_TOOLS,
      });
      return { ...created, services, diagnostics: services.diagnostics };
    };
  }

  private storedSettings(): Settings {
    return { ...DEFAULT_SETTINGS, ...this.store.get<Partial<Settings>>('settings', {}) };
  }

  private kitHost(live: Live): KitHost {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const hub = this;
    return {
      state: live.kit,
      cwd: this.meta(live.id).cwd,
      // Read for every command, so switching it on the Settings page applies without a new session.
      shellSession: () => {
        const mode = hub.storedSettings().shellSession;
        return SHELL_SESSION_MODES.includes(mode) ? mode : DEFAULT_SETTINGS.shellSession;
      },
      ask: (request, signal) => this.ask(live, request, signal),
      setMode: (mode) => this.applyMode(live.id, mode),
      runSubagent: (run) => this.runSubagent(live, run),
      rename: (title) => void this.update(live.id, { title }),
      peers: {
        list: () => this.peerList(live.id),
        read: (id, limit) => this.peerRead(live.id, id, limit),
        send: (id, text) => this.peerSend(live.id, id, text),
      },
      agents: () => loadAgents(appAgentsDir(this.opts.dataDir)),
      get schedule(): ScheduleHost | undefined {
        const scheduler = hub.scheduler;
        if (!scheduler || !hub.storedSettings().aiSchedule) return undefined;
        const m = hub.meta(live.id);
        return {
          list: () => scheduler.list(),
          save: (draft) => scheduler.save(draft),
          setEnabled: (id, enabled) => scheduler.setEnabled(id, enabled),
          remove: (id) => scheduler.remove(id),
          runNow: (id) => scheduler.runNow(id),
          defaults: { kind: m.kind, projectPath: m.scratch ? null : m.projectPath },
        };
      },
      get customize(): CustomizeHost | undefined {
        if (!hub.storedSettings().aiCustomize) return undefined;
        const project = hub.meta(live.id).projectPath;
        const c = hub.customize;
        return {
          list: () => c.list(project),
          createSkill: (draft) => c.createSkill(draft, project),
          setSkillDisabled: (file, disabled) => c.setSkillDisabled(file, disabled, project),
          saveConnector: (draft) => c.saveConnector(draft, project),
          setConnectorEnabled: (name, scope, enabled) => c.setConnectorEnabled(name, scope, enabled, project),
          removeConnector: (name, scope) => c.removeConnector(name, scope, project),
          installPlugin: (source, scope) => c.installPlugin(source, scope, project),
          removePlugin: (source, scope) => c.removePlugin(source, scope, project),
        };
      },
      web: this.web,
      pets: {
        list: () => listPets(appPetsDir(this.opts.dataDir)),
        save: (raw) => savePet(appPetsDir(this.opts.dataDir), raw),
        remove: (id) => removePet(appPetsDir(this.opts.dataDir), id),
      },
      get settings(): SettingsHost | undefined {
        if (!hub.storedSettings().aiSettings) return undefined;
        return {
          get: () => hub.storedSettings(),
          petIds: () => [...BUILTIN_PET_IDS, ...listPets(appPetsDir(hub.opts.dataDir)).map((p) => p.id)],
          // The main process watches this file and applies the change (theme, windows) like a click on the Settings page.
          save: (patch) => hub.store.set('settings', { ...hub.store.get<Partial<Settings>>('settings', {}), ...patch }),
        };
      },
      artifacts: {
        list: () => hub.artifacts.list(),
        save: (input) => hub.artifacts.save(input),
        publish: (id) => hub.artifacts.publish(id),
        unpublish: (id) => hub.artifacts.unpublish(id),
        remove: (id, unpublish) => hub.artifacts.remove(id, unpublish),
        storageReady: () => hub.storage.info().ready,
      },
      get project(): KitHost['project'] {
        const m = hub.meta(live.id);
        if (m.kind !== 'work' || m.scratch) return undefined;
        const dir = m.projectPath;
        const find = () => hub.projects.workFolders().find((p) => p.path === dir);
        const project: NonNullable<KitHost['project']> = {
          context: () => projectContext(find()),
          remember: (input) => remember(hub.projects, dir, input),
        };
        // What the Projects page edits, behind its switch under Settings → AI 工具.
        if (hub.storedSettings().aiProject) {
          project.manage = {
            get: () => {
              const found = find();
              if (!found) throw new Error('This folder is no longer a Work project, so there is nothing to show.');
              return found;
            },
            update: (patch) => editProject(hub.projects, dir, patch),
          };
        }
        return project;
      },
      taskUpdate: (update) => {
        if (!live.disposed) this.emit({ type: 'task', sessionId: live.id, update });
      },
      trackTask: (id, stop) => {
        live.tasks.set(id, stop);
        return () => void live.tasks.delete(id);
      },
    };
  }

  /** Subscribe to the current AgentSession and attach the desktop UI to its extensions. */
  private async bind(live: Live) {
    const session = live.runtime.session;
    live.unsubscribe?.();
    live.unsubscribe = session.subscribe((event) => this.onEvent(live, event));
    await session.bindExtensions({
      uiContext: this.uiContext(live),
      mode: 'rpc',
      commandContextActions: {
        waitForIdle: () => live.runtime.session.waitForIdle(),
        newSession: async (options) => live.runtime.newSession(options),
        fork: async (entryId, forkOptions) => ({ cancelled: (await live.runtime.fork(entryId, forkOptions)).cancelled }),
        navigateTree: async (targetId, options) => ({ cancelled: (await live.runtime.session.navigateTree(targetId, options)).cancelled }),
        switchSession: async (sessionPath, options) => live.runtime.switchSession(sessionPath, options),
        reload: async () => live.runtime.session.reload(),
      },
      shutdownHandler: () => {},
      onError: (err) => this.emit({ type: 'extension_error', sessionId: live.id, error: `${err.extensionPath}: ${err.error}` }),
    });
    const m = this.meta(live.id);
    if (session.sessionFile && m.sessionFile !== session.sessionFile) {
      m.sessionFile = session.sessionFile;
      this.save();
    }
  }

  private onEvent(live: Live, event: any) {
    const m = this.metas.find((x) => x.id === live.id);
    if (!m) return;
    if (event.type === 'agent_start') this.setStatus(live, 'running');
    if (event.type === 'agent_settled') {
      this.setStatus(live, 'idle');
      m.updatedAt = Date.now();
      this.save();
    }
    if (event.type === 'session_info_changed' && event.name && event.name !== m.title) {
      m.title = event.name;
      this.save();
      this.emitMeta(m);
    }
    // pi persists message_end after notifying listeners. Defer user messages so
    // the UI receives their durable entry IDs along with the delivery event.
    if (event.type === 'message_end' && event.message.role === 'user') {
      queueMicrotask(() => {
        if (live.disposed) return;
        const entry = live.runtime.session.sessionManager.getLeafEntry();
        const entryId = entry?.type === 'message' && entry.message === event.message ? entry.id : undefined;
        this.emit({ type: 'pi', sessionId: live.id, event: { ...event, message: { ...event.message, entryId } } });
      });
      return;
    }
    const wire = toWireEvent(event);
    if (wire) this.emit({ type: 'pi', sessionId: live.id, event: wire });
  }

  private setStatus(live: Live, status: 'idle' | 'running') {
    if (live.status === status) return;
    live.status = status;
    this.emit({ type: 'status', sessionId: live.id, status });
    // A turn may have pushed commits: look at the PR soon, and deliver anything that waited.
    if (status === 'idle') this.kickPrWatch(live.id, 2_000);
  }

  // ------------------------------------------------------------ interactive requests

  private ask(live: Live, request: UiRequestInput, signal?: AbortSignal): Promise<UiResponse> {
    if (live.disposed || signal?.aborted) return Promise.resolve({ cancelled: true });
    const id = crypto.randomUUID();
    const full = { ...request, id } as UiRequest;
    return new Promise((resolve) => {
      const onAbort = () => done({ cancelled: true }, 'cancelled');
      const done = (response: UiResponse, label: string) => {
        if (!live.pending.has(id)) return;
        live.pending.delete(id);
        signal?.removeEventListener('abort', onAbort);
        this.emit({ type: 'ui_resolved', sessionId: live.id, requestId: id, label });
        resolve(response);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      live.pending.set(id, { request: full, done });
      this.emit({ type: 'ui_request', sessionId: live.id, request: full });
    });
  }

  respond(id: string, requestId: string, response: UiResponse) {
    const pending = this.live.get(id)?.pending.get(requestId);
    if (!pending) return;
    const label = response.cancelled ? 'cancelled' : response.answers ? 'Answered' : response.value ?? (response.confirmed === undefined ? 'OK' : response.confirmed ? 'Yes' : 'No');
    pending.done(response, label);
  }

  private cancelPending(live: Live) {
    for (const p of [...live.pending.values()]) p.done({ cancelled: true }, 'cancelled');
  }

  /** What ctx.ui means for pi extensions inside the desktop: dialogs become transcript cards. */
  private uiContext(live: Live): ExtensionUIContext {
    // Extensions sometimes style text through ctx.ui.theme; plain text is right for the desktop.
    const theme = new Proxy({}, { get: (_t, prop) => (prop === 'name' ? 'pi-desktop' : (...args: unknown[]) => args[args.length - 1]) });
    const ui: Omit<Partial<ExtensionUIContext>, 'theme'> & { theme: unknown } = {
      theme,
      select: async (title, options, opts) => (await this.ask(live, { kind: 'select', title, options }, opts?.signal)).value,
      confirm: async (title, message, opts) => !!(await this.ask(live, { kind: 'confirm', title, message }, opts?.signal)).confirmed,
      input: async (title, placeholder, opts) => {
        const r = await this.ask(live, { kind: 'input', title, placeholder }, opts?.signal);
        return r.cancelled ? undefined : r.value;
      },
      editor: async (title, prefill) => {
        const r = await this.ask(live, { kind: 'editor', title, prefill });
        return r.cancelled ? undefined : r.value;
      },
      notify: (message, type) => this.emit({ type: 'notify', sessionId: live.id, message, level: type ?? 'info' }),
      onTerminalInput: () => () => {},
      setStatus: () => {},
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setWidget: () => {},
      setFooter: () => {},
      setHeader: () => {},
      setTitle: () => {},
      custom: async () => undefined as never,
      pasteToEditor: (text) => this.emit({ type: 'editor_text', sessionId: live.id, text }),
      setEditorText: (text) => this.emit({ type: 'editor_text', sessionId: live.id, text }),
      getEditorText: () => '',
      addAutocompleteProvider: () => {},
      setEditorComponent: () => {},
      getEditorComponent: () => undefined,
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: 'Themes are not supported in Pi Desktop' }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
    };
    // SAFETY: RPC implements the supported UI callbacks above; TUI-only callbacks are inert.
    return ui as unknown as ExtensionUIContext;
  }

  // ------------------------------------------------------------ subagent

  /** Suggestions for an agent's tool allowlist. */
  toolOptions(): ToolOption[] {
    const tools = new Map<string, string>([
      ['read', tr('ag.toolRead')], ['grep', tr('ag.toolGrep')], ['find', tr('ag.toolFind')], ['ls', tr('ag.toolLs')],
      [process.platform === 'win32' ? 'powershell' : 'bash', tr('ag.toolShell')],
    ]);
    for (const live of this.live.values()) {
      for (const t of live.runtime.session.getAllTools()) {
        if (!t.name.startsWith('pidesk_')) tools.set(t.name, tools.get(t.name) || (t.description ?? '').split('\n')[0].slice(0, 120));
      }
    }
    return [...tools].map(([name, description]) => ({ name, description }));
  }
  agentCatalog() { return agentCatalog(appAgentsDir(this.opts.dataDir)); }
  saveAgent(draft: AgentDraft) { return saveAgent(appAgentsDir(this.opts.dataDir), draft); }
  removeAgent(name: string) { return removeAgent(appAgentsDir(this.opts.dataDir), name); }

  /** Where the Customize page reads and writes: pi's agent dir plus the selected project. */
  customizeEnv(project: string | null): customize.CustomizeEnv {
    const dir = project && fs.existsSync(project) ? project : null;
    return {
      agentDir: this.agentDir, project: dir, projectTrusted: !!dir && (!hasTrustRequiringProjectResources(dir) || this.trust.get(dir) === true),
      claudeSkillsDeclined: this.store.get<boolean>(CLAUDE_SKILLS_DECLINED, false),
    };
  }
  customize = {
    list: (project: string | null) => customize.catalog(this.customizeEnv(project)),
    importClaudeSkills: (project: string | null) => customize.importClaudeSkills(this.customizeEnv(project)),
    dismissClaudeSkills: (project: string | null) => {
      this.store.set(CLAUDE_SKILLS_DECLINED, true);
      return customize.catalog(this.customizeEnv(project));
    },
    setSkillDisabled: (file: string, disabled: boolean, project: string | null) => customize.setSkillDisabled(this.customizeEnv(project), file, disabled),
    createSkill: (draft: SkillDraft, project: string | null) => customize.createSkill(this.customizeEnv(project), draft),
    saveConnector: (draft: ConnectorDraft, project: string | null) => customize.saveConnector(this.customizeEnv(project), draft),
    setConnectorEnabled: (name: string, scope: 'user' | 'project', enabled: boolean, project: string | null) => customize.setConnectorEnabled(this.customizeEnv(project), name, scope, enabled),
    removeConnector: (name: string, scope: 'user' | 'project', project: string | null) => customize.removeConnector(this.customizeEnv(project), name, scope),
    installPlugin: (source: string, scope: 'user' | 'project', project: string | null) => customize.installPlugin(this.customizeEnv(project), source, scope),
    removePlugin: (source: string, scope: 'user' | 'project', project: string | null) => customize.removePlugin(this.customizeEnv(project), source, scope),
    updatePlugins: (source: string | null, project: string | null) => customize.updatePlugins(this.customizeEnv(project), source),
  };

  /** A read-only, in-memory session with a fresh context (desktop-kit's `task` tool). */
  private async runSubagent(live: Live, run: SubagentRun) {
    const cwd = run.ctx.cwd;
    const stats = { commands: 0, reads: 0, searches: 0, failed: 0 };
    const progress: SubagentProgress = { startedAt: Date.now(), tokens: 0, toolUses: 0, activity: 'Starting', steps: [] };
    const report = () => run.onProgress({ ...stats }, { ...progress, steps: progress.steps.slice(-200) });
    // Stopped with the whole turn (run.signal) or on its own from the Background tasks panel.
    const stop = new AbortController();
    live.tasks.set(run.id, stop);
    const onAbort = () => stop.abort();
    run.signal?.addEventListener('abort', onAbort, { once: true });
    let text = '';
    try {
      const agents = loadAgents(appAgentsDir(this.opts.dataDir));
      const agent = agents.find((a) => a.name === run.agent) ?? agents[0];
      const kit: KitState = { mode: 'plan', profile: live.kit.profile, outputStyle: 'default', allowed: new Set() };
      const settingsManager = SettingsManager.create(cwd, this.agentDir, { projectTrusted: !hasTrustRequiringProjectResources(cwd) || this.trust.get(cwd) === true });
      const resourceLoader = new DefaultResourceLoader({
        cwd, agentDir: this.agentDir, settingsManager,
        // Questions and permission prompts surface in the parent session's transcript and the subagent
        // waits for the user. Plan approval has no meaning here (a subagent's mode never changes).
        extensionFactories: [
          createDesktopKit({
            state: kit,
            ask: async (request, signal) => (request.kind === 'plan' ? { cancelled: true } : this.ask(live, request, signal)),
            setMode: () => {},
          }),
          createToolSearchExtension(),
          createMcpExtension(),
        ],
        appendSystemPrompt: [agentPrompt(agent)],
      });
      await resourceLoader.reload();
      const { session } = await createAgentSession({
        cwd, agentDir: this.agentDir, modelRuntime: this.models, model: (agent.model && this.findModel(agent.model)) || run.ctx.model, resourceLoader, settingsManager,
        sessionManager: SessionManager.inMemory(cwd), tools: agent.tools ?? SUBAGENT_TOOLS,
      });
      const abortSession = () => void session.abort();
      stop.signal.addEventListener('abort', abortSession, { once: true });
      try {
        await session.bindExtensions({});
        session.subscribe((event: any) => {
          if (event.type === 'tool_execution_start') {
            const { label, activity } = subagentStepLabel(event.toolName, event.args);
            progress.toolUses++;
            progress.activity = activity;
            progress.steps.push({ kind: 'tool', id: event.toolCallId, name: event.toolName, label, status: 'running' });
            report();
          }
          if (event.type === 'tool_execution_end') {
            if (event.toolName === 'bash') stats.commands++;
            else if (event.toolName === 'read') stats.reads++;
            else stats.searches++;
            if (event.isError) stats.failed++;
            const step = progress.steps.find((x) => x.kind === 'tool' && x.id === event.toolCallId);
            if (step?.kind === 'tool') step.status = event.isError ? 'err' : 'done';
            progress.activity = 'Thinking';
            report();
          }
          if (event.type === 'message_end' && event.message?.role === 'assistant') {
            progress.tokens += Number(event.message.usage?.output) || 0;
            const t = (event.message.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
            if (t) {
              text = t;
              progress.steps.push({ kind: 'text', text: t.length > 4000 ? `${t.slice(0, 4000)}…` : t });
            }
            report();
          }
        });
        if (!stop.signal.aborted) await session.prompt(run.prompt);
      } finally {
        stop.signal.removeEventListener('abort', abortSession);
        session.dispose();
      }
    } finally {
      run.signal?.removeEventListener('abort', onAbort);
      live.tasks.delete(run.id);
    }
    progress.endedAt = Date.now();
    progress.activity = stop.signal.aborted ? 'Stopped' : 'Done';
    report();
    if (stop.signal.aborted && !run.signal?.aborted) throw new Error('The user stopped this subagent from the Background tasks panel.');
    return text;
  }

  /** Stop one running subagent; the parent turn carries on with an error result. */
  stopTask(id: string, toolCallId: string) {
    const task = this.live.get(id)?.tasks.get(toolCallId);
    task?.abort();
    return !!task;
  }

  // ------------------------------------------------------------ open / prompt

  async open(id: string): Promise<OpenSessionResult> {
    const live = await this.ensure(id);
    const session = live.runtime.session;
    return {
      meta: { ...this.meta(id) },
      messages: this.messagesWithIds(session),
      model: session.model ? `${session.model.provider}/${session.model.id}` : null,
      thinking: session.thinkingLevel as ThinkingLevel,
      levels: session.getAvailableThinkingLevels() as ThinkingLevel[],
      isStreaming: session.isStreaming,
      isCompacting: session.isCompacting,
      hiddenMessages: this.compactedMessages(session).length,
      stats: this.statsOf(session),
      pending: [...live.pending.values()].map((p) => p.request),
    };
  }

  /** The messages the latest compaction summarized away: still in the session file, no longer in the model's context. */
  private compactedMessages(session: AgentSession): AgentMessage[] {
    return compactedMessages(session.sessionManager);
  }

  private messagesWithIds(session: AgentSession) {
    const ids = new Map<number, string[]>();
    for (const projected of session.sessionManager.buildSessionProjection().entries) {
      if (projected.sourceEntry.type !== 'message' || projected.sourceEntry.message.role !== 'user') continue;
      for (const message of projected.messages) {
        if (message.role !== 'user') continue;
        const list = ids.get(message.timestamp) ?? [];
        list.push(projected.sourceEntry.id);
        ids.set(message.timestamp, list);
      }
    }
    // SAFETY: the wire contract reads a subset of SDK messages; their content
    // blocks are structured-cloneable despite SDK interfaces lacking index signatures.
    return session.messages.map((message) => message.role === 'user'
      ? { ...message, entryId: ids.get(message.timestamp)?.shift() }
      : message) as unknown as OpenSessionResult['messages'];
  }

  async messageAction(id: string, entryId: string, action: 'rewind' | 'fork') {
    if (action !== 'rewind' && action !== 'fork') throw new Error('Unknown history action');
    const live = await this.ensure(id);
    const session = live.runtime.session;
    if (live.historyBusy || live.status === 'running' || !session.isIdle || live.tasks.size) {
      throw new Error(tr('ag.waitTask'));
    }
    const projected = session.sessionManager.buildSessionProjection().entries.find((item) => item.sourceEntry.id === entryId);
    const entry = projected?.sourceEntry;
    const message = projected?.messages.find((item) => item.role === 'user');
    if (entry?.type !== 'message' || entry.message.role !== 'user' || !message) throw new Error(tr('ag.messageGone'));
    const draft = decodeUserContent(message.content);
    live.historyBusy = true;
    live.generation++;
    try {
      if (action === 'rewind') {
        const result = await session.navigateTree(entryId, { summarize: false });
        if (result.cancelled) throw new Error(tr('ag.rewindCancelled'));
        // Branch navigation alone only changes memory. A state-only entry makes
        // the new leaf survive reopening, even before another prompt is sent.
        session.sessionManager.appendCustomEntry('pi-desktop-rewind', { entryId });
        this.meta(id).updatedAt = Date.now();
        this.save();
        return { session: await this.open(id), draft };
      }
      const original = this.meta(id);
      const sourceFile = session.sessionFile;
      if (!sourceFile || !fs.existsSync(sourceFile)) throw new Error(tr('ag.waitSaved'));
      const manager = SessionManager.open(sourceFile, undefined, original.cwd);
      if (entry.parentId) manager.createBranchedSession(entry.parentId);
      else manager.newSession({ parentSession: sourceFile });
      const meta: SessionMeta = {
        ...original, id: crypto.randomUUID(), title: tr('ag.branchSuffix', { title: original.title }),
        autoName: false, titleLocked: true, autoNamed: false, nameAttempted: true,
        sessionFile: manager.getSessionFile() ?? null, createdAt: Date.now(), updatedAt: Date.now(),
      };
      manager.appendSessionInfo(meta.title);
      this.metas.unshift(meta);
      this.save();
      this.emitMeta(meta);
      return { session: await this.open(meta.id), draft };
    } finally {
      live.historyBusy = false;
    }
  }

  async prompt(id: string, payload: unknown, behavior: StreamingBehavior): Promise<{ disposition: string }> {
    const live = await this.ensure(id);
    // The ghost text predicted the previous turn; a real message makes it stale.
    this.abortSuggestion(id);
    if (live.historyBusy) throw new Error(tr('ag.historyBusy'));
    const generation = live.generation;
    const normalized = await validatePromptPayload(payload);
    const { message, images } = buildMessage(normalized);
    // Image checks yield; never submit an old, in-flight message to a session that has since ended.
    if (live.disposed || live.generation !== generation) throw new Error('The session closed while preparing this message. The draft has been retained; check history before retrying.');
    const session = live.runtime.session;
    if (images.length && !session.model?.input?.includes('image')) {
      throw new Error('The selected model does not support image attachments. Choose an image-capable model or remove the images.');
    }
    const m = this.meta(id);
    m.updatedAt = Date.now();
    this.save();
    this.maybeNameFromPrompt(id, message);
    this.kickPrWatch(id, 1_000);
    const busy = session.isStreaming || live.status === 'running';
    // follow_up queues while streaming, but does not start an idle agent.
    if (busy && behavior === 'followUp') return { disposition: await session.followUp(message, images) };
    return new Promise((resolve, reject) => {
      let accepted = false;
      session
        .prompt(message, {
          images,
          streamingBehavior: busy && !message.startsWith('/') ? behavior || 'steer' : undefined,
          source: 'rpc',
          preflightResult: (disposition) => {
            accepted = true;
            resolve({ disposition });
          },
        })
        .then(() => { if (!accepted) resolve({ disposition: 'handled' }); })
        .catch((err: Error) => {
          if (!accepted) reject(err);
          else this.emit({ type: 'notify', sessionId: id, message: err.message, level: 'error' });
        });
    });
  }

  /**
   * First real user message: show it as the title immediately, then let a cheap
   * side model produce a better one. Both happen at most once per session.
   */
  private maybeNameFromPrompt(id: string, message: string) {
    const m = this.meta(id);
    const text = message.trim();
    if (!m.autoName || m.titleLocked || m.nameAttempted || !text || text.startsWith('/') || isPeerMessage(text) || isPrEvent(text) || isCommandMessage(text)) return;
    const placeholder = naming.titleFromPrompt(text);
    if (!placeholder) return;
    m.nameAttempted = true;
    this.save();
    this.setTitle(id, placeholder);
    void this.nameSession(id, text).catch((err) => console.warn('[naming] nameSession threw:', err));
  }

  /** Names the session with the session's own model: one tool-less request, outside the conversation. */
  private async nameSession(id: string, prompt: string) {
    const m = this.meta(id);
    if (!m.autoName || m.titleLocked || m.autoNamed) return;
    const session = this.live.get(id)?.runtime.session;
    const current = session?.model ? `${session.model.provider}/${session.model.id}` : m.model;
    const model = this.findModel(current);
    if (!model || model.provider === 'demo') return; // demo/offline: there is no real model to ask
    const label = `${model.provider}/${model.id}`;
    const controller = new AbortController();
    this.namers.add(controller);
    const timer = setTimeout(() => controller.abort(), naming.TIMEOUT_MS);
    let raw = '';
    try {
      const reply = await this.models.completeSimple(model, {
        systemPrompt: naming.SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt.slice(0, 2000), timestamp: Date.now() }],
        // Room for a reasoning model to think before it writes the title.
      }, { signal: controller.signal, maxTokens: 512, sessionId: id });
      if (reply.stopReason === 'error' || reply.stopReason === 'aborted') {
        console.warn(`[naming] ${label} failed: ${(reply as any).errorMessage ?? reply.stopReason}`);
        return;
      }
      raw = reply.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
    } finally {
      clearTimeout(timer);
      this.namers.delete(controller);
    }
    const title = naming.cleanTitle(raw);
    if (!title) {
      console.warn(`[naming] ${label} gave no usable title: ${JSON.stringify(raw)}`);
      return;
    }
    const now = this.meta(id);
    // A rename that landed while the model was thinking wins.
    if (now.titleLocked || !now.autoName || now.autoNamed || now.archived) return;
    now.autoNamed = true;
    this.save();
    this.setTitle(id, title);
  }

  // ------------------------------------------------------------ work ideas

  /**
   * Ideas for the Work welcome screen, drawn from the titles of the recent Work sessions.
   * The answer is kept until those sessions change, so reopening the screen costs nothing.
   * Null when there is nothing to go on or no model answered: the screen shows its fixed ideas.
   */
  async workIdeas(): Promise<WorkIdea[] | null> {
    const settings = this.storedSettings();
    if (!settings.workIdeas) return null;
    const recent = this.metas
      .filter((m) => m.kind === 'work' && !m.archived && !m.autoName)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, workIdeas.RECENT_SESSIONS);
    if (!recent.length) return null;
    const key = recent.map((m) => `${m.id}:${m.title}`).join('\n');
    const cached = this.store.get<{ key: string; ideas: WorkIdea[] } | null>('workIdeas', null);
    if (cached?.key === key) return cached.ideas;
    const model = await this.workIdeasModel(settings, recent[0].model);
    if (!model || model.provider === 'demo') return null;
    const controller = new AbortController();
    this.namers.add(controller);
    const timer = setTimeout(() => controller.abort(), workIdeas.TIMEOUT_MS);
    try {
      const reply = await this.models.completeSimple(model, {
        systemPrompt: workIdeas.SYSTEM_PROMPT,
        messages: [{ role: 'user', content: workIdeas.titlesText(recent.map((m) => m.title)), timestamp: Date.now() }],
      }, { signal: controller.signal, maxTokens: 1024 });
      if (reply.stopReason === 'error' || reply.stopReason === 'aborted') return null;
      const ideas = workIdeas.parseIdeas(prediction.contentText(reply.content));
      if (ideas) this.store.set('workIdeas', { key, ideas });
      return ideas;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      this.namers.delete(controller);
    }
  }

  /** The model that writes the ideas, per the setting; a choice that cannot answer falls back to the cheap automatic one. */
  private async workIdeasModel(settings: Settings, current: string | null | undefined) {
    const requested = settings.workIdeasModel === 'fixed' ? settings.workIdeasModelId : settings.workIdeasModel === 'session' ? current : null;
    const model = this.findModel(requested);
    if (model && model.provider !== 'demo' && this.isAvailable(model)) return model;
    return this.autoSideModel(current);
  }

  // ------------------------------------------------------------ next-message prediction

  private abortSuggestion(id: string) {
    this.suggesters.get(id)?.abort();
    this.suggesters.delete(id);
  }

  /** The live session only if it can answer right now (not closed, not mid-turn). */
  private idleLive(id: string) {
    const live = this.live.get(id);
    if (!live || live.disposed || live.status === 'running' || live.runtime.session.isStreaming) return null;
    return live;
  }

  /**
   * The cheapest real model already known to have credentials. The availability
   * snapshot is refreshed for the model pickers, so this does not re-run provider
   * auth checks on every turn. The offline demo model never predicts.
   */
  private autoSideModel(current: string | null | undefined) {
    const available = this.models.getAvailableSnapshot();
    const pick = pickSideModel(available, current);
    const fallback = available.length === 0 && current && !current.startsWith('demo/') ? current : null;
    return this.findModel(pick ?? fallback);
  }

  private isAvailable(model: { provider: string; id: string }) {
    const available = this.models.getAvailableSnapshot();
    // An empty snapshot means the availability check has not run yet: do not block
    // the configured model just because nobody has looked.
    return available.length === 0 || available.some((m) => m.provider === model.provider && m.id === model.id);
  }

  /** The prediction model: configured mode first, then the cheap automatic choice. */
  private sideModel(current: string | null | undefined, options?: SuggestionOptions) {
    const mode = options?.model;
    const requested = mode === 'session' ? current : mode === 'fixed' ? options?.modelId : null;
    if (requested) {
      const model = this.findModel(requested);
      // A fixed model also needs credentials; the session's own model is already running.
      if (model && model.provider !== 'demo' && (mode === 'session' || this.isAvailable(model))) return model;
    }
    return this.autoSideModel(current);
  }

  /**
   * Guess the user's next message with one cheap, tool-less request. It never
   * touches the session: no prompt, no tools, no context mutation. Every failure
   * is silent — the composer just keeps no ghost text.
   */
  async suggest(id: string, options?: SuggestionOptions): Promise<{ text: string } | null> {
    // Any prediction from before this call is stale, whether or not the turn can ask now.
    this.abortSuggestion(id);
    const live = this.idleLive(id);
    if (!live) return null;
    const session = live.runtime.session;
    const current = session.model ? `${session.model.provider}/${session.model.id}` : this.meta(id).model;
    const side = this.sideModel(current, options);
    // The cheap model comes first; if it fails or says nothing, the session's own model gets a turn.
    const own = current ? this.findModel(current) : null;
    const candidates = [side, own && own.provider !== 'demo' && own !== side ? own : null].filter((m): m is NonNullable<typeof side> => !!m);
    if (!candidates.length) return null;
    const generation = live.generation;
    for (const model of candidates) {
      const excerpt = prediction.transcriptExcerpt(session.messages, { context: options?.context, contextWindow: model.contextWindow });
      if (!excerpt) return null;
      const controller = new AbortController();
      this.suggesters.set(id, controller);
      const timeout = options?.context === 'all' ? prediction.FULL_TIMEOUT_MS : prediction.TIMEOUT_MS;
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const reply = await this.models.completeSimple(model, {
          systemPrompt: prediction.SYSTEM_PROMPT,
          messages: [{ role: 'user', content: excerpt.text, timestamp: Date.now() }],
        }, { signal: controller.signal, maxTokens: 256, sessionId: id });
        // A new turn, a replaced session or a closed one makes the reply stale.
        const now = this.live.get(id);
        if (!now || now !== live || now.disposed || now.generation !== generation) return null;
        if (now.status === 'running' || now.runtime.session.isStreaming) return null;
        if (controller.signal.aborted && this.suggesters.get(id) !== controller) return null; // superseded
        if (reply.stopReason === 'error' || reply.stopReason === 'aborted') continue;
        const text = prediction.cleanSuggestion(prediction.contentText(reply.content), excerpt.lastAssistant);
        if (text) return { text };
      } catch {
        // fall through to the next candidate
      } finally {
        clearTimeout(timer);
        if (this.suggesters.get(id) === controller) this.suggesters.delete(id);
      }
      if (this.live.get(id) !== live || live.disposed) return null;
    }
    // Every model failed: a generic nudge in the user's language still beats an empty composer.
    return { text: prediction.fallbackSuggestion(session.messages) };
  }

  // ------------------------------------------------------------ side chat (/btw)

  private sideState(id: string): SideChat {
    let chat = this.sideChats.get(id);
    if (!chat) this.sideChats.set(id, (chat = { sessionId: id, title: this.meta(id).title, turns: [], busy: false, quote: null }));
    chat.title = this.meta(id).title;
    return chat;
  }
  private emitSide(chat: SideChat) {
    this.emit({ type: 'side', sessionId: chat.sessionId, chat: { ...chat, turns: chat.turns.slice() } });
  }
  sideGet(id: string): SideChat {
    const chat = this.sideState(id);
    return { ...chat, turns: chat.turns.slice() };
  }
  sideStage(id: string, quote: string | null) {
    const chat = this.sideState(id);
    chat.quote = quote?.trim() ? quote.trim().slice(0, 20_000) : null;
    this.emitSide(chat);
  }
  sideAbort(id: string) {
    this.sideRuns.get(id)?.abort();
    this.sideRuns.delete(id);
  }
  sideReset(id: string) {
    this.sideAbort(id);
    this.sideChats.set(id, { sessionId: id, title: this.meta(id).title, turns: [], busy: false, quote: null });
    this.emitSide(this.sideState(id));
  }

  /**
   * Ask the side chat of a session. The question joins the host-held thread and this
   * returns at once: the answer follows as another `side` event, so the sender is never
   * held open while the model thinks. The request carries a fresh transcript snapshot and
   * no tools; the session is never prompted, so this works mid-turn and leaves its context
   * alone. Failures land in the thread's `error`.
   */
  side(id: string, input: { text: string; quote?: string }): void {
    const chat = this.sideState(id);
    const text = String(input?.text ?? '').trim();
    const quote = (input?.quote ?? chat.quote)?.trim() || undefined;
    if (!text) throw new Error('Ask a question first');
    if (chat.busy) throw new Error('Wait for the answer first');
    chat.turns.push({ role: 'user', text, ...(quote ? { quote: quote.slice(0, 20_000) } : {}) });
    chat.quote = null;
    chat.busy = true;
    chat.error = undefined;
    this.emitSide(chat);
    const controller = new AbortController();
    this.sideRuns.set(id, controller);
    void this.answerSide(id, chat, controller).catch((err) => console.warn('[side] answerSide threw:', err));
  }

  /** The request behind one side question, from the model call to the `side` event that ends it. */
  private async answerSide(id: string, chat: SideChat, controller: AbortController) {
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, sideChat.SIDE_TIMEOUT_MS);
    try {
      const live = this.live.get(id);
      if (!live || live.disposed) throw new Error('Open the session before starting a side chat');
      const session = live.runtime.session;
      const current = session.model ? `${session.model.provider}/${session.model.id}` : this.meta(id).model;
      const model = (current ? this.findModel(current) : null) ?? this.autoSideModel(current);
      if (!model) throw new Error('No model is available for a side chat');
      const messages = sideChat.sideMessages(sideChat.sideTranscript(session.messages, { contextWindow: model.contextWindow }), chat.turns);
      if (!messages) throw new Error('Ask a question first');
      const reply = await this.models.completeSimple(model, { systemPrompt: sideChat.SIDE_SYSTEM_PROMPT, messages }, { signal: controller.signal, maxTokens: 4096, sessionId: id });
      if (this.sideChats.get(id) !== chat) return; // reset while waiting
      if (reply.stopReason === 'aborted') throw new Error(timedOut ? 'The side chat timed out' : 'Cancelled');
      if (reply.stopReason === 'error') throw new Error(reply.errorMessage || 'The model returned an error');
      const answer = prediction.contentText(reply.content).trim();
      if (!answer) throw new Error('The model returned no text');
      chat.turns.push({ role: 'assistant', text: answer });
    } catch (err) {
      if (this.sideChats.get(id) === chat) chat.error = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
      if (this.sideRuns.get(id) === controller) this.sideRuns.delete(id);
      if (this.sideChats.get(id) === chat) {
        chat.busy = false;
        this.emitSide(chat);
      }
    }
  }

  /** Persist a title, tell pi (it records session_info) and tell the UI. */
  private setTitle(id: string, title: string) {
    const m = this.meta(id);
    if (!title || m.title === title) return;
    m.title = title;
    this.save();
    this.live.get(id)?.runtime.session.setSessionName(title);
    this.emitMeta(m);
  }

  // ------------------------------------------------------------ session settings

  private applyMode(id: string, mode: PermissionMode) {
    const m = this.meta(id);
    const live = this.live.get(id);
    if (live) live.kit.mode = mode;
    if (m.mode === mode) return;
    m.mode = mode;
    this.save();
    this.emitMeta(m);
  }
  setMode(id: string, mode: PermissionMode) {
    this.applyMode(id, mode);
  }
  setStyle(id: string, style: OutputStyle) {
    const m = this.meta(id);
    const live = this.live.get(id);
    if (live) live.kit.outputStyle = style;
    m.outputStyle = style;
    this.save();
    this.emitMeta(m);
  }

  update(id: string, patch: { title?: string; pr?: PrSummary | null; suggestion?: { key: string; state: 'here' | 'dismissed' }; prAuto?: { fixCi?: boolean; merge?: boolean; fixDone?: string; mergeDone?: number } }) {
    const m = this.meta(id);
    if (patch.pr !== undefined) m.pr = patch.pr;
    if (patch.prAuto) {
      const a = patch.prAuto;
      if (a.fixCi !== undefined) m.autoFixCi = a.fixCi;
      if (a.merge !== undefined) m.autoMerge = a.merge;
      if (a.fixDone || a.mergeDone) {
        m.prAutoDone = { ...m.prAutoDone, ...(a.fixDone ? { fix: a.fixDone } : {}), ...(a.mergeDone ? { merge: a.mergeDone } : {}) };
      }
    }
    if (patch.suggestion) m.suggestions = { ...m.suggestions, [patch.suggestion.key]: { state: patch.suggestion.state } };
    if (patch.prAuto || patch.pr !== undefined) this.kickPrWatch(id, 0);
    if (patch.title?.trim()) {
      // A title set by the user is final: stop the placeholder/auto-naming path.
      Object.assign(m, { title: patch.title.trim().slice(0, MAX_SESSION_TITLE), titleLocked: true, autoName: false });
      this.live.get(id)?.runtime.session.setSessionName(m.title);
    }
    this.save();
    this.emitMeta(m);
    return { ...m };
  }

  /** Closes the agent but keeps everything on disk (worktree included), so unarchiving restores the session as it was. */
  async archive(id: string) {
    await this.dispose(id);
    const m = this.meta(id);
    m.archived = true;
    this.save();
    this.emitMeta(m);
  }
  unarchive(id: string) {
    const m = this.meta(id);
    m.archived = false;
    this.save();
    this.emitMeta(m);
    return { ...m };
  }

  /** The worktree Pi Desktop made for a session; one the user made themselves is never touched. */
  private ownsWorktree(m: SessionMeta) {
    return m.kind === 'code' && m.worktree && !m.external && m.cwd !== m.projectPath;
  }

  /** What deleting would lose, so the confirmation can say so. */
  async inspect(id: string): Promise<SessionCleanup> {
    const m = this.meta(id);
    if (!this.ownsWorktree(m)) return { worktree: null, branch: null, dirty: 0, unpushed: 0 };
    let dirty = 0, unpushed = 0;
    if (fs.existsSync(m.cwd)) {
      dirty = (await git.workState(m.cwd)).dirty.length;
      unpushed = await git.unpushedCommits(m.cwd, 'HEAD', m.baseCommit);
    }
    return { worktree: m.cwd, branch: m.branch, dirty, unpushed };
  }

  /** Delete the session from Pi Desktop: its record, its conversation file and the worktree it made. The project itself is untouched. */
  async remove(id: string): Promise<SessionRemoval> {
    const m = this.meta(id);
    await this.dispose(id);
    const result: SessionRemoval = { worktreeRemoved: false, branchKept: null };
    if (this.ownsWorktree(m)) {
      const root = await git.repoRoot(m.projectPath);
      if (root) {
        await git.removeWorktree(root, m.cwd);
        result.worktreeRemoved = true;
        // Commits that exist nowhere else outlive the session on their branch.
        if (m.branch && !(await git.deleteBranch(root, m.branch, m.baseCommit))) result.branchKept = m.branch;
      }
    }
    // A session imported from the pi CLI points at the user's own file.
    if (m.sessionFile && !m.imported) fs.rmSync(m.sessionFile, { force: true });
    this.metas = this.metas.filter((x) => x.id !== id);
    for (const child of this.metas) if (child.parentId === id) delete child.parentId;
    this.save();
    return result;
  }

  /** Start a suggested task in a new session beside this one, and send it the task. */
  async spawn(fromId: string, task: SpawnTask, key?: string): Promise<SessionMeta> {
    const from = this.meta(fromId);
    const prompt = task.prompt.trim();
    if (!prompt) throw new Error('The task has no instructions');
    const meta = await this.create({
      kind: from.kind,
      projectPath: from.kind === 'work' ? from.cwd : from.projectPath,
      worktree: from.kind === 'code' ? from.worktree : false,
      title: task.title.trim().slice(0, 80) || 'New session',
      model: from.model, thinking: from.thinking, outputStyle: from.outputStyle, parentId: from.id,
      // A suggestion the user accepts must not silently inherit "bypass".
      mode: from.mode === 'bypass' ? 'auto' : from.mode,
    });
    if (key) {
      from.suggestions = { ...from.suggestions, [key]: { state: 'started', sessionId: meta.id } };
      this.save();
      this.emitMeta(from);
    }
    this.emitMeta(meta);
    void this.prompt(meta.id, { text: prompt, attachments: [], clientId: crypto.randomUUID() }, 'steer').catch((err: Error) =>
      this.emit({ type: 'notify', sessionId: meta.id, message: err.message, level: 'error' }));
    return { ...meta };
  }

  // ------------------------------------------------------------ talking to other sessions

  private peer(fromId: string, toId: string) {
    const from = this.meta(fromId);
    const to = this.metas.find((x) => x.id === toId);
    if (!to || to.id === from.id) throw new Error(`No other session ${toId}. Use pidesk_list_sessions to see the ids.`);
    if (to.kind !== from.kind || to.projectPath !== from.projectPath) throw new Error('That session belongs to a different project.');
    if (to.archived) throw new Error('That session is archived.');
    return { from, to };
  }

  /** The other open sessions of this session's project, most recently active first. */
  peerList(fromId: string) {
    const from = this.meta(fromId);
    return this.metas
      .filter((m) => m.id !== from.id && !m.archived && m.kind === from.kind && m.projectPath === from.projectPath)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 20)
      .map((m) => ({ id: m.id, title: m.title, status: this.live.get(m.id)?.status ?? 'idle', branch: m.branch, updatedAt: m.updatedAt }));
  }

  /** The last few user and assistant messages of another session of the project. */
  peerRead(fromId: string, toId: string, limit = 10) {
    const { to } = this.peer(fromId, toId);
    return to.sessionFile && fs.existsSync(to.sessionFile) ? readTranscript(to.sessionFile, Math.max(1, Math.min(limit, 30))) : [];
  }

  private peerSent = new Map<string, number[]>();
  /** Deliver a message to another session: it starts a turn there, or waits until the one in progress ends. */
  async peerSend(fromId: string, toId: string, text: string): Promise<'delivered' | 'queued'> {
    const { from, to } = this.peer(fromId, toId);
    const body = text.trim();
    if (!body) throw new Error('The message is empty');
    // Two sessions answering each other would never stop: cap what one session may send to another.
    const key = `${from.id}>${to.id}`;
    const recent = (this.peerSent.get(key) ?? []).filter((t) => Date.now() - t < 10 * 60_000);
    if (recent.length >= 8) throw new Error('Too many messages to that session in a short time. Wait for it, or tell the user.');
    this.peerSent.set(key, [...recent, Date.now()]);
    const queued = this.isRunning(to.id);
    await this.prompt(to.id, { text: encodePeerMessage({ id: from.id, title: from.title }, body.slice(0, 20_000)), attachments: [], clientId: crypto.randomUUID() }, 'followUp');
    return queued ? 'queued' : 'delivered';
  }

  private async dispose(id: string) {
    const watch = this.prWatches.get(id);
    this.stopPrWatch(id);
    // A gh process running with the worktree as its cwd blocks deleting that worktree.
    await watch?.read;
    const live = this.live.get(id);
    if (!live) return;
    this.abortSuggestion(id);
    live.disposed = true;
    live.generation++;
    this.live.delete(id);
    this.cancelPending(live);
    // Background subagents and shells die with their session.
    this.stopTasks(live);
    live.unsubscribe?.();
    this.setStatus(live, 'idle');
    await live.runtime.dispose().catch(() => {});
  }

  /** Nothing a session started may wake it later: used when the user stops the turn and on close. */
  private stopTasks(live: Live) {
    for (const stop of live.tasks.values()) stop.abort();
  }

  async abort(id: string) {
    const live = this.live.get(id);
    if (!live) return;
    this.cancelPending(live);
    // Stopping the turn stops its background tasks too; their notifications would start a new turn.
    this.stopTasks(live);
    await live.runtime.session.abort();
  }
  clearQueue(id: string) {
    const live = this.live.get(id);
    if (!live) return { steering: [], followUp: [] };
    const q = live.runtime.session.clearQueue();
    return { steering: [...q.steering], followUp: [...q.followUp] };
  }
  async newContext(id: string) {
    const live = await this.ensure(id);
    this.abortSuggestion(id);
    await live.runtime.newSession();
  }
  async compact(id: string, instructions?: string) {
    const live = await this.ensure(id);
    const r = await live.runtime.session.compact(instructions);
    return { tokensBefore: r.tokensBefore, estimatedTokensAfter: r.estimatedTokensAfter };
  }
  /** Messages the latest compaction left out of the context, for showing them again on demand. */
  async compactedHistory(id: string): Promise<AgentMessage[]> {
    const live = await this.ensure(id);
    return this.compactedMessages(live.runtime.session);
  }
  private statsOf(session: AgentSession): SessionStats | null {
    try {
      const s = session.getSessionStats();
      const usage = s.contextUsage as SessionStats['contextUsage'];
      const contextWindow = usage?.contextWindow || session.model?.contextWindow || 0;
      // pi reports no usage right after a compaction (the last response predates it); estimate it so the ring is not stale.
      const contextUsage = usage?.percent == null && contextWindow > 0 ? this.estimatedContextUsage(session, contextWindow) : usage;
      return { userMessages: s.userMessages, assistantMessages: s.assistantMessages, toolCalls: s.toolCalls, tokens: s.tokens, cost: s.cost, contextUsage };
    } catch {
      return null;
    }
  }
  async stats(id: string) {
    const live = this.live.get(id);
    return live ? this.statsOf(live.runtime.session) : null;
  }

  /** Where the context window goes. Fixed parts are estimated from their text; messages fill the rest of the last measured total. */
  context(id: string): ContextBreakdown | null {
    const live = this.live.get(id);
    if (!live) return null;
    const session = live.runtime.session;
    const usage = session.getContextUsage();
    const contextWindow = usage?.contextWindow || session.model?.contextWindow || 0;
    if (!contextWindow) return null;
    const { items, sum, prompt, fixed } = this.contextFixed(session);
    const measured = usage?.tokens ?? null;
    const used = measured != null ? Math.max(measured, fixed) : fixed + session.messages.reduce((n, m) => n + estimateTokens(m), 0);
    const stats = session.getSessionStats();
    const compaction = session.settingsManager.getCompactionSettings(session.model ?? undefined);
    const buffer = compaction.enabled ? Math.min(compaction.reserveTokens, Math.max(0, contextWindow - used)) : 0;
    return {
      contextWindow,
      used,
      estimated: measured == null,
      cache: { input: stats.tokens.input, cacheRead: stats.tokens.cacheRead, cacheWrite: stats.tokens.cacheWrite },
      cost: stats.cost,
      categories: [
        { key: 'messages', label: 'Messages', tokens: used - fixed },
        { key: 'mcp', label: 'MCP tools', tokens: sum('mcp') },
        { key: 'extension', label: 'Extension tools', tokens: sum('extension') },
        { key: 'system', label: 'System tools', tokens: sum('system') },
        { key: 'skills', label: 'Skills', tokens: sum('skills') },
        { key: 'memory', label: 'Memory files', tokens: sum('memory') },
        { key: 'prompt', label: 'System prompt', tokens: prompt },
        { key: 'buffer', label: 'Autocompact buffer', tokens: buffer },
        { key: 'free', label: 'Free space', tokens: Math.max(0, contextWindow - used - buffer) },
      ],
      items: items.sort((a, b) => b.tokens - a.tokens),
    };
  }

  /** The fixed part of the context window: the system prompt, the tools, skills and memory files in it. */
  private contextFixed(session: AgentSession) {
    const items: ContextBreakdown['items'] = [];
    const active = new Set(session.getActiveToolNames());
    for (const tool of session.getAllTools()) {
      if (!active.has(tool.name)) continue;
      const where = tool.sourceInfo?.path ?? '';
      const group = /\bmcp\b/i.test(`${where} ${tool.sourceInfo?.source ?? ''}`) ? 'mcp' : where.startsWith('builtin:') ? 'system' : 'extension';
      const text = tool.name + (tool.description ?? '') + JSON.stringify(tool.parameters ?? {}) + (tool.promptGuidelines ?? []).join('\n');
      items.push({ group, name: tool.name, tokens: approxTokens(text) });
    }
    const loader = session.resourceLoader;
    for (const skill of loader.getSkills().skills) {
      if (!skill.disableModelInvocation) items.push({ group: 'skills', name: skill.name, tokens: approxTokens(formatSkillsForPrompt([skill])) });
    }
    for (const file of loader.getAgentsFiles().agentsFiles) items.push({ group: 'memory', name: file.path, tokens: approxTokens(file.content) });
    const sum = (group: string) => items.filter((i) => i.group === group).reduce((n, i) => n + i.tokens, 0);
    // Skills and memory files are part of the system prompt text; count them once.
    const prompt = Math.max(0, approxTokens(session.systemPrompt) - sum('skills') - sum('memory'));
    const fixed = prompt + sum('mcp') + sum('extension') + sum('system') + sum('skills') + sum('memory');
    return { items, sum, prompt, fixed };
  }

  /** Post-compaction usage, estimated from the projected messages until the next response measures it. */
  private estimatedContextUsage(session: AgentSession, contextWindow: number): NonNullable<SessionStats['contextUsage']> {
    const { fixed } = this.contextFixed(session);
    const tokens = fixed + session.messages.reduce((n, m) => n + estimateTokens(m), 0);
    return { tokens, contextWindow, percent: (tokens / contextWindow) * 100 };
  }

  async exportHtml(id: string) {
    const live = await this.ensure(id);
    return { path: await live.runtime.session.exportToHtml() };
  }
  async clone(id: string) {
    const live = await this.ensure(id);
    this.abortSuggestion(id);
    const leafId = live.runtime.session.sessionManager.getLeafId();
    if (!leafId) throw new Error('Cannot fork an empty session');
    await live.runtime.fork(leafId, { position: 'at' });
  }
  async setModel(id: string, modelId: string) {
    const live = await this.ensure(id);
    const model = this.findModel(modelId);
    if (!model) throw new Error(`Model not found: ${modelId}`);
    const session = live.runtime.session;
    await session.setModel(model);
    const m = this.meta(id);
    m.model = modelId;
    m.thinking = session.thinkingLevel as ThinkingLevel;
    this.save();
    return { levels: session.getAvailableThinkingLevels() as ThinkingLevel[], thinking: session.thinkingLevel as ThinkingLevel };
  }
  async setThinking(id: string, level: ThinkingLevel) {
    const live = await this.ensure(id);
    live.runtime.session.setThinkingLevel(level);
    const m = this.meta(id);
    m.thinking = live.runtime.session.thinkingLevel as ThinkingLevel;
    this.save();
  }
  async commands(id: string): Promise<SlashCommand[]> {
    const live = await this.ensure(id);
    const session = live.runtime.session;
    const out: SlashCommand[] = [];
    for (const c of session.extensionRunner.getRegisteredCommands()) out.push({ name: c.invocationName, description: c.description, source: 'extension' });
    for (const t of session.promptTemplates) out.push({ name: t.name, description: t.description, source: 'prompt' });
    for (const s of session.resourceLoader.getSkills().skills) out.push({ name: `skill:${s.name}`, description: s.description, source: 'skill' });
    return out;
  }
  // ------------------------------------------------------------ files / git

  async changes(id: string): Promise<ChangeSet> {
    const m = this.meta(id);
    await this.syncBranch(m);
    // Session-base diff for the Diff panel, plus live working-tree state for the branch bar.
    const base = await git.diffBase(m.cwd, m.baseCommit, m.baseBranch);
    const [files, state] = await Promise.all([git.changes(m.cwd, base), git.workState(m.cwd)]);
    return { files, state };
  }
  async commits(id: string) {
    const m = this.meta(id);
    return git.commits(m.cwd, await git.diffBase(m.cwd, m.baseCommit, m.baseBranch));
  }
  commitChanges(id: string, hash: string) {
    return git.commitChanges(this.meta(id).cwd, hash);
  }
  async changeContent(id: string, file: string, hash: string | null) {
    const m = this.meta(id);
    return git.changeContent(m.cwd, hash ? null : await git.diffBase(m.cwd, m.baseCommit, m.baseBranch), file, hash);
  }
  async prStatus(id: string) {
    const m = this.meta(id);
    await this.syncBranch(m);
    const pr = await git.prStatus(m.cwd);
    if (pr) this.publishPr(m, pr);
    return pr;
  }
  prThreads(id: string) {
    return git.prThreads(this.meta(id).cwd);
  }
  prReply(id: string, threadId: string, body: string) {
    return git.replyToThread(this.meta(id).cwd, threadId, body);
  }
  prResolve(id: string, threadId: string, resolved: boolean) {
    return git.setThreadResolved(this.meta(id).cwd, threadId, resolved);
  }
  files(id: string) {
    return git.listFiles(this.meta(id).cwd);
  }
  readFile(id: string, rel: string) {
    return readSessionFile(this.meta(id).cwd, rel);
  }
  async search(id: string, query: string, caseSensitive: boolean) {
    const cwd = this.meta(id).cwd;
    return searchSessionFiles(cwd, await git.listFiles(cwd), query, caseSensitive);
  }
  readImage(id: string, rel: string) {
    return readSessionImage(this.meta(id).cwd, rel);
  }
  /** Absolute path of something inside the session folder (for main to open or reveal). */
  resolvePath(id: string, rel: string) {
    return resolveInside(this.meta(id).cwd, rel);
  }

  // ------------------------------------------------------------ PR watch

  private startPrWatch(id: string) {
    const m = this.meta(id);
    if (m.kind !== 'code' || m.archived || !m.branch || !this.live.has(id)) return;
    if (!this.prWatches.has(id)) this.prWatches.set(id, { watcher: new PrWatcher() });
    this.kickPrWatch(id, 0);
  }

  private stopPrWatch(id: string) {
    const entry = this.prWatches.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.prWatches.delete(id);
  }

  /** Look sooner than the schedule says, e.g. right after a turn that may have pushed. */
  private kickPrWatch(id: string, delay = 0) {
    const entry = this.prWatches.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => void this.prTick(id), delay);
    entry.timer.unref?.();
  }

  private async prTick(id: string) {
    const entry = this.prWatches.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    // Two overlapping looks could deliver the same event twice: the running one looks again instead.
    if (entry.busy) {
      entry.again = true;
      return;
    }
    entry.busy = true;
    try {
      await this.prLook(id, entry);
    } finally {
      entry.busy = false;
      if (entry.again) {
        entry.again = false;
        entry.timer = setTimeout(() => void this.prTick(id), 500);
        entry.timer.unref?.();
      }
    }
  }

  private async prLook(id: string, entry: PrWatchEntry) {
    const m = this.meta(id);
    await this.syncBranch(m);
    if (m.kind !== 'code' || m.archived || !m.branch || !this.live.has(id)) return this.stopPrWatch(id);
    entry.read = git.readPr(m.cwd).catch(() => null);
    const snapshot = (await entry.read) as Awaited<ReturnType<typeof git.readPr>>;
    entry.read = undefined;
    // A look can outlive its session, or be overtaken by a newer one: drop the result then.
    if (this.prWatches.get(id) !== entry) return;
    // A different PR (the branch got a new one) has its own comment history: baseline it again.
    if (snapshot && snapshot.status.num !== entry.num) {
      entry.num = snapshot.status.num;
      entry.watcher.reset();
    }
    const result = entry.watcher.observe(snapshot, { autoFixCi: m.autoFixCi, autoMerge: m.autoMerge, done: m.prAutoDone });
    this.publishPr(m, result.status);
    if (result.pending) void this.deliverPrEvent(id, entry, result.pending);
    if (result.done) return;
    entry.timer = setTimeout(() => void this.prTick(id), result.after);
    entry.timer.unref?.();
  }

  /** Keep the session's PR summary and the bar in step; the summary also survives a restart. */
  private publishPr(m: SessionMeta, status: PrStatus | null) {
    const summary = status ? { num: status.num, url: status.url, state: status.state, draft: status.draft } : null;
    if (summary && JSON.stringify(summary) !== JSON.stringify(m.pr)) {
      m.pr = summary;
      this.save();
    }
    this.emit({ type: 'pr', sessionId: m.id, status });
  }

  /** Hand an event to the agent as a turn of its own — unless the user is already in the middle of something. */
  private async deliverPrEvent(id: string, entry: PrWatchEntry, pending: PrPending) {
    const live = this.live.get(id);
    const busy = !live || live.status === 'running' || live.historyBusy || live.pending.size > 0;
    if (busy) return; // the next look tries again, so nothing is lost
    entry.watcher.accept(pending);
    const m = this.meta(id);
    if (pending.mark) {
      m.prAutoDone = { ...m.prAutoDone, ...pending.mark };
      this.save();
    }
    try {
      await this.prompt(id, { text: encodePrEvent(pending.event), attachments: [] }, 'followUp');
    } catch (err) {
      this.emit({ type: 'notify', sessionId: id, message: tr('ag.prEventFail', { error: err instanceof Error ? err.message : String(err) }), level: 'warning' });
    }
  }

  // ------------------------------------------------------------ CLI session import

  /** Sessions the pi CLI created for this project that the desktop does not know yet. */
  importable(projectPath: string): ImportableSession[] {
    const known = new Set(this.metas.map((m) => m.sessionFile).filter(Boolean));
    const out: ImportableSession[] = [];
    const walk = (dir: string, depth: number) => {
      let entries: fs.Dirent[] = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory() && depth < 2) walk(p, depth + 1);
        else if (e.name.endsWith('.jsonl') && !known.has(p)) {
          const info = readSessionHeader(p);
          if (info && path.resolve(info.cwd) === path.resolve(projectPath)) out.push({ file: p, ...info });
        }
      }
    };
    walk(this.opts.cliSessionsDir ?? path.join(this.agentDir, 'sessions'), 0);
    return out.sort((a, b) => b.mtime - a.mtime);
  }

  async importSession(file: string): Promise<SessionMeta> {
    const info = readSessionHeader(file);
    if (!info) throw new Error('Not a pi session file');
    const root = await git.repoRoot(info.cwd);
    const branch = root ? await git.currentBranch(root) : null;
    let baseBranch = branch;
    let baseCommit = root ? await git.head(root) : null;
    // On a feature branch the earlier work is what the diff should show: measure from where it left the default branch.
    const trunk = root && branch && branch !== 'HEAD' ? await git.defaultBranch(root) : null;
    const fork = trunk && trunk !== branch ? await git.mergeBase(root!, trunk) : null;
    if (trunk && fork) { baseBranch = trunk; baseCommit = fork; }
    const meta: SessionMeta = {
      id: crypto.randomUUID(), kind: 'code', ...this.titleState(info.name || info.firstPrompt?.slice(0, 60) || 'Imported session', false, 'Imported session'),
      projectPath: info.cwd, cwd: info.cwd, branch, baseBranch,
      baseCommit, worktree: false, mode: 'auto', outputStyle: 'default', sessionFile: file,
      createdAt: info.mtime, updatedAt: info.mtime, pr: null, imported: true,
    };
    this.metas.unshift(meta);
    this.save();
    return meta;
  }

  async shutdown() {
    for (const c of this.namers) c.abort();
    this.namers.clear();
    for (const c of this.sideRuns.values()) c.abort();
    this.sideRuns.clear();
    for (const c of this.suggesters.values()) c.abort();
    this.suggesters.clear();
    await Promise.all([...this.live.keys()].map((id) => this.dispose(id)));
  }
}

export interface TranscriptLine {
  role: 'user' | 'assistant';
  text: string;
}

/** The text of the last `limit` user and assistant messages in a pi session file; tool traffic is left out. */
export function readTranscript(file: string, limit: number): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      const entry = JSON.parse(line);
      const message = entry.type === 'message' ? entry.message : null;
      if (message?.role !== 'user' && message?.role !== 'assistant') continue;
      const blocks: any[] = Array.isArray(message.content) ? message.content : [];
      let text = typeof message.content === 'string' ? message.content : blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
      if (message.role === 'user') {
        text = decodeUserContent(message.content).text;
        if (text.startsWith('[pi-desktop]')) continue;
        const peer = decodePeerMessage(text);
        if (peer) text = `(message from session "${peer.fromTitle}") ${peer.text}`;
        // A turn the PR watcher started reads as what happened, not as a wall of instructions.
        const event = decodePrEvent(text);
        if (event) text = `(PR #${event.num} · ${event.summary}) ${event.instruction ?? ''}`.trim();
        const command = decodeCommandMessage(text);
        if (command) text = `(/${command.name}) ${command.prompt}`;
      } else if (!text) {
        const tools = blocks.filter((b) => b.type === 'toolCall').map((b) => b.name);
        if (!tools.length) continue;
        text = `[used tools: ${[...new Set(tools)].join(', ')}]`;
      }
      out.push({ role: message.role, text: text.length > 2000 ? `${text.slice(0, 2000)}…` : text });
    }
  } catch {
    // A file that is half-written or gone simply has no readable history.
  }
  return out.slice(-limit);
}

export function readSessionHeader(file: string): Omit<ImportableSession, 'file'> | null {
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const header = JSON.parse(lines[0]);
    if (header.type !== 'session' || !header.cwd) return null;
    let firstPrompt: string | null = null, name: string | null = null;
    for (const line of lines.slice(1, 400)) {
      const e = JSON.parse(line);
      if (e.type === 'session_info' && e.name) name = e.name;
      if (!firstPrompt && e.type === 'message' && e.message?.role === 'user') {
        const c = e.message.content;
        firstPrompt = typeof c === 'string' ? c : (c || []).filter((x: any) => x.type === 'text').map((x: any) => x.text).join('');
      }
    }
    return { cwd: header.cwd, id: header.id, name, firstPrompt, mtime: fs.statSync(file).mtimeMs };
  } catch {
    return null;
  }
}
