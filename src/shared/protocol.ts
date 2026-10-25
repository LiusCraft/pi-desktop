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
  | { type: 'editor_text'; sessionId: string; text: string }
  | { type: 'extension_error'; sessionId: string; error: string }
  | { type: 'host_exit'; code: number | null; stderr: string };

// ------------------------------------------------------------ settings and app info

export type ThemeSetting = 'light' | 'dark' | 'system';
export interface Settings {
  theme: ThemeSetting | null;
  notify: boolean;
  defaultMode: SessionKind;
  sidebarCollapsed: boolean;
}
export interface SettingsPayload extends Settings {
  resolvedTheme: 'light' | 'dark';
  secureKeys: boolean;
}
export interface AppInfo {
  platform: string;
  version: string;
  demo: boolean;
  userData: string;
  keyProviders: string[];
  versions: { electron?: string; chrome?: string; node?: string };
}
export interface BootPayload {
  settings: SettingsPayload;
  info: Pick<AppInfo, 'platform' | 'version' | 'demo' | 'keyProviders'>;
}
export interface KeyStatus {
  env: string;
  saved: boolean;
  envSet: boolean;
}
export type OpenTarget = 'vscode' | 'cursor' | 'terminal' | 'folder';

// ------------------------------------------------------------ the renderer API

export interface Api {
  'app:info'(): AppInfo;
  'app:notify'(n: { title: string; body: string }): void;
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

  'keys:status'(): Record<string, KeyStatus>;
  'keys:set'(provider: string, key: string): void;

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
  'sessions:importable'(projectPath: string): ImportableSession[];
  'sessions:import'(file: string): SessionMeta;
  'models:list'(): { models: ModelInfo[]; defaultModel: string | null };
  'models:levels'(model: string | null): ThinkingLevel[];
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
  'sessions:changes', 'sessions:pr', 'sessions:files', 'sessions:readFile', 'sessions:importable',
  'sessions:import', 'models:list', 'models:levels',
] as const satisfies readonly ApiChannel[];

export const MAIN_CHANNELS = [
  'app:info', 'app:notify', 'app:openExternal', 'app:revealPath',
  'settings:open', 'settings:get', 'settings:set', 'settings:close',
  'projects:list', 'projects:add', 'projects:remove',
  'cowork:folders', 'cowork:addFolder', 'cowork:useFolder', 'cowork:removeFolder',
  'attachments:import', 'attachments:pick', 'attachments:clipboard',
  'keys:status', 'keys:set', 'sessions:openIn', 'sessions:openPath',
] as const satisfies readonly ApiChannel[];

export const API_CHANNELS: readonly ApiChannel[] = [...MAIN_CHANNELS, ...HOST_CHANNELS];

/** Push channels from main to every window. */
export interface PushEvents {
  'host:event': HostEvent;
  'settings:changed': SettingsPayload;
  'settings:section': string;
}
export type PushChannel = keyof PushEvents;
export const PUSH_CHANNELS: readonly PushChannel[] = ['host:event', 'settings:changed', 'settings:section'];

// ------------------------------------------------------------ main ⇄ host messages

/** Calls only main makes (configuration and internal lookups). */
export interface HostInternal {
  'host:init'(opts: HostInitOptions): void;
  'host:setApiKeys'(keys: Record<string, string>): void;
  'host:meta'(id: string): SessionMeta;
  'host:importAttachments'(sources: AttachmentSource[]): AttachmentImportResult;
  'host:shutdown'(): void;
}
export interface HostInitOptions {
  userData: string;
  demo: boolean;
  apiKeys: Record<string, string>;
}
export type HostMethod = (typeof HOST_CHANNELS)[number] | keyof HostInternal;

export type MainToHost =
  | { kind: 'call'; id: number; method: HostMethod; args: unknown[] };
export type HostToMain =
  | { kind: 'result'; id: number; ok: true; value: unknown }
  | { kind: 'result'; id: number; ok: false; error: string }
  | { kind: 'event'; event: HostEvent };
