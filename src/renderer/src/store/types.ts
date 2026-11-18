import type { Attachment, DecodedAttachment } from '@shared/attachments';
import type {
  DiffBase,
  FileChange,
  GitState,
  PrStatus,
  PrSummary,
  PrThread,
  SessionMeta,
  SetupStep,
  SlashCommand,
  QuestionAnswer,
  SpawnTask,
  ThinkingLevel,
  UiRequest,
} from '@shared/protocol';
import type { PeerMessage } from '@shared/peer-message';
import type { PrEvent } from '@shared/pr-event';
import type { ToolState } from '@/lib/tools';
import type { DraftSubmission } from './drafts';

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
      entryId?: string;
      timestamp?: number;
      notice?: string;
      queued?: boolean;
      delivered?: boolean;
      acknowledged?: boolean;
      failed?: boolean;
      exited?: boolean;
      /** What was sent, so a failed delivery can be restored as a draft. */
      submission?: DraftSubmission;
      wire?: string;
    }
  | { kind: 'text'; key: string; text: string; live: boolean; msgTs?: number }
  /**
   * A command the user ran with `!` in the session's own shell. pi keeps it in the conversation, so it
   * arrives from `bashExecution` messages on reload and from `bash_execution_update` events while it runs.
   */
  | {
      kind: 'bash';
      key: string;
      command: string;
      output: string;
      running: boolean;
      exitCode?: number;
      cancelled?: boolean;
      truncated?: boolean;
      fullOutputPath?: string;
      /** `!!`: the transcript keeps it, the model does not see it. */
      excluded?: boolean;
      /** Why the command did not run at all (the host refused it). */
      error?: string;
      at: number;
    }
  | { kind: 'taskEvent'; key: string; text: string }
  | {
      kind: 'peerSend';
      key: string;
      toolCallId: string;
      sessionId?: string;
      text?: string;
      status: 'unconfirmed' | 'queued' | 'sent' | 'failed';
      error?: string;
    }
  | { kind: 'note'; key: string; text: string; level?: 'error' }
  | { kind: 'group'; key: string; thoughts: ThinkStep[]; tools: ToolState[]; open: boolean; userToggled?: boolean }
  | { kind: 'todos'; key: string; items: Todo[] }
  | { kind: 'perm'; key: string; requestId: string | null; toolCallId: string; title: string; resolved: string | null }
  | {
      kind: 'ask';
      key: string;
      requestId: string | null;
      request: UiRequest;
      resolved: string | null;
      answers?: QuestionAnswer[];
      /** Set for `pidesk_ask_question`, whose card starts at the tool call. */ toolCallId?: string;
    }
  | {
      kind: 'plan';
      key: string;
      toolCallId: string | null;
      title: string;
      md: string;
      requestId: string | null;
      resolved: string | null;
    }
  /** Tasks the agent suggests; what the user did with each lives in `meta.suggestions`. */
  | { kind: 'suggest'; key: string; toolCallId: string; tasks: SpawnTask[] }
  /**
   * A compaction checkpoint: the summary is what the model keeps, and the messages above it are
   * the history it replaces. Those start hidden behind "show earlier messages".
   */
  | {
      kind: 'compaction';
      key: string;
      summary: string;
      tokensBefore?: number;
      tokensAfter?: number;
      /** The earlier messages are shown. */ open: boolean;
      /** Messages pi dropped, not in the transcript yet; fetched when they are shown. */ hidden: number;
      loading?: boolean;
      /** The summary body is expanded. */ openSummary: boolean;
    }
  /**
   * An idle rebuild: the card the model was handed, and the messages that left its context. Those sit
   * above the card and stay hidden until asked for, exactly like a compaction's history.
   */
  | {
      kind: 'handoff';
      key: string;
      idle: string;
      tokensBefore?: number;
      open: boolean;
      hidden: number;
      loading?: boolean;
    }
  /** A turn the PR watcher started: shown as an incoming event, never as something the user typed. */
  | { kind: 'prEvent'; key: string; event: PrEvent; at: number }
  | { kind: 'foot'; key: string; t: number; usage?: string };

export type ItemOf<K extends Item['kind']> = Extract<Item, { kind: K }>;

export type Detail =
  | { type: 'plan'; key: string }
  | { type: 'agent'; toolCallId: string }
  | {
      type: 'file';
      path: string;
      line: number;
      start?: number;
      loading: boolean;
      text?: string | null;
      error?: string;
      image?: string | null;
      media?: { kind: 'audio' | 'video'; src: string } | null;
    };

/** A file open in the Files card. A tab nobody double-clicked is a preview: the next single click replaces it. */
export interface FileTab {
  path: string;
  pinned: boolean;
}

export type ChangedFile = FileChange;

export type DiffScope = DiffBase['kind'];

