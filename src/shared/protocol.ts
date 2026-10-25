// The typed contract between the three processes:
//
//   renderer ──IPC (preload bridge)──▶ main ──utilityProcess port──▶ agent host (pi SDK)
//
// Every renderer call is one entry of `Api`. Channels listed in HOST_CHANNELS are
// forwarded unchanged to the agent host; the rest are handled by the main process.
// Host → renderer traffic is a single stream of `HostEvent`s.
import type { Attachment, PromptSubmission } from './attachments';

export type SessionKind = 'code' | 'cowork';
export type PermissionMode = 'auto' | 'default' | 'acceptEdits' | 'plan' | 'bypass';
export type OutputStyle = 'default' | 'proactive' | 'concise' | 'explanatory' | 'learning';
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type StreamingBehavior = 'steer' | 'followUp';

export const PERMISSION_MODES: readonly PermissionMode[] = ['auto', 'default', 'acceptEdits', 'plan', 'bypass'];
export const OUTPUT_STYLES: readonly OutputStyle[] = ['default', 'proactive', 'concise', 'explanatory', 'learning'];
export const PERMISSION_CHOICES = ['Allow', 'Always allow', 'Deny'] as const;
export const PLAN_CHOICES = ['Approve & auto-accept edits', 'Approve, ask for edits', 'Keep planning'] as const;
export type PermissionChoice = (typeof PERMISSION_CHOICES)[number];
export type PlanChoice = (typeof PLAN_CHOICES)[number];

export interface PrSummary {
  num: number;
  url: string;
  state: string;
  draft: boolean;
}
export interface PrStatus extends PrSummary {
  ci: 'none' | 'pass' | 'fail' | 'pending';
  checks: { n: string; st: 'pass' | 'fail' | 'pending' }[];
  comments: number;
}

export interface SessionMeta {
  id: string;
  kind: SessionKind;
  title: string;
  /** The title is a placeholder until the model names the session. */
  autoName: boolean;
  /** The user renamed the session: never auto-name it again. */
  titleLocked: boolean;
  autoNamed: boolean;
  nameAttempted: boolean;
  projectPath: string;
  cwd: string;
  /** Cowork task running in a fresh temporary workspace. */
  scratch?: boolean;
  branch: string | null;
  baseBranch: string | null;
  baseCommit: string | null;
  worktree: boolean;
  model?: string | null;
  thinking?: ThinkingLevel | null;
  mode: PermissionMode;
  outputStyle: OutputStyle;
  sessionFile: string | null;
  createdAt: number;
  updatedAt: number;
  pr: PrSummary | null;
  archived?: boolean;
  imported?: boolean;
}
export interface SessionSummary extends SessionMeta {
  status: 'idle' | 'running';
}

export interface CreateSessionOptions {
  kind: SessionKind;
  /** Code: the project. Cowork: the folder, or null for a temporary workspace. */
  projectPath: string | null;
  worktree?: boolean;
  title?: string;
  autoName?: boolean;
  model?: string | null;
  thinking?: ThinkingLevel | null;
  mode?: PermissionMode;
  outputStyle?: OutputStyle;
}

export interface ModelInfo {
  provider: string;
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  input?: string[];
  cost?: { input?: number; output?: number };
}

/** Minimal shape of pi's persisted/streamed messages that the UI reads. */
export interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, any>;
  data?: string;
  mimeType?: string;
  [key: string]: unknown;
}
export interface AgentMessage {
  role: 'user' | 'assistant' | 'toolResult' | 'custom' | 'bashExecution' | string;
  content?: string | ContentBlock[];
  timestamp?: number;
  stopReason?: string;
  errorMessage?: string;
  usage?: { input?: number; output?: number; [key: string]: unknown };
  toolCallId?: string;
  toolName?: string;
  details?: any;
  isError?: boolean;
  display?: boolean;
  customType?: string;
  [key: string]: unknown;
}

/** A pi AgentSessionEvent with streaming partials stripped (like pi's JSON mode). */
export interface PiEvent {
  type: string;
  [key: string]: any;
}

export interface SessionStats {
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  cost: number;
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
}

