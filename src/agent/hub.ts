// Session hub: every desktop session is an in-process pi AgentSession (through an
// AgentSessionRuntime, so /clear and forks can replace it), plus the session
// metadata, worktrees, CLI-session import and naming around it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createAgentSession, createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices,
  createCodemodeExtension, createMcpExtension, createToolSearchExtension, DefaultResourceLoader, estimateTokens,
  formatSkillsForPrompt, getAgentDir, hasTrustRequiringProjectResources, ModelRuntime, ProjectTrustStore, SessionManager, SettingsManager,
  type AgentSession, type AgentSessionRuntime, type CreateAgentSessionRuntimeFactory, type ExtensionUIContext,
} from '@earendil-works/pi-coding-agent';
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { buildMessage } from '@shared/attachments';
import type {
  ContextBreakdown, CreateSessionOptions, HostEvent, ImportableSession, ModelInfo, OpenSessionResult, OutputStyle, PermissionMode,
  PrSummary, SessionMeta, SessionStats, SubagentProgress, SessionSummary, SlashCommand, StreamingBehavior, ThinkingLevel, UiRequest, UiRequestInput, UiResponse,
} from '@shared/protocol';
import { validatePromptPayload } from './attachments';
import coworkPrompt from './cowork-prompt.md?raw';
import { registerDemoModel } from './demo-model';
import { createDesktopKit, type KitHost, type KitState, type SubagentRun } from './desktop-kit';
import { toWireEvent } from './events';
import { readSessionFile, readSessionImage, resolveInside } from './files';
import * as git from './git';
import * as naming from './naming';
import { Store } from './store';

const NAMES = ['trusting-maxwell', 'eager-lovelace', 'quiet-hopper', 'brave-turing', 'calm-knuth', 'swift-ritchie', 'bold-curie', 'keen-dijkstra'];
/** Tools on top of pi's defaults (read, bash, edit, write). */
const EXTRA_TOOLS = ['+grep', '+find', '+ls'];
const SUBAGENT_TOOLS = ['read', 'grep', 'find', 'ls', 'bash'];

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
  userData: string;
  emit: (event: HostEvent) => void;
  /** pi's config directory (auth.json, models.json, settings, extensions). Default ~/.pi/agent. */
  agentDir?: string;
  /** Where CLI sessions are discovered for import. Default <agentDir>/sessions. */
  cliSessionsDir?: string;
}

export class SessionHub {
  readonly agentDir: string;
  models!: ModelRuntime;
  private readonly store: Store;
  private metas: SessionMeta[];
  private readonly live = new Map<string, Live>();
  private readonly opening = new Map<string, Promise<Live>>();
  private readonly trust: ProjectTrustStore;
  private apiKeys: Record<string, string> = {};
  private namers = new Set<AbortController>();

  constructor(private readonly opts: HubOptions) {
    this.agentDir = opts.agentDir ?? getAgentDir();
    this.store = new Store(opts.userData);
    this.metas = this.store.get<SessionMeta[]>('sessions', []);
    this.trust = new ProjectTrustStore(this.agentDir);
  }

  async init(apiKeys: Record<string, string> = {}) {
    this.models = await ModelRuntime.create({
      authPath: path.join(this.agentDir, 'auth.json'),
      modelsPath: path.join(this.agentDir, 'models.json'),
      signal: AbortSignal.timeout(15_000),
    });
    registerDemoModel(this.models);
    await this.setApiKeys(apiKeys);
    // Model catalogs refresh in the background, like pi's RPC mode.
    void this.models.refresh({ signal: AbortSignal.timeout(15_000) }).catch(() => {});
  }