/** A file changed by the current conversation turn, including the content available from its tool result. */
export interface SessionChange extends ChangedFile {
  before: string | null;
  after: string | null;
}

/** The cards the workspace can show beside the conversation. */
export type CardId = 'progress' | 'tasks' | 'diff' | 'preview' | 'detail' | 'files' | 'terminal';

/** The two tool columns of the workspace. */
export type Column = 'primary' | 'secondary';

/** Where a dragged card lands relative to the card it is dropped on: above/below it, or in the left/right column. */
export type DropPlace = 'before' | 'after' | 'left' | 'right';

/** Where the user dragged the cards: the order of each column. Cards not listed keep their default place. */
export type Arrangement = Record<Column, CardId[]>;

export interface Panels {
  diff: boolean;
  preview: boolean;
  files: boolean;
  terminal: boolean;
  /** Work's progress / files / context card. */
  progress: boolean;
  /** Background tasks (running and finished subagents). */
  tasks: boolean;
}

/** Everything the renderer knows about one session. */
export interface SessionView {
  meta: SessionMeta;
  items: Item[];
  queuedPeers: PeerMessage[];
  loaded: boolean;
  running: boolean;
  /** A manual or automatic compaction is running: the session is busy, but not in a turn. */
  compacting: boolean;
  t0: number;
  /** Output tokens emitted during this turn, reconciled with the provider's final usage when available. */
  tokens: number;
  /** Visible output tokens emitted during assistant streams in this turn. */
  streamTokens: number;
  /** Milliseconds spent in assistant thinking/text streams during this turn. */
  streamMs: number;
  /** Visible output tokens accumulated across completed turns in this session. */
  sessionTokens: number;
  /** Assistant stream time accumulated across completed turns in this session. */
  sessionStreamMs: number;
  statusText: string;
  ctxPct: number | null;
  /** Cache hit rate of the session's prompt tokens, 0-1; null when the provider reported none. */
  cacheRate: number | null;
  /** Session spend in dollars so far; null until the session has reported stats. */
  cost: number | null;
  model: string | null;
  thinking: ThinkingLevel | null;
  levels: ThinkingLevel[];
  commands: SlashCommand[];
  /** Key of the prompt card waiting for the user, if any. */
  waiting: string | null;
  unread: boolean;
  /** Latest checklist for the Work panel, independent of transcript snapshots. */
  lastTodos: Todo[];
  /** Files Pi Desktop created or edited (Work panel). */
  outputs: { path: string; kind: 'write' | 'edit'; t: number }[];
  /** Files listed or changed during the current user turn, for the transcript summary. */
  turnOutputs: { path: string; kind: 'write' | 'edit'; t: number }[];
  /** Files changed during the current user turn, for the transcript summary. */
  turnChanges: SessionChange[];
  /** The cumulative session changes, used as the Diff source outside git repositories. */
  sessionChanges: SessionChange[];
  /** The cumulative session-base diff when the session is in a git repository. */
  changes: ChangedFile[];
  /** Every successful Git refresh also invalidates comparisons against other bases. */
  changesVersion: number;
  /** Diff-only view selection, kept when the card closes or changes layout. */
  diffScope: DiffScope;
  /** Null follows the session base; a picked ref never changes the PR's target. */
  diffBranch: string | null;
  /** Live git state for the branch bar: uncommitted paths and unpushed commits. */
  gitState: GitState | null;
  pr: PrStatus | (PrSummary & Partial<PrStatus>) | null;
  /** Inline review threads of the PR, drawn in the Diff panel. */
  prThreads: PrThread[];
  prHidden: boolean;
  files: string[] | null;
  /** The Files card's tabs; `detail` is the one showing. */
  fileTabs: FileTab[];
  panels: Panels;
  arrangement: Arrangement;
  /** Card blown up over the whole workspace, remembered per session like the panels. */
  expanded: CardId | null;
  /** The expanded card covers the conversation too, not just the workspace. */
  expandedWide: boolean;
  detail: Detail | null;
  previewUrl: string | null;
  /** User items not yet confirmed by pi. */
  pendingUser: string[];
  /** A renderer-only request to return the transcript to the newest message after sending. */
  scrollRequest: string | null;
  /** Bumped whenever a caller asks the open Diff panel to jump to a file or thread. */
  diffRequest: number;
  stopping: boolean;
  historyBusy: boolean;
  /** Start-up progress while the session is being made ready; null once it is. */
  setup: SetupStep[] | null;
  /** Bumped when the agent host exits; in-flight work from before must not apply. */
  hostEpoch: number;
  /** Streaming message state. */
  cur: {
    thinkGroup: string | null;
    thinkIndex: number;
    text: string | null;
    streamChars: number;
    streamTextChars: number;
    streamTokens: number;
    streamT0: number;
  } | null;
}