/** One step a subagent took, for its transcript. */
export type SubagentStep =
  | { kind: 'tool'; id: string; name: string; label: string; status: 'running' | 'done' | 'err' }
  | { kind: 'text'; text: string };

/** Live progress of a `task` subagent (also kept in the final tool result details). */
export interface SubagentProgress {
  startedAt: number;
  endedAt?: number;
  tokens: number;
  toolUses: number;
  /** What it is doing right now, e.g. "Running a command". */
  activity: string;
  steps: SubagentStep[];
}

/** Estimated split of the context window (like Claude Code's /context). */
export interface ContextBreakdown {
  contextWindow: number;
  used: number;
  /** False when the total comes from the last model response, true when it is all estimated. */
  estimated: boolean;
  categories: { key: 'messages' | 'mcp' | 'extension' | 'system' | 'skills' | 'memory' | 'prompt' | 'buffer' | 'free'; label: string; tokens: number }[];
  /** Per-item detail for the expandable sections. */
  items: { group: 'mcp' | 'extension' | 'system' | 'skills' | 'memory'; name: string; tokens: number }[];
}

export interface OpenSessionResult {
  meta: SessionMeta;
  messages: AgentMessage[];
  model: string | null;
  thinking: ThinkingLevel | null;
  levels: ThinkingLevel[];
  isStreaming: boolean;
  stats: SessionStats | null;
  /** Interactive requests still waiting for an answer (e.g. after a window reload). */
  pending: UiRequest[];
}

export interface SlashCommand {
  name: string;
  description?: string;
  source: string;
}

export interface FileChange {
  path: string;
  status: 'A' | 'M' | 'D';
  before: string | null;
  after: string;
  binary: boolean;
}

export interface ImportableSession {
  file: string;
  cwd: string;
  id: string;
  name: string | null;
  firstPrompt: string | null;
  mtime: number;
}

export interface Project {
  path: string;
  name: string;
  addedAt: number;
}

export type AttachmentSource = { path: string } | { name: string; mimeType: string; data: string };
export interface AttachmentImportResult {
  attachments: Attachment[];
  errors: { name: string; message: string }[];
}
export interface ClipboardImportResult extends AttachmentImportResult {
  hasFiles: boolean;
  text?: string;
}

// ------------------------------------------------------------ interactive requests

/** Questions the agent asks the user. Permission and plan prompts come from desktop-kit. */
export type UiRequest =
  | { id: string; kind: 'permission'; toolCallId: string; title: string }
  | { id: string; kind: 'plan'; toolCallId: string; title: string }
  | { id: string; kind: 'select'; title: string; options: string[] }
  | { id: string; kind: 'confirm'; title: string; message: string }
  | { id: string; kind: 'input' | 'editor'; title: string; placeholder?: string; prefill?: string };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A request before the host gives it an id. */
export type UiRequestInput = DistributiveOmit<UiRequest, 'id'>;

export interface UiResponse {
  value?: string;
  confirmed?: boolean;
  cancelled?: boolean;
}

// ------------------------------------------------------------ host → renderer events

export type HostEvent =
  | { type: 'pi'; sessionId: string; event: PiEvent }
  | { type: 'ui_request'; sessionId: string; request: UiRequest }
  | { type: 'ui_resolved'; sessionId: string; requestId: string; label: string }
  | { type: 'status'; sessionId: string; status: 'idle' | 'running' }
  | { type: 'meta'; sessionId: string; meta: SessionMeta }
  | { type: 'notify'; sessionId: string; message: string; level: 'info' | 'warning' | 'error' }
  /** A login flow is waiting for an answer (settings window). */
  | { type: 'auth_prompt'; loginId: string; provider: string; providerName: string; requestId: string; prompt: AuthPrompt }
  /** Out-of-band login progress: browser URL, device code, status text. */
  | { type: 'auth_event'; loginId: string; provider: string; event: AuthEvent }
  /** Accounts, keys or endpoints changed: reload model lists. */
  | { type: 'models_changed' }
  | { type: 'editor_text'; sessionId: string; text: string }
  | { type: 'extension_error'; sessionId: string; error: string }
  | { type: 'host_exit'; code: number | null; stderr: string };

