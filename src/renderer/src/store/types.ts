import type { Attachment, DecodedAttachment, PromptSubmission } from '@shared/attachments';
import type {
  FileChange, PrStatus, PrSummary, SessionMeta, SlashCommand, ThinkingLevel, UiRequest,
} from '@shared/protocol';
import type { ToolState } from '@/lib/tools';

export interface Todo {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

export interface ThinkStep {
  text: string;
  done: boolean;
  t0: number;
  secs?: number;
  open: boolean;
  userToggled?: boolean;
}

export type Item =
  | {
      kind: 'user';
      key: string;
      text: string;
      attachments: (Attachment | DecodedAttachment)[];
      clientId?: string;
      notice?: string;
      queued?: boolean;
      delivered?: boolean;
      acknowledged?: boolean;
      failed?: boolean;
      exited?: boolean;
      /** What was sent, so a failed delivery can be restored as a draft. */
      submission?: PromptSubmission;
      wire?: string;
    }
  | { kind: 'text'; key: string; text: string; live: boolean; msgTs?: number }
  | { kind: 'note'; key: string; text: string; level?: 'error' }
  | { kind: 'group'; key: string; thoughts: ThinkStep[]; tools: ToolState[]; open: boolean; userToggled?: boolean }
  | { kind: 'todos'; key: string; items: Todo[] }
  | { kind: 'perm'; key: string; requestId: string | null; toolCallId: string; title: string; resolved: string | null }
  | { kind: 'ask'; key: string; requestId: string | null; request: UiRequest; resolved: string | null }
  | { kind: 'plan'; key: string; toolCallId: string | null; title: string; md: string; requestId: string | null; resolved: string | null }
  | { kind: 'foot'; key: string; t: number; usage?: string };

export type ItemOf<K extends Item['kind']> = Extract<Item, { kind: K }>;

export type Detail =
  | { type: 'plan'; key: string }
  | { type: 'agent'; toolCallId: string }
  | { type: 'file'; path: string; line: number; start?: number; loading: boolean; text?: string | null; error?: string };

export interface ChangedFile extends FileChange {
  add: number;
  del: number;
}

export interface Panels {
  diff: boolean;
  preview: boolean;
  files: boolean;
  terminal: boolean;
  /** Cowork's progress / files / context card. */
  progress: boolean;
}

/** Everything the renderer knows about one session. */
export interface SessionView {
  meta: SessionMeta;
  items: Item[];
  loaded: boolean;
  running: boolean;
  t0: number;
  tokens: number;
  statusText: string;
  ctxPct: number | null;
  model: string | null;
  thinking: ThinkingLevel | null;
  levels: ThinkingLevel[];
  commands: SlashCommand[];
  /** Key of the prompt card waiting for the user, if any. */
  waiting: string | null;
  unread: boolean;
  /** This turn's todo card and the latest list (for the Cowork panel). */
  todosKey: string | null;
  lastTodos: Todo[];
  /** Files Claude created or edited (Cowork panel). */
  outputs: { path: string; kind: 'write' | 'edit'; t: number }[];
  term: { cmd: string; out: string }[];
  changes: ChangedFile[];
  pr: PrStatus | (PrSummary & Partial<PrStatus>) | null;
  prHidden: boolean;
  files: string[] | null;
  panels: Panels;
  detail: Detail | null;
  previewUrl: string | null;
  /** User items not yet confirmed by pi. */
  pendingUser: string[];
  stopping: boolean;
  /** Bumped when the agent host exits; in-flight work from before must not apply. */
  hostEpoch: number;
  /** Streaming message state. */
  cur: { thinkGroup: string | null; thinkIndex: number; text: string | null } | null;
}