  /** Keys saved in the desktop app override pi's own config for this process only. */
  async setApiKeys(keys: Record<string, string>) {
    for (const provider of Object.keys(this.apiKeys)) {
      if (!keys[provider]) await this.models.removeRuntimeApiKey(provider).catch(() => {});
    }
    for (const [provider, key] of Object.entries(keys)) {
      if (key && this.apiKeys[provider] !== key) await this.models.setRuntimeApiKey(provider, key).catch(() => {});
    }
    this.apiKeys = { ...keys };
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
  list(): SessionSummary[] {
    return this.metas.filter((m) => !m.archived).map((m) => ({ ...m, status: this.live.get(m.id)?.status ?? 'idle' }));
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
    const settings = SettingsManager.create(os.homedir(), this.agentDir);
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
    } satisfies Partial<SessionMeta>;
    let meta: SessionMeta;
    if (opts.kind === 'cowork') {
      // Cowork tasks run directly in the chosen folder (or a fresh scratch workspace); no worktree, no diff base.
      let cwd = opts.projectPath;
      if (!cwd) {
        cwd = path.join(this.opts.userData, 'cowork', `${new Date().toISOString().slice(0, 10)}-${slug}`);
        fs.mkdirSync(cwd, { recursive: true });
      }
      meta = {
        ...base, kind: 'cowork', ...this.titleState(opts.title, opts.autoName, 'New task'),
        projectPath: cwd, cwd, scratch: !opts.projectPath, branch: null, baseBranch: null, baseCommit: null, worktree: false,
      };
    } else {
      const projectPath = opts.projectPath;
      if (!projectPath) throw new Error('Choose a project first');
      const root = await git.repoRoot(projectPath);
      const baseCommit = root ? await git.head(root) : null;
      let cwd = projectPath;
      let branch = root ? await git.currentBranch(root) : null;
      const baseBranch = branch;
      if (root && baseCommit && opts.worktree !== false) {
        branch = `claude/${slug}`;
        cwd = path.join(this.opts.userData, 'worktrees', `${path.basename(root)}-${slug}`);
        await git.addWorktree(root, cwd, branch, baseCommit);
      }
      meta = {
        ...base, kind: 'code', ...this.titleState(opts.title, opts.autoName, 'New session'),
        projectPath, cwd, branch, baseBranch, baseCommit, worktree: cwd !== projectPath,
      };
    }
    this.metas.unshift(meta);
    this.save();
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

  private async start(id: string): Promise<Live> {
    const m = this.meta(id);
    if (m.archived) throw new Error('This session is archived');
    if (!fs.existsSync(m.cwd)) throw new Error(`The session folder no longer exists: ${m.cwd}`);
    const live: Live = {
      id, runtime: null as unknown as AgentSessionRuntime,
      kit: { mode: m.mode, profile: m.kind, outputStyle: m.outputStyle, allowed: new Set() },
      pending: new Map(), status: 'idle', generation: 0, disposed: false, tasks: new Map(),
    };
    const resumed = m.sessionFile && fs.existsSync(m.sessionFile);
    const sessionManager = resumed ? SessionManager.open(m.sessionFile!, undefined, m.cwd) : SessionManager.create(m.cwd);
    if (!resumed) sessionManager.appendSessionInfo(m.title);
    live.runtime = await createAgentSessionRuntime(this.factory(live), { cwd: m.cwd, agentDir: this.agentDir, sessionManager });
    live.runtime.setRebindSession(() => this.bind(live));
    await this.bind(live);
    this.live.set(id, live);
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
          ...(m.kind === 'cowork' ? { appendSystemPrompt: [coworkPrompt] } : {}),
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

  private kitHost(live: Live): KitHost {
    return {
      state: live.kit,
      ask: (request, signal) => this.ask(live, request, signal),
      setMode: (mode) => this.applyMode(live.id, mode),
      runSubagent: (run) => this.runSubagent(live, run),
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
    const wire = toWireEvent(event);
    if (wire) this.emit({ type: 'pi', sessionId: live.id, event: wire });
  }

  private setStatus(live: Live, status: 'idle' | 'running') {
    if (live.status === status) return;
    live.status = status;
    this.emit({ type: 'status', sessionId: live.id, status });
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
    const label = response.cancelled ? 'cancelled' : response.value ?? (response.confirmed === undefined ? 'OK' : response.confirmed ? 'Yes' : 'No');
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
    return ui as unknown as ExtensionUIContext;
  }

  // ------------------------------------------------------------ subagent

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
      const kit: KitState = { mode: 'plan', profile: live.kit.profile, outputStyle: 'default', allowed: new Set() };
      const settingsManager = SettingsManager.create(cwd, this.agentDir, { projectTrusted: !hasTrustRequiringProjectResources(cwd) || this.trust.get(cwd) === true });
      const resourceLoader = new DefaultResourceLoader({
        cwd, agentDir: this.agentDir, settingsManager,
        // Nobody answers prompts inside a subagent: plan mode blocks anything that would ask.
        extensionFactories: [createDesktopKit({ state: kit, ask: async () => ({ cancelled: true }), setMode: () => {} })],
      });
      await resourceLoader.reload();
      const { session } = await createAgentSession({
        cwd, agentDir: this.agentDir, modelRuntime: this.models, model: run.ctx.model, resourceLoader, settingsManager,
        sessionManager: SessionManager.inMemory(cwd), tools: SUBAGENT_TOOLS,
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
      messages: session.messages as any,
      model: session.model ? `${session.model.provider}/${session.model.id}` : null,
      thinking: session.thinkingLevel as ThinkingLevel,
      levels: session.getAvailableThinkingLevels() as ThinkingLevel[],
      isStreaming: session.isStreaming,
      stats: this.statsOf(session),
      pending: [...live.pending.values()].map((p) => p.request),
    };
  }

  async prompt(id: string, payload: unknown, behavior: StreamingBehavior): Promise<{ disposition: string }> {
    const live = await this.ensure(id);
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
    if (!m.autoName || m.titleLocked || m.nameAttempted || !text || text.startsWith('/')) return;
    const placeholder = naming.titleFromPrompt(text);
    if (!placeholder) return;
    m.nameAttempted = true;
    this.save();
    this.setTitle(id, placeholder);
    void this.nameSession(id, text).catch(() => {});
  }

  private async nameSession(id: string, prompt: string) {
    const m = this.meta(id);
    if (!m.autoName || m.titleLocked || m.autoNamed) return;
    const live = this.live.get(id);
    const current = live?.runtime.session.model ? `${live.runtime.session.model.provider}/${live.runtime.session.model.id}` : m.model;
    const { models, defaultModel } = await this.listModels();
    const pick = naming.pickNamingModel(models, current ?? defaultModel);
    const model = this.findModel(pick);
    if (!model) return; // demo/offline: there is no real model to ask
    const controller = new AbortController();
    this.namers.add(controller);
    const timer = setTimeout(() => controller.abort(), naming.TIMEOUT_MS);
    let raw = '';
    try {
      const reply = await this.models.completeSimple(model, {
        systemPrompt: naming.SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt.slice(0, 2000), timestamp: Date.now() }],
      }, { signal: controller.signal, maxTokens: 64 });
      if (reply.stopReason === 'error' || reply.stopReason === 'aborted') return;
      raw = reply.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
    } finally {
      clearTimeout(timer);
      this.namers.delete(controller);
    }
    const title = naming.cleanTitle(raw);
    const now = this.meta(id);
    // A rename that landed while the model was thinking wins.
    if (!title || now.titleLocked || !now.autoName || now.autoNamed || now.archived) return;
    now.autoNamed = true;
    this.save();
    this.setTitle(id, title);
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

  update(id: string, patch: { title?: string; pr?: PrSummary | null }) {
    const m = this.meta(id);
    if (patch.pr !== undefined) m.pr = patch.pr;
    if (patch.title?.trim()) {
      // A title set by the user is final: stop the placeholder/auto-naming path.
      Object.assign(m, { title: patch.title.trim(), titleLocked: true, autoName: false });
      this.live.get(id)?.runtime.session.setSessionName(m.title);
    }
    this.save();
    this.emitMeta(m);
    return { ...m };
  }

  async archive(id: string) {
    await this.dispose(id);
    this.meta(id).archived = true;
    this.save();
  }

  private async dispose(id: string) {
    const live = this.live.get(id);
    if (!live) return;
    live.disposed = true;
    live.generation++;
    this.live.delete(id);
    this.cancelPending(live);
    live.unsubscribe?.();
    this.setStatus(live, 'idle');
    await live.runtime.dispose().catch(() => {});
  }

  async abort(id: string) {
    const live = this.live.get(id);
    if (!live) return;
    this.cancelPending(live);
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
    await live.runtime.newSession();
  }
  async compact(id: string, instructions?: string) {
    const live = await this.ensure(id);
    const r = await live.runtime.session.compact(instructions);
    return { tokensBefore: r.tokensBefore, estimatedTokensAfter: r.estimatedTokensAfter };
  }
  private statsOf(session: AgentSession): SessionStats | null {
    try {
      const s = session.getSessionStats();
      return { userMessages: s.userMessages, assistantMessages: s.assistantMessages, toolCalls: s.toolCalls, tokens: s.tokens, cost: s.cost, contextUsage: s.contextUsage as SessionStats['contextUsage'] };
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
    const measured = usage?.tokens ?? null;
    const used = measured != null ? Math.max(measured, fixed) : fixed + session.messages.reduce((n, m) => n + estimateTokens(m), 0);
    const compaction = session.settingsManager.getCompactionSettings(session.model ?? undefined);
    const buffer = compaction.enabled ? Math.min(compaction.reserveTokens, Math.max(0, contextWindow - used)) : 0;
    return {
      contextWindow,
      used,
      estimated: measured == null,
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
  async exportHtml(id: string) {
    const live = await this.ensure(id);
    return { path: await live.runtime.session.exportToHtml() };
  }
  async clone(id: string) {
    const live = await this.ensure(id);
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
  /** A command typed in the terminal panel; its output joins the next turn's context. */
  async bash(id: string, command: string) {
    const live = await this.ensure(id);
    const session = live.runtime.session;
    const hooked = await session.extensionRunner.emitUserBash({ type: 'user_bash', command, excludeFromContext: false, cwd: session.sessionManager.getCwd() });
    if (hooked?.result) {
      session.recordBashResult(command, hooked.result);
      return { output: hooked.result.output, exitCode: hooked.result.exitCode };
    }
    const r = await session.executeBash(command, undefined, { operations: hooked?.operations });
    return { output: r.output, exitCode: r.exitCode };
  }

  // ------------------------------------------------------------ files / git

  changes(id: string) {
    const m = this.meta(id);
    return git.changes(m.cwd, m.baseCommit);
  }
  async prStatus(id: string) {
    const m = this.meta(id);
    const pr = await git.prStatus(m.cwd);
    if (pr) {
      m.pr = { num: pr.num, url: pr.url, state: pr.state, draft: pr.draft };
      this.save();
    }
    return pr;
  }
  files(id: string) {
    return git.listFiles(this.meta(id).cwd);
  }
  readFile(id: string, rel: string) {
    return readSessionFile(this.meta(id).cwd, rel);
  }
  readImage(id: string, rel: string) {
    return readSessionImage(this.meta(id).cwd, rel);
  }
  /** Absolute path of something inside the session folder (for main to open or reveal). */
  resolvePath(id: string, rel: string) {
    return resolveInside(this.meta(id).cwd, rel);
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
    const meta: SessionMeta = {
      id: crypto.randomUUID(), kind: 'code', ...this.titleState(info.name || info.firstPrompt?.slice(0, 60) || 'Imported session', false, 'Imported session'),
      projectPath: info.cwd, cwd: info.cwd, branch: root ? await git.currentBranch(root) : null, baseBranch: null,
      baseCommit: root ? await git.head(root) : null, worktree: false, mode: 'auto', outputStyle: 'default', sessionFile: file,
      createdAt: info.mtime, updatedAt: info.mtime, pr: null, imported: true,
    };
    this.metas.unshift(meta);
    this.save();
    return meta;
  }

  async shutdown() {
    for (const c of this.namers) c.abort();
    this.namers.clear();
    await Promise.all([...this.live.keys()].map((id) => this.dispose(id)));
  }
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