// ------------------------------------------------------------ settings and app info

// ------------------------------------------------------------ model management

/** How a provider can be authenticated (pi's AuthType). */
export type AuthType = 'oauth' | 'api_key';
/** API families pi can talk to for a models.json endpoint. */
export type EndpointApi = 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'google-generative-ai';

/** USD per million tokens, pi's model cost shape. */
export interface ModelCost {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** Metadata that can be filled from models.dev (or the endpoint itself) for one model id. */
export interface ModelMeta {
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  input?: string[];
  cost?: ModelCost;
  /** Where the metadata came from. */
  source?: 'models.dev' | 'endpoint' | 'manual';
}

/** One provider pi knows about, built in or declared in models.json. */
export interface ProviderInfo {
  id: string;
  name: string;
  /** Sign in with an account (OAuth). */
  oauth: boolean;
  oauthName?: string;
  /** The OAuth login is backed by a subscription (ChatGPT, Claude Pro/Max, Copilot…). */
  subscription?: boolean;
  /** The provider accepts an API key. */
  apiKey: boolean;
  /** The provider has an interactive API-key setup (others are ambient only: env vars, cloud credentials). */
  apiKeyLogin: boolean;
  configured: boolean;
  /** Which method the current credential used. */
  authType?: AuthType;
  /** Human-readable status source, e.g. "stored credential", "ANTHROPIC_API_KEY". */
  source?: string;
  /** A stored credential exists, so it can be removed here. */
  credential: boolean;
  /** Declared in models.json (custom endpoint or built-in override). */
  custom: boolean;
  /** Chat models this provider currently offers. */
  models: number;
}

export interface EndpointModel extends ModelMeta {
  id: string;
}

/** A models.json provider, as the settings UI edits it. */
export interface EndpointInfo {
  id: string;
  name: string;
  baseUrl: string;
  api: string;
  /** The id is a built-in provider whose base URL (and models) this entry overrides. */
  builtin: boolean;
  /** A credential resolves for this provider (stored in auth.json, in models.json, or from env). */
  keySet: boolean;
  keySource?: string;
  models: EndpointModel[];
  /** models.json fields this editor does not manage (headers, compat, modelOverrides…). */
  extra: string[];
}

export interface ModelCatalogInfo {
  providers: ProviderInfo[];
  endpoints: EndpointInfo[];
  paths: { agentDir: string; auth: string; models: string };
  /** When the models.dev catalog used for alignment was last fetched. */
  catalogAt: number | null;
  /** Problems loading models.json or the catalog. */
  errors: string[];
}

/** What the endpoint editor sends back to the host. */
export interface EndpointDraft {
  id: string;
  name?: string;
  baseUrl: string;
  api: string;
  /** A new API key to store for this provider (auth.json), never written to models.json. */
  apiKey?: string;
  /** Remove the stored credential for this provider. */
  removeKey?: boolean;
  models: EndpointModel[];
}

/** API families the endpoint editor offers; models.json accepts others too. */
export const ENDPOINT_APIS: readonly EndpointApi[] = ['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'];

export interface EndpointDiscovery {
  models: EndpointModel[];
  error?: string;
}

/** A question pi's login flow asks while authenticating. */
export interface AuthPrompt {
  type: 'text' | 'secret' | 'select' | 'manual_code';
  message: string;
  placeholder?: string;
  options?: { id: string; label: string; description?: string }[];
}

/** Out-of-band progress from a login flow. */
export type AuthEvent =
  | { type: 'info'; message: string; links?: { url: string; label?: string }[] }
  | { type: 'auth_url'; url: string; instructions?: string }
  | { type: 'device_code'; userCode: string; verificationUri: string; intervalSeconds?: number; expiresInSeconds?: number }
  | { type: 'progress'; message: string };

export type ThemeSetting = 'light' | 'dark' | 'system';
export interface Settings {
  theme: ThemeSetting | null;
  notify: boolean;
  defaultMode: SessionKind;
  sidebarCollapsed: boolean;
  /** The composer pet: shown or not, and which skin (see PET_SKINS in the renderer). */
  pet: boolean;
  petSkin: string;
}
export interface SettingsPayload extends Settings {
  resolvedTheme: 'light' | 'dark';
}
export interface AppInfo {
  platform: string;
  version: string;
  demo: boolean;
  userData: string;
  /** pi's config directory (auth.json, models.json, extensions): shared with the pi CLI. */
  agentDir: string;
  versions: { electron?: string; chrome?: string; node?: string };
}
export interface BootPayload {
  settings: SettingsPayload;
  info: Pick<AppInfo, 'platform' | 'version' | 'demo' | 'agentDir'>;
}
export type OpenTarget = 'vscode' | 'cursor' | 'terminal' | 'folder';

// ------------------------------------------------------------ the renderer API

export interface Api {
  'app:info'(): AppInfo;
  'app:notify'(n: { title: string; body: string; sessionId?: string }): void;
  'app:openExternal'(url: string): void;
  'app:revealPath'(target: string, reveal?: boolean): void;

  'settings:open'(section?: string): void;
  'settings:get'(): SettingsPayload;
  'settings:set'(patch: Partial<Settings>): SettingsPayload;
  'settings:close'(): void;

  'projects:list'(): Project[];
  'projects:add'(): Project | null;
  'projects:remove'(path: string): Project[];
  'cowork:folders'(): Project[];
  'cowork:addFolder'(): Project | null;
  'cowork:useFolder'(path: string): Project | null;
  'cowork:removeFolder'(path: string): Project[];

  'attachments:import'(sources: AttachmentSource[]): AttachmentImportResult;
  'attachments:pick'(): AttachmentImportResult;
  'attachments:clipboard'(): ClipboardImportResult;


  'sessions:openIn'(id: string, target: OpenTarget): void;
  'sessions:openPath'(id: string, rel: string, reveal: boolean): void;

  // ---- forwarded to the agent host
  'sessions:list'(): SessionSummary[];
  'sessions:create'(opts: CreateSessionOptions): SessionMeta;
  'sessions:open'(id: string): OpenSessionResult;
  'sessions:prompt'(id: string, payload: PromptSubmission, behavior: StreamingBehavior): { disposition: string };
  'sessions:respond'(id: string, requestId: string, response: UiResponse): void;
  'sessions:setMode'(id: string, mode: PermissionMode): void;
  'sessions:setStyle'(id: string, style: OutputStyle): void;
  'sessions:update'(id: string, patch: { title?: string; pr?: PrSummary | null }): SessionMeta;
  'sessions:archive'(id: string): void;
  'sessions:abort'(id: string): void;
  'sessions:clearQueue'(id: string): { steering: string[]; followUp: string[] };
  'sessions:newContext'(id: string): void;
  'sessions:compact'(id: string, instructions?: string): { tokensBefore: number; estimatedTokensAfter?: number };
  'sessions:stats'(id: string): SessionStats | null;
  'sessions:exportHtml'(id: string): { path: string };
  'sessions:clone'(id: string): void;
  'sessions:setModel'(id: string, model: string): { levels: ThinkingLevel[]; thinking: ThinkingLevel };
  'sessions:setThinking'(id: string, level: ThinkingLevel): void;
  'sessions:commands'(id: string): SlashCommand[];
  'sessions:bash'(id: string, command: string): { output: string; exitCode: number | undefined };
  'sessions:changes'(id: string): FileChange[];
  'sessions:pr'(id: string): PrStatus | null;
  'sessions:files'(id: string): string[];
  'sessions:readFile'(id: string, rel: string): string | null;
  'sessions:readImage'(id: string, rel: string): { mimeType: string; src: string } | null;
  'sessions:context'(id: string): ContextBreakdown | null;
  'sessions:stopTask'(id: string, toolCallId: string): boolean;
  'sessions:importable'(projectPath: string): ImportableSession[];
  'git:branch'(dir: string): string | null;
  'sessions:import'(file: string): SessionMeta;
  'models:list'(): { models: ModelInfo[]; defaultModel: string | null };
  'models:levels'(model: string | null): ThinkingLevel[];
  // ---- model management (pi's auth.json + models.json, shared with the CLI)
  'models:catalog'(): ModelCatalogInfo;
  /** Resolves once the credential is saved; progress arrives as auth_* host events. */
  'models:login'(provider: string, authType: AuthType, name?: string): void;
  'models:loginRespond'(loginId: string, requestId: string, value: string): void;
  'models:loginCancel'(loginId: string): void;
  'models:logout'(provider: string): void;
  'models:endpointSave'(draft: EndpointDraft): ModelCatalogInfo;
  'models:endpointRemove'(id: string): ModelCatalogInfo;
  'models:endpointDiscover'(draft: EndpointDraft): EndpointDiscovery;
  /** Reload models.json and refresh pi's catalogs + the models.dev metadata cache. */
  'models:refresh'(): ModelCatalogInfo;
}

export type ApiChannel = keyof Api;
export type ApiArgs<K extends ApiChannel> = Parameters<Api[K]>;
export type ApiResult<K extends ApiChannel> = Awaited<ReturnType<Api[K]>>;

/** Calls the agent host serves; main forwards these without looking at them. */
export const HOST_CHANNELS = [
  'sessions:list', 'sessions:create', 'sessions:open', 'sessions:prompt', 'sessions:respond',
  'sessions:setMode', 'sessions:setStyle', 'sessions:update', 'sessions:archive', 'sessions:abort',
  'sessions:clearQueue', 'sessions:newContext', 'sessions:compact', 'sessions:stats', 'sessions:exportHtml',
  'sessions:clone', 'sessions:setModel', 'sessions:setThinking', 'sessions:commands', 'sessions:bash',
  'sessions:changes', 'sessions:pr', 'sessions:files', 'sessions:readFile', 'sessions:readImage',
  'sessions:context', 'sessions:stopTask', 'sessions:importable',
  'sessions:import', 'git:branch', 'models:list', 'models:levels',
  'models:catalog', 'models:login', 'models:loginRespond', 'models:loginCancel', 'models:logout',
  'models:endpointSave', 'models:endpointRemove', 'models:endpointDiscover', 'models:refresh',
] as const satisfies readonly ApiChannel[];

export const MAIN_CHANNELS = [
  'app:info', 'app:notify', 'app:openExternal', 'app:revealPath',
  'settings:open', 'settings:get', 'settings:set', 'settings:close',
  'projects:list', 'projects:add', 'projects:remove',
  'cowork:folders', 'cowork:addFolder', 'cowork:useFolder', 'cowork:removeFolder',
  'attachments:import', 'attachments:pick', 'attachments:clipboard',
  'sessions:openIn', 'sessions:openPath',
] as const satisfies readonly ApiChannel[];

export const API_CHANNELS: readonly ApiChannel[] = [...MAIN_CHANNELS, ...HOST_CHANNELS];

/** Push channels from main to every window. */
export interface PushEvents {
  'host:event': HostEvent;
  'settings:changed': SettingsPayload;
  'settings:section': string;
  /** A notification was clicked: bring this session to the front. */
  'session:focus': string;
}
export type PushChannel = keyof PushEvents;
export const PUSH_CHANNELS: readonly PushChannel[] = ['host:event', 'settings:changed', 'settings:section', 'session:focus'];

// ------------------------------------------------------------ main ⇄ host messages

/** Calls only main makes (configuration and internal lookups). */
export interface HostInternal {
  'host:init'(opts: HostInitOptions): void;
  'host:cancelLogins'(): void;
  'host:meta'(id: string): SessionMeta;
  'host:importAttachments'(sources: AttachmentSource[]): AttachmentImportResult;
  'host:shutdown'(): void;
}
export interface HostInitOptions {
  userData: string;
  demo: boolean;
}
export type HostMethod = (typeof HOST_CHANNELS)[number] | keyof HostInternal;

export type MainToHost =
  | { kind: 'call'; id: number; method: HostMethod; args: unknown[] };
export type HostToMain =
  | { kind: 'result'; id: number; ok: true; value: unknown }
  | { kind: 'result'; id: number; ok: false; error: string }
  | { kind: 'event'; event: HostEvent };
