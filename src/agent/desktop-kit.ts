/**
 * desktop-kit — the pi extension that gives sessions the capabilities the desktop
 * UI expects but pi does not ship by default:
 *   - Permission modes (auto / default / acceptEdits / plan / bypass) gated in `tool_call`
 *   - Output styles appended to the system prompt in `before_agent_start`
 *   - `pidesk_todo_write`      task checklist the UI renders as a todo card
 *   - `pidesk_exit_plan_mode`  plan approval when running in plan mode
 *   - `pidesk_ask_question`    one or more multiple-choice questions (with optional previews) for the user
 *   - `task`            read-only subagent with a fresh context (optionally in the background)
 *   - `pidesk_bg_shell`        long-running shell command in the background, with `pidesk_bg_output` / `pidesk_bg_kill`
 *
 * Each session gets its own instance through `createDesktopKit(host)`. The host owns
 * the state (so the UI can change the mode at any moment, even mid-run) and turns
 * `ask()` into a permission or plan card in the transcript.
 */
import { isAbsolute, relative, resolve } from 'node:path';
import { statSync } from 'node:fs';
import {
  createBashToolDefinition, createLocalBashOperations, createLocalPowerShellOperations,
  type ExtensionAPI, type ExtensionContext, type ExtensionFactory, type ExtensionToolContext, type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { AGENT_TYPES, DEFAULT_AGENT, type AgentType } from './agents';
import { ShellCommands, commandInFolder } from './shell-session';
import { registerManageTools, type ArtifactHost, type CustomizeHost, type PetHost, type ProjectHost, type ScheduleHost, type SettingsHost } from './manage-tools';
import type { WebSearch } from './web-search';
import { ENGINE_INFO, SEARCH_FRESHNESS, WEB_LIMITS } from '@shared/web-search';
import {
  PLAN_CHOICES, QUESTION_LIMITS,
  type OutputStyle, type PermissionMode, type Question, type QuestionAnswer, type SessionKind, type ShellSessionMode, type SubagentProgress, type TaskUpdate, type UiRequestInput, type UiResponse,
} from '@shared/protocol';

/** First words of the hidden message injected in plan mode (the demo model looks for it). */
export const PLAN_MODE_MARKER = '[pi-desktop] You are in PLAN MODE.';
/** Distinctive phrase of the Work system prompt (the demo model looks for it). */
export const WORK_MARKER = 'You are running in Work';

export interface KitState {
  mode: PermissionMode;
  profile: SessionKind;
  outputStyle: OutputStyle;
  /** "Always allow" command prefixes for this session. */
  allowed: Set<string>;
}

export type KitRequest = Extract<UiRequestInput, { kind: 'permission' | 'plan' | 'questions' }>;
interface PlanDetails {
  status: 'skipped' | 'approved' | 'keep';
  mode?: PermissionMode;
}

export interface SubagentStats {
  commands: number;
  reads: number;
  searches: number;
  failed: number;
}
export interface SubagentRun {
  /** The `task` tool call id, so the UI can stop this one subagent. */
  id: string;
  prompt: string;
  /** Identity from `agents.ts`. */
  agent: string;
  /** Only what the subagent needs, so a background run never touches a stale context. */
  ctx: Pick<ExtensionContext, 'cwd' | 'model'>;
  signal: AbortSignal | undefined;
  onProgress: (stats: SubagentStats, progress: SubagentProgress) => void;
}

export interface KitHost {
  state: KitState;
  /** The folder this session runs in (a worktree folder for worktree sessions); the shell's default. */
  cwd?: string;
  /** How the model's shell commands keep their folder; read for every command (see `SHELL_SESSION_MODES`). */
  shellSession?: () => ShellSessionMode;
  /** Ask the user. Resolves `{ cancelled: true }` when nobody can answer. */
  ask(request: KitRequest, signal?: AbortSignal): Promise<UiResponse>;
  /** Called when the kit itself changes the mode (plan approval, "Always allow" on an edit). */
  setMode(mode: PermissionMode): void;
  /** Runs a subagent and returns its report; omit it to leave out the `task` tool. */
  runSubagent?(run: SubagentRun): Promise<string>;
  /** The project's other sessions; omit it to leave out the session tools (subagents have none). */
  peers?: {
    list(): { id: string; title: string; status: string; branch: string | null; updatedAt: number }[];
    read(id: string, limit: number): { role: string; text: string }[];
    send(id: string, text: string): Promise<'delivered' | 'queued'>;
  };
  /** Renames this session; omit it (subagents) to leave out the rename tool. */
  rename?(title: string): void;
  /** The subagent identities to offer (built-in plus the user's); the built-ins when omitted. */
  agents?(): AgentType[];
  /** Pushes the progress of a background task to the UI (its tool call has already returned). */
  taskUpdate?(update: TaskUpdate): void;
  /** Lets the UI stop a background task by its tool call id; returns the untrack function. */
  trackTask?(id: string, stop: AbortController): () => void;
  /** The Scheduled page's backend; omit it (subagents) to leave out the scheduling tools. */
  schedule?: ScheduleHost;
  /** The Customize page's backend; omit it (subagents) to leave out the customize tools. */
  customize?: CustomizeHost;
  /** The custom pet skins; omit it (subagents) to leave out the pet tools. */
  pets?: PetHost;
  /** App settings the model may change; present only when the user switched that on, and omitted for subagents. */
  settings?: SettingsHost;
  /** The saved artifacts; omit it (subagents) to leave out the artifact tools. */
  artifacts?: ArtifactHost;
  /** Web search and page fetching with the user's keys; omit it (subagents) to leave out the web tools. */
  web?: WebSearch;
  /** The project this session runs in (Work or Code): its standing context each turn, and its memory; omit it for sessions in no project. */
  project?: {
    context(): string | null;
    remember(input: { note?: string; rewrite?: string }): number;
    /** Read and edit the project's page fields; present only when the user switched that on. */
    manage?: ProjectHost;
  };
}

// Appended to the system prompt for the current turn. These change how Pi Desktop talks,
// not what it is allowed to do (permission modes still decide that).
export const STYLE_PROMPTS: Record<Exclude<OutputStyle, 'default'>, string> = {
  proactive: `# Output style: Proactive
Start work immediately instead of asking about routine decisions. Make reasonable assumptions, state them briefly, and keep going. Do not pause for confirmation on reversible, in-scope work. Destructive actions, security warnings, and permission requests still require the normal safeguards.`,
  concise: `# Output style: Concise
Lead with the result. Omit preambles, restatements of the request, narration of what you are about to do, and closing recaps. Prefer short paragraphs and tight bullets. Full detail is still required for errors, security warnings, destructive-action confirmations, and whenever the user asks for an explanation.`,
  explanatory: `# Output style: Explanatory
While working, explain implementation choices and relevant codebase patterns in brief "Insight" asides: what you chose, the alternative, and why. Keep them short and skippable, and do not let them interrupt the flow of the work.`,
  learning: `# Output style: Learning
Work collaboratively and teach as you go. Explain key concepts in plain language, and when a small piece of the work is a good learning exercise, leave a clearly scoped \`TODO(human)\` marker with instructions instead of completing that piece. Keep making progress on everything else; ask before handing over larger chunks.`,
};

const READ_ONLY_TOOLS = new Set([
  'read', 'grep', 'find', 'ls', 'pidesk_todo_write', 'pidesk_exit_plan_mode', 'pidesk_ask_question', 'pidesk_task', 'pidesk_bg_output', 'pidesk_bg_kill', 'tool_search', 'codemode',
  // Nothing here changes anything: a suggestion is only shown to the user, and the session tools below only look.
  'pidesk_suggest_task', 'pidesk_list_sessions', 'pidesk_read_session',
  // Only changes the label shown in the session list.
  'pidesk_rename_session',
  // Only writes the project's notes, which the user sees and edits on the Projects page.
  'pidesk_remember',
  // Look things up on the public web; the fetch refuses local and private network addresses.
  'pidesk_web_search', 'pidesk_web_fetch',
]);
const EDIT_TOOLS = new Set(['edit', 'write']);
const SHELL_TOOLS = new Set(['bash', 'powershell', 'pidesk_bg_shell']);

// Commands that only inspect state. Anything else (including running tests) counts as execution.
const SAFE_COMMANDS = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'wc', 'ls', 'pwd', 'tree', 'find', 'grep', 'rg', 'fd', 'echo',
  'which', 'file', 'stat', 'du', 'df', 'date', 'uname', 'whoami', 'printenv', 'sort', 'uniq', 'cut', 'diff',
]);
const SAFE_GIT = new Set(['status', 'log', 'diff', 'show', 'branch', 'rev-parse', 'ls-files', 'blame', 'remote']);
const RISKY = [
  /\bgit\s+push\b/, /\bgh\s+(pr\s+(create|merge|close)|release|repo\s+delete)\b/, /\bnpm\s+publish\b/,
  /\brm\s+-[a-z]*r/i, /\bsudo\b/, /\bgit\s+reset\s+--hard\b/, /\bgit\s+clean\b/, /\bchmod\s+(-R\s+)?777\b/,
  /\b(curl|wget)\b[^|]*\|\s*(ba|z)?sh\b/, /\bmkfs\b/, /\bdd\s+if=/, /\bgit\s+checkout\s+--\s/,
];
// Work works in the user's own folders (documents, downloads…), so anything that
// deletes, moves or sends data away also needs approval.
const WORK_RISKY = [
  /\b(rm|rmdir|mv|del|erase|unlink|shred|truncate)\b/, /\bfind\b.*-delete\b/, /\b(scp|rsync|sftp|ftp)\b/,
  /\b(curl|wget)\b.*(-X\s*(POST|PUT|PATCH|DELETE)|--data|\s-d\s|\s-F\s|--upload-file|\s-T\s)/, /\b(sendmail|mail|mutt)\b/,
];

export function isReadOnlyCommand(command: string): boolean {
  // Blank out quoted arguments so operators inside them (grep "a\|b") are not treated as pipes.
  const bare = command.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, "''");
  if (/[>`]|\$\(/.test(bare)) return false;
  return bare
    .split(/&&|\|\||;|\|/)
    .map((s) => s.trim())
    .filter(Boolean)
    .every((seg) => {
      const [cmd, sub] = seg.split(/\s+/);
      if (cmd === 'git') return SAFE_GIT.has(sub ?? '');
      if (cmd === 'sed') return !/\s-i\b/.test(seg);
      return SAFE_COMMANDS.has(cmd);
    });
}
export const isRiskyCommand = (command: string, profile: SessionKind = 'code') =>
  RISKY.some((r) => r.test(command)) || (profile === 'work' && WORK_RISKY.some((r) => r.test(command)));
export const commandKey = (command: string) => command.trim().split(/\s+/).slice(0, 2).join(' ');

const DENIED = 'The user denied this tool call. Ask how they want to proceed.';

/** A `workdir` the model asked for: resolved against the session folder, and refused when it is not a folder. */
function workdirOf(base: string, workdir: string | undefined): string | undefined {
  const wanted = typeof workdir === 'string' ? workdir.trim() : '';
  // A model that leaves the optional argument out can still send `null`, which reaches us as the
  // string "null" (the harness stringifies optional parameters). Neither of those names a folder.
  if (!wanted || wanted === 'null' || wanted === 'undefined') return undefined;
  const folder = resolve(base, wanted);
  let ok = false;
  try { ok = statSync(folder).isDirectory(); } catch { /* missing: reported below */ }
  if (!ok) throw new Error(`workdir is not a folder: ${folder}`);
  return folder;
}

/** The same tool context with another folder, without freezing the guarded getters a spread would read. */
const inFolder = (ctx: ExtensionToolContext, cwd: string): ExtensionToolContext =>
  Object.create(ctx, { cwd: { value: cwd, enumerable: true, configurable: true } }) as ExtensionToolContext;

/** Whether two paths are the same folder (a shell reports `$PWD`, which may be the symlinked spelling). */
function sameFolder(a: string, b: string): boolean {
  if (a === b) return true;
  try { return statSync(a).ino === statSync(b).ino && statSync(a).dev === statSync(b).dev; } catch { return false; }
}

/**
 * `cd <folder> && …` where the shell is already in that folder: models write the prefix out of habit
 * and nothing tells them it was a no-op. Detecting it lets the result say so, which is the only
 * signal that reaches the next turn without rewriting what the user sees.
 */
function redundantCd(command: string, at: string, base: string): boolean {
  const found = /^\s*cd\s+(?:--\s+)?('[^']*'|"[^"]*"|[^\s&;|<>]+)\s*&&/.exec(command);
  if (!found) return false;
  const folder = found[1].replace(/^(['"])(.*)\1$/, '$2');
  try { return sameFolder(resolve(base, folder), at); } catch { return false; }
}

/**
 * pi's description opens with "in the current working directory", which invites a `cd <folder> && …`
 * prefix on every command — the noise a shell that keeps its folder does not need. Lead with where
 * the shell is instead, and keep pi's own truncation and timeout notes after it.
 */
function shellDescription(definition: ToolDefinition<any, any, any>): string {
  const rest = definition.description.replace(/^Execute a \S+ command in the current working directory\.\s*/, '');
  return `Execute a bash command in the shell's folder. The shell keeps that folder between commands: \`cd\` once instead of prefixing every command, and pass \`workdir\` to run one command elsewhere. ${rest}`;
}

/**
 * pi's `bash` definition plus a `workdir` argument, running through the shell backend the caller
 * supplies. Truncation, renderers and the output schema come from pi's own definition, so the tool
 * keeps behaving like the built-in one.
 */
function shellToolDefinition(
  definition: ToolDefinition<any, any, any>,
  shells: ShellCommands,
  mode: () => ShellSessionMode,
  sessionCwd: string,
): ToolDefinition {
  return {
    ...definition,
    // bash is on pi's default list; staying off registration keeps a session that dropped it without it.
    defaultActive: false,
    description: shellDescription(definition),
    promptGuidelines: [
      ...(definition.promptGuidelines ?? []),
      'Do not prefix a command with `cd <the session folder> &&`: the shell already starts there, and the prefix only hides what runs.',
      'The shell keeps its folder between commands, so `cd` once into a subfolder instead of repeating it. A result that ends with `[shell folder: …]` means the shell is somewhere other than the session folder — check that line before relying on relative paths.',
      'Pass `workdir` (relative to the session folder, or absolute) to run one command in a subfolder without moving the shell.',
    ],
    parameters: Type.Object({
      command: Type.String({ description: 'Shell command to execute' }),
      timeout: Type.Optional(Type.Number({ description: 'Timeout in seconds (optional, no default timeout)' })),
      workdir: Type.Optional(Type.String({ description: 'Folder to run in: relative to the session folder, or absolute. Defaults to where the shell is.' })),
    }),
    async execute(id, params, signal, onUpdate, ctx) {
      const input = params as { command: string; timeout?: number; workdir?: string };
      const root = ctx.cwd || sessionCwd;
      const folder = workdirOf(root, input.workdir);
      const keeps = mode() === 'session';
      // Where the command starts: the shared shell's folder, or the one a process of its own gets.
      const before = keeps ? shells.cwd ?? root : folder ?? root;
      // The shared shell cannot move for one command, so a subshell takes the `cd` instead;
      // a shell of its own can simply start in the folder.
      const command = folder && keeps ? commandInFolder(input.command, folder) : input.command;
      const result = await definition.execute(
        id,
        { command, timeout: input.timeout },
        signal,
        onUpdate,
        folder && !keeps ? inFolder(ctx, folder) : ctx,
      );

      const notes: string[] = [];
      const failure = shells.takeStartFailure();
      if (failure) notes.push(`[The shared shell did not start (${failure}); each command now runs in its own process.]`);
      const at = keeps ? shells.cwd : folder;
      if (at && !sameFolder(at, root)) notes.push(`[shell folder: ${at}]`);
      // Said after the result, not instead of it: the command ran as written, the prefix just did nothing.
      if (keeps && before && redundantCd(input.command, before, root)) notes.push('[The shell was already in that folder, so the `cd` did nothing — a bare command is enough.]');
      if (!notes.length) return result;
      return { ...result, content: [...result.content, ...notes.map((text) => ({ type: 'text' as const, text: `\n${text}` }))] };
    },
  } as ToolDefinition;
}

function describeAnswer(a: QuestionAnswer | undefined): string {
  if (!a || (!a.selected.length && !a.other)) return '(no answer)';
  const parts = a.selected.map((s) => `"${s}"`);
  if (a.other) parts.push(`their own answer: "${a.other}"`);
  return parts.join(', ');
}

export function createDesktopKit(host: KitHost): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    const state = host.state;

    // ---------------------------------------------------------------- permissions
    const ask = async (ctx: ExtensionContext, toolCallId: string, title: string, key?: string) => {
      const answer = await host.ask({ kind: 'permission', toolCallId, title }, ctx.signal);
      if (answer.cancelled && !answer.value) return { block: true, reason: 'Approval required but nobody answered the prompt.' };
      if (answer.value === 'Always allow') {
        if (key) state.allowed.add(key);
        else host.setMode('acceptEdits'); // "always allow" on an edit = accept edits for this session
        return undefined;
      }
      if (answer.value === 'Allow') return undefined;
      return { block: true, reason: DENIED };
    };

    pi.on('tool_call', async (event, ctx) => {
      const mode = state.mode;
      if (mode === 'bypass') return undefined;
      const name = event.toolName;
      const input = event.input as Record<string, unknown>;

      if (READ_ONLY_TOOLS.has(name)) return undefined;

      if (EDIT_TOOLS.has(name)) {
        if (mode === 'plan') return { block: true, reason: 'Plan mode is read-only. Present your plan with pidesk_exit_plan_mode.' };
        const abs = resolve(ctx.cwd, String(input.path ?? ''));
        const rel = relative(ctx.cwd, abs);
        const outside = rel.startsWith('..') || isAbsolute(rel);
        if (!outside && (mode === 'auto' || mode === 'acceptEdits')) return undefined;
        return ask(ctx, event.toolCallId, `${outside ? 'Edit outside the project' : name === 'write' ? 'Create' : 'Edit'} ${input.path}`);
      }

      if (SHELL_TOOLS.has(name)) {
        const command = String(input.command ?? '');
        const readOnly = isReadOnlyCommand(command);
        if (mode === 'plan') return readOnly ? undefined : { block: true, reason: 'Plan mode only allows read-only commands.' };
        if (readOnly || state.allowed.has(commandKey(command))) return undefined;
        if (mode === 'auto' && !isRiskyCommand(command, state.profile)) return undefined;
        return ask(ctx, event.toolCallId, `Run ${command}`, commandKey(command));
      }

      // MCP and other extension tools: trust their annotations.
      const hints = pi.getAllTools().find((t) => t.name === name)?.annotations;
      if (hints?.readOnlyHint) return undefined;
      if (mode === 'plan') return { block: true, reason: `Plan mode blocks ${name}.` };
      if (mode === 'auto' && hints?.destructiveHint !== true) return undefined;
      if (state.allowed.has(`tool:${name}`)) return undefined;
      return ask(ctx, event.toolCallId, `Use ${name}`, `tool:${name}`);
    });

    pi.on('before_agent_start', async (event) => {
      const style = state.outputStyle;
      const stylePrompt = style !== 'default' ? STYLE_PROMPTS[style] : null;
      const planMessage =
        state.mode === 'plan'
          ? {
              customType: 'pi-desktop-plan-mode',
              display: false,
              content:
                `${PLAN_MODE_MARKER} Explore the code with read-only tools only. Do not edit files. ` +
                'When you understand the change, call pidesk_exit_plan_mode with a concise markdown plan ' +
                '(Context, Changes as a numbered list, Verification) and wait for approval.',
            }
          : null;
      if (!stylePrompt && !planMessage) return undefined;
      return {
        ...(stylePrompt ? { systemPrompt: `${event.systemPrompt}\n\n${stylePrompt}` } : {}),
        ...(planMessage ? { message: planMessage } : {}),
      };
    });

    // ---------------------------------------------------------------- pidesk_todo_write
    const TodoItem = Type.Object({
      content: Type.String({ description: "Imperative description, e.g. 'Fix the date formatter'" }),
      status: StringEnum(['pending', 'in_progress', 'completed'] as const),
      activeForm: Type.Optional(Type.String({ description: "Present continuous form, e.g. 'Fixing the date formatter'" })),
    });
    pi.registerTool({
      name: 'pidesk_todo_write',
      label: 'Todos',
      description:
        'Create or update the task checklist shown to the user. Send the complete list every time. ' +
        'Use it for work with 3+ steps; keep exactly one item in_progress while working.',
      promptSnippet: 'Track multi-step work with a visible checklist',
      parameters: Type.Object({ todos: Type.Array(TodoItem) }),
      async execute(_id, params) {
        const done = params.todos.filter((t) => t.status === 'completed').length;
        return {
          content: [{ type: 'text', text: `Todo list updated (${done}/${params.todos.length} completed).` }],
          details: { todos: params.todos },
        };
      },
    });

    // ---------------------------------------------------------------- pidesk_exit_plan_mode
    pi.registerTool({
      name: 'pidesk_exit_plan_mode',
      label: 'Plan',
      description: 'In plan mode, present the implementation plan (markdown) to the user for approval.',
      parameters: Type.Object({
        title: Type.String({ description: 'Short plan title' }),
        plan: Type.String({ description: 'The plan in markdown' }),
      }),
      async execute(toolCallId, params, signal): Promise<{ content: { type: 'text'; text: string }[]; details: PlanDetails; terminate?: boolean }> {
        if (state.mode !== 'plan') {
          return { content: [{ type: 'text', text: 'Not in plan mode. Proceed with the task.' }], details: { status: 'skipped' } };
        }
        const choice = (await host.ask({ kind: 'plan', toolCallId, title: params.title }, signal)).value;
        if (choice === PLAN_CHOICES[0] || choice === PLAN_CHOICES[1]) {
          host.setMode(choice === PLAN_CHOICES[0] ? 'acceptEdits' : 'default');
          return {
            content: [{ type: 'text', text: 'The user approved the plan. Implement it now, step by step.' }],
            details: { status: 'approved', mode: state.mode },
          };
        }
        return {
          content: [{ type: 'text', text: 'The user wants to keep refining the plan. Stop and wait for their feedback.' }],
          details: { status: 'keep' },
          terminate: true,
        };
      },
    });

    // ---------------------------------------------------------------- pidesk_ask_question
    const Option = Type.Object({
      label: Type.String({ description: 'Short choice text (1-5 words)' }),
      description: Type.Optional(Type.String({ description: 'One sentence on what this choice means or implies' })),
      preview: Type.Optional(Type.String({ description: 'Markdown shown beside the options when this one is highlighted (a code sketch, config, layout). Single-select only.' })),
    });
    pi.registerTool({
      name: 'pidesk_ask_question',
      label: 'Ask question',
      description:
        'Ask the user one or more multiple-choice questions and wait for the answers. Use it when a decision is genuinely theirs ' +
        '(a design direction, a trade-off, which of several approaches) and you cannot settle it from the request or the code. ' +
        'Users can always type their own answer, so do not add an "Other" option. Put your recommended option first and end its label with "(Recommended)". ' +
        'Do not use it to ask "should I continue?" or for things you can look up.',
      promptSnippet: 'Ask the user multiple-choice questions when a decision is theirs',
      parameters: Type.Object({
        questions: Type.Array(
          Type.Object({
            question: Type.String({ description: 'The complete question, ending with a question mark' }),
            header: Type.String({ description: `Very short tab label, at most ${QUESTION_LIMITS.header} characters` }),
            multiSelect: Type.Optional(Type.Boolean({ description: 'Allow several answers (previews are ignored then)' })),
            options: Type.Array(Option, { minItems: QUESTION_LIMITS.optionsMin, maxItems: QUESTION_LIMITS.optionsMax }),
          }),
          { minItems: 1, maxItems: QUESTION_LIMITS.questions },
        ),
      }),
      async execute(toolCallId, params, signal): Promise<{ content: { type: 'text'; text: string }[]; details: { status: 'answered' | 'cancelled'; answers?: QuestionAnswer[] } }> {
        const questions: Question[] = params.questions.map((q) => ({
          question: q.question,
          header: q.header.slice(0, QUESTION_LIMITS.header),
          multiSelect: !!q.multiSelect,
          options: q.options.map((o) => ({ label: o.label, description: o.description, preview: q.multiSelect ? undefined : o.preview })),
        }));
        const title = questions.map((q) => q.question).join('\n');
        const reply = await host.ask({ kind: 'questions', toolCallId, title, questions }, signal);
        if (reply.cancelled || !reply.answers) {
          return {
            content: [{ type: 'text', text: 'The user dismissed the questions without answering. Do not guess: stop and ask in plain text, or continue with the safest option and say so.' }],
            details: { status: 'cancelled' },
          };
        }
        const lines = questions.map((q, i) => `- ${q.question}\n  → ${describeAnswer(reply.answers![i])}`);
        return {
          content: [{ type: 'text', text: `The user answered:\n${lines.join('\n')}` }],
          details: { status: 'answered', answers: reply.answers },
        };
      },
    });

    // ---------------------------------------------------------------- pidesk_suggest_task
    pi.registerTool({
      name: 'pidesk_suggest_task',
      label: 'Suggest task',
      description:
        'Offer the user a separate task when you notice work that is outside what they asked for (an unrelated bug, a follow-up refactor, a missing test). ' +
        'It appears as a card with Start / Do it here buttons and runs nothing by itself. Keep working on the current task; do not wait for an answer.',
      promptSnippet: 'Suggest side tasks to the user instead of doing unrelated work',
      promptGuidelines: [
        'When you find unrelated work worth doing, call pidesk_suggest_task with a self-contained prompt instead of expanding the current task.',
      ],
      parameters: Type.Object({
        tasks: Type.Array(
          Type.Object({
            title: Type.String({ description: 'Short title, under 60 characters' }),
            prompt: Type.String({ description: 'Complete, self-contained instructions: the new session knows nothing about this conversation' }),
          }),
          { minItems: 1, maxItems: 5 },
        ),
      }),
      annotations: { readOnlyHint: true },
      async execute(_id, params) {
        return {
          content: [{ type: 'text', text: `Suggested ${params.tasks.length} task${params.tasks.length > 1 ? 's' : ''} to the user. Carry on with the current task; they decide whether to start it.` }],
          details: { tasks: params.tasks },
        };
      },
    });

    // ---------------------------------------------------------------- pidesk_rename_session
    const rename = host.rename;
    if (rename) {
      pi.registerTool({
        name: 'pidesk_rename_session',
        label: 'Rename session',
        description:
          'Change the name of this session, shown in the session list. Use it when the user asks for a different name, ' +
          'or when the work has moved on so far that the current name is misleading. Keep it short (under 60 characters).',
        parameters: Type.Object({ title: Type.String({ description: 'The new session name' }) }),
        async execute(_id, params) {
          const title = params.title.trim().slice(0, 80);
          if (!title) throw new Error('The name cannot be empty');
          rename(title);
          return { content: [{ type: 'text', text: `Session renamed to "${title}".` }], details: { title } };
        },
      });
    }

    // ---------------------------------------------------------------- pidesk_remember
    const project = host.project;
    if (project) {
      pi.registerTool({
        name: 'pidesk_remember',
        label: 'Project memory',
        description:
          'Save a note to the memory of this project, which every later task in the project sees. Use it for decisions, the preferences of the user, ' +
          'where things live and what is still open; one short fact per call. To tidy a full memory, pass rewrite with the complete new text instead of note.',
        promptSnippet: 'Keep notes about the project for later tasks',
        parameters: Type.Object({
          note: Type.Optional(Type.String({ description: 'One short fact to add' })),
          rewrite: Type.Optional(Type.String({ description: 'The complete memory text, replacing what is there' })),
        }),
        async execute(_id, params) {
          const length = project.remember(params);
          return { content: [{ type: 'text', text: `Saved to project memory (${length} characters).` }], details: { length } };
        },
      });
    }

    // ---------------------------------------------------------------- pidesk_web_search / pidesk_web_fetch
    const web = host.web;
    if (web) {
      pi.registerTool({
        name: 'pidesk_web_search',
        label: 'Web search',
        description:
          'Search the web for current information, documentation or anything outside the project. Returns titles, URLs and snippets; ' +
          'read a promising page in full with pidesk_web_fetch. The search engine is chosen in the user\'s settings, so do not pick one. ' +
          'Write the query like a search box query, add freshness for recent news, and use domains to restrict to given sites.',
        promptSnippet: 'Search the web for current information',
        parameters: Type.Object({
          query: Type.String({ description: 'What to search for' }),
          maxResults: Type.Optional(Type.Number({ description: `How many results, 1-${WEB_LIMITS.maxResults} (default ${WEB_LIMITS.defaultResults})` })),
          freshness: Type.Optional(StringEnum(SEARCH_FRESHNESS, { description: 'Only results from the last day / week / month / year' })),
          domains: Type.Optional(Type.Array(Type.String(), { description: 'Only these sites, e.g. ["docs.python.org"]' })),
        }),
        annotations: { readOnlyHint: true },
        async execute(_id, params, signal) {
          const query = params.query.trim();
          if (!query) throw new Error('The query cannot be empty');
          const maxResults = Math.min(WEB_LIMITS.maxResults, Math.max(1, Math.round(params.maxResults ?? WEB_LIMITS.defaultResults)));
          const { engine, hits, failed } = await web.search({ query, maxResults, freshness: params.freshness, domains: params.domains?.filter(Boolean) }, signal);
          const notes = failed.map((f) => `${ENGINE_INFO[f.engine].label} failed (${f.reason}), so ${ENGINE_INFO[engine].label} was used.`);
          const body = hits.length
            ? hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}${h.date ? ` · ${h.date}` : ''}${h.snippet ? `\n   ${h.snippet}` : ''}`).join('\n\n')
            : 'No results.';
          return { content: [{ type: 'text', text: [...notes, `Results for "${query}" (${ENGINE_INFO[engine].label}):`, body].join('\n\n') }], details: { engine, hits } };
        },
      });

      pi.registerTool({
        name: 'pidesk_web_fetch',
        label: 'Fetch web page',
        description:
          'Download one web page (http or https) and return its text with the links as markdown. Works for pages, plain text and JSON; ' +
          'it cannot reach local or private network addresses and runs no JavaScript. A long page is cut: continue with the offset the result names.',
        promptSnippet: 'Read a web page by URL',
        parameters: Type.Object({
          url: Type.String({ description: 'The page address, starting with http:// or https://' }),
          offset: Type.Optional(Type.Number({ description: 'Character to start from, to continue a page that was cut' })),
          maxChars: Type.Optional(Type.Number({ description: `Characters to return (default ${WEB_LIMITS.pageChars}, at most ${WEB_LIMITS.maxPageChars})` })),
        }),
        annotations: { readOnlyHint: true },
        async execute(_id, params, signal) {
          const page = await web.fetchPage(params.url.trim(), signal);
          const start = Math.max(0, Math.round(params.offset ?? 0));
          const size = Math.min(WEB_LIMITS.maxPageChars, Math.max(1, Math.round(params.maxChars ?? WEB_LIMITS.pageChars)));
          const slice = page.text.slice(start, start + size);
          const end = start + slice.length;
          const head = [page.title && `# ${page.title}`, page.url].filter(Boolean).join('\n');
          const tail = end < page.text.length ? `\n\n[Cut at character ${end} of ${page.text.length}. Continue with offset=${end}.]` : '';
          return { content: [{ type: 'text', text: `${head}\n\n${slice || '(empty page)'}${tail}` }], details: { url: page.url, title: page.title, length: page.text.length } };
        },
      });
    }

    // ---------------------------------------------------------------- scheduled tasks, customize, settings, artifacts and the project
    registerManageTools(pi, {
      schedule: host.schedule,
      customize: host.customize,
      pets: host.pets,
      settings: host.settings,
      artifacts: host.artifacts,
      project: host.project?.manage,
    });

    // ---------------------------------------------------------------- other sessions of the project
    const peers = host.peers;
    if (peers) {
      pi.registerTool({
        name: 'pidesk_list_sessions',
        label: 'Sessions',
        description: 'List the other sessions of this project (id, title, status, branch). Use it to find who to read from or message.',
        parameters: Type.Object({}),
        annotations: { readOnlyHint: true },
        async execute() {
          const list = peers.list();
          const text = list.length
            ? list.map((s) => `- ${s.id} · ${s.title} · ${s.status}${s.branch ? ` · ${s.branch}` : ''} · active ${new Date(s.updatedAt).toISOString()}`).join('\n')
            : 'There are no other sessions in this project.';
          return { content: [{ type: 'text', text }], details: { sessions: list } };
        },
      });
      pi.registerTool({
        name: 'pidesk_read_session',
        label: 'Read session',
        description: 'Read the most recent messages of another session of this project, to see what it is doing or has decided.',
        parameters: Type.Object({
          session_id: Type.String({ description: 'Id from pidesk_list_sessions' }),
          limit: Type.Optional(Type.Number({ description: 'How many recent messages (default 10, at most 30)' })),
        }),
        annotations: { readOnlyHint: true },
        async execute(_id, params) {
          const lines = peers.read(params.session_id, params.limit ?? 10);
          const text = lines.length ? lines.map((l) => `${l.role === 'user' ? 'User' : 'Assistant'}: ${l.text}`).join('\n\n') : 'That session has no messages yet.';
          return { content: [{ type: 'text', text }], details: { session: params.session_id } };
        },
      });
      pi.registerTool({
        name: 'pidesk_send_message',
        label: 'Message session',
        description:
          'Send a message to another session of this project, for example to hand over context or ask for a result. ' +
          'If that session is busy the message waits until its current turn ends. It sees who sent it and may reply the same way; do not start long back-and-forth exchanges.',
        parameters: Type.Object({
          session_id: Type.String({ description: 'Id from pidesk_list_sessions' }),
          message: Type.String({ description: 'The message: self-contained, since that session has not seen this conversation' }),
        }),
        async execute(_id, params) {
          const outcome = await peers.send(params.session_id, params.message);
          return {
            content: [{ type: 'text', text: outcome === 'queued' ? 'That session is busy: the message will be delivered when its current turn ends.' : 'Delivered; that session is now working on it.' }],
            details: { session: params.session_id, outcome },
          };
        },
      });
    }

    // ---------------------------------------------------------------- background tasks
    /** Tell the model a background task is over; it wakes up unless the user stopped it. */
    const notify = (id: string, title: string, state: TaskUpdate['state'], body: string) => {
      try {
        pi.sendMessage(
          {
            customType: 'pi-desktop-task-notification',
            display: false,
            content: `<task-notification id="${id}" status="${state}">\n${title}\n${body}\n</task-notification>`,
          },
          { triggerTurn: state !== 'stopped', deliverAs: 'followUp' },
        );
      } catch {
        // The session this task belonged to is gone (/clear, fork); nobody is left to tell.
      }
    };
    const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}\n…(truncated)` : text);
    const ended = (progress: SubagentProgress, activity: string): SubagentProgress => ({ ...progress, endedAt: Date.now(), activity });

    // ---------------------------------------------------------------- task (subagent)
    const runSubagent = host.runSubagent;
    if (runSubagent) {
      const agents = host.agents?.() ?? AGENT_TYPES;
      pi.registerTool({
        name: 'pidesk_task',
        label: 'Agent',
        description:
          'Delegate a focused, read-only investigation to a subagent with a fresh context. ' +
          'Use it for broad searches or tracing code paths; it returns a written report. ' +
          'Set run_in_background to keep working while it runs: the call returns at once and the report arrives later as a <task-notification> message.',
        promptSnippet: 'Delegate read-only investigations to a subagent',
        parameters: Type.Object({
          description: Type.String({ description: '3-6 word summary shown to the user' }),
          prompt: Type.String({ description: 'Complete, self-contained instructions for the subagent' }),
          subagent_type: Type.Optional(StringEnum(agents.map((a) => a.name) as [string, ...string[]], { description: `Which subagent to use (default ${DEFAULT_AGENT}). ${agents.map((a) => `${a.name}: ${a.description}`).join(' ')}` })),
          run_in_background: Type.Optional(Type.Boolean({ description: 'Return immediately and get the report in a later message' })),
        }),
        annotations: { readOnlyHint: true },
        async execute(id, params, signal, onUpdate, ctx) {
          let stats: SubagentStats = { commands: 0, reads: 0, searches: 0, failed: 0 };
          let progress: SubagentProgress | undefined;
          const { run_in_background: background, ...shown } = params;

          if (background) {
            const run = runSubagent({
              id,
              prompt: params.prompt,
              agent: params.subagent_type ?? DEFAULT_AGENT,
              ctx: { cwd: ctx.cwd, model: ctx.model },
              signal: undefined,
              onProgress: (next, live) => {
                stats = next;
                progress = live;
                host.taskUpdate?.({ toolCallId: id, state: 'running', progress: live, summary: subagentSummary(next) });
              },
            });
            void run.then(
              (text) => {
                const report = text || 'The subagent produced no report.';
                const state = text ? 'done' : 'err';
                const done = ended(progress ?? { startedAt: Date.now(), tokens: 0, toolUses: 0, activity: '', steps: [] }, text ? 'Done' : 'Failed');
                host.taskUpdate?.({ toolCallId: id, state, progress: done, summary: subagentSummary(stats), text: report });
                notify(id, `Background task "${params.description}" finished.`, state, clip(report, 20000));
              },
              (err: Error) => {
                const stopped = /stopped this subagent/.test(err.message);
                const state = stopped ? 'stopped' : 'err';
                const end = ended(progress ?? { startedAt: Date.now(), tokens: 0, toolUses: 0, activity: '', steps: [] }, stopped ? 'Stopped' : 'Failed');
                host.taskUpdate?.({ toolCallId: id, state, progress: end, summary: subagentSummary(stats), text: err.message });
                notify(id, `Background task "${params.description}" ${stopped ? 'was stopped by the user' : 'failed'}.`, state, err.message);
              },
            );
            return {
              content: [{ type: 'text', text: `Started "${params.description}" in the background (task ${id}). Keep working; its report will arrive as a <task-notification> message. Do not poll or wait for it.` }],
              details: { ...shown, background: true },
            };
          }

          const text = await runSubagent({
            id,
            prompt: params.prompt,
            agent: params.subagent_type ?? DEFAULT_AGENT,
            ctx,
            signal,
            onProgress: (next, live) => {
              stats = next;
              progress = live;
              onUpdate?.({ content: [{ type: 'text', text: subagentSummary(stats) }], details: { ...shown, stats, progress, text: '' } });
            },
          });
          if (signal?.aborted) throw new Error('Subagent aborted');
          if (!text) throw new Error('Subagent produced no report');
          return {
            content: [{ type: 'text', text: clip(text, 20000) }],
            details: { ...shown, stats, progress, summary: subagentSummary(stats), text },
          };
        },
      });
    }

    // ---------------------------------------------------------------- bash
    //
    // pi's own `bash` with a `workdir` argument, running through a shell that stays alive between
    // commands (Settings → Code → Shell for commands) unless the user turned that off.
    //
    // Registered when the session starts rather than while this extension loads: pi's settings —
    // the shell path and the command prefix — are not readable before that.
    let shellPath: string | undefined;
    const shellMode = () => host.shellSession?.() ?? 'session';
    const sessionCwd = host.cwd ?? process.cwd();
    const shellBackend = new ShellCommands({ shellPath: () => shellPath, mode: shellMode });
    pi.on('session_shutdown', () => shellBackend.dispose());
    pi.on('session_start', () => {
      const settings = (pi.getSettings() ?? {}) as { shellPath?: string; shellCommandPrefix?: string };
      shellPath = settings.shellPath;
      pi.registerTool(shellToolDefinition(
        createBashToolDefinition(sessionCwd, { operations: shellBackend.operations, commandPrefix: settings.shellCommandPrefix }),
        shellBackend,
        shellMode,
        sessionCwd,
      ));
    });

    // ---------------------------------------------------------------- pidesk_bg_shell
    interface ShellTask { command: string; output: string; state: TaskUpdate['state']; exitCode?: number | null; startedAt: number; stop: AbortController }
    const shells = new Map<string, ShellTask>();
    const OUTPUT_CAP = 200_000;
    const SHOWN_TAIL = 16_000;
    const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
    const shellOps = process.platform === 'win32' ? createLocalPowerShellOperations() : createLocalBashOperations();
    const shellUpdate = (id: string, t: ShellTask): TaskUpdate => ({
      toolCallId: id,
      state: t.state,
      summary: t.state === 'running' ? 'running' : `exit ${t.exitCode ?? '?'}`,
      progress: {
        startedAt: t.startedAt, endedAt: t.state === 'running' ? undefined : Date.now(), tokens: 0, toolUses: 0, steps: [],
        activity: t.state === 'running' ? 'Running a command' : t.state === 'stopped' ? 'Stopped' : t.state === 'err' ? 'Failed' : 'Done',
      },
      shell: { output: t.output.slice(-SHOWN_TAIL), exitCode: t.exitCode },
    });

    pi.registerTool({
      name: 'pidesk_bg_shell',
      label: 'Shell',
      description:
        'Start a long-running shell command (dev server, watcher, slow build or test run) in the background. ' +
        'It returns at once with a task id; read output with pidesk_bg_output, stop it with pidesk_bg_kill. ' +
        'When the command exits you get a <task-notification> message that starts your next turn, so end the turn after starting it: ' +
        'never `sleep`, poll or re-run the command to wait. Use the normal shell tool for short commands.',
      promptSnippet: 'Run long-lived shell commands in the background',
      parameters: Type.Object({
        command: Type.String({ description: 'The command to run' }),
        description: Type.Optional(Type.String({ description: '3-6 word summary shown to the user' })),
        workdir: Type.Optional(Type.String({ description: 'Folder to run in: relative to the session folder, or absolute' })),
      }),
      async execute(id, params, _signal, _onUpdate, ctx) {
        const folder = workdirOf(ctx.cwd, params.workdir);
        const task: ShellTask = { command: params.command, output: '', state: 'running', startedAt: Date.now(), stop: new AbortController() };
        shells.set(id, task);
        const untrack = host.trackTask?.(id, task.stop);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const push = () => {
          timer = undefined;
          host.taskUpdate?.(shellUpdate(id, task));
        };
        const title = params.description || params.command;
        shellOps
          .exec(params.command, folder ?? ctx.cwd, {
            signal: task.stop.signal,
            onData: (chunk) => {
              task.output = (task.output + chunk.toString('utf8').replace(ANSI, '')).slice(-OUTPUT_CAP);
              timer ??= setTimeout(push, 400);
            },
          })
          .then(
            ({ exitCode }) => {
              task.exitCode = exitCode;
              task.state = task.stop.signal.aborted ? 'stopped' : exitCode === 0 ? 'done' : 'err';
            },
            (err: Error) => {
              task.output += `\n${err.message}`;
              task.state = task.stop.signal.aborted ? 'stopped' : 'err';
            },
          )
          .then(() => {
            untrack?.();
            if (timer) clearTimeout(timer);
            push();
            const how = task.state === 'stopped' ? 'was stopped by the user' : `exited with code ${task.exitCode ?? 'unknown'}`;
            notify(id, `Background command "${title}" ${how}.`, task.state, `Last output:\n${task.output.slice(-4000) || '(no output)'}`);
          });
        return {
          content: [{ type: 'text', text: `Started \`${params.command}\` in the background (task ${id}). Use pidesk_bg_output to read its output and pidesk_bg_kill to stop it; you will be notified when it exits, so end the turn instead of sleeping or polling.` }],
          details: { description: title, command: params.command, background: true },
        };
      },
    });

    pi.registerTool({
      name: 'pidesk_bg_output',
      label: 'Shell output',
      description: 'Read the latest output of a background shell command started with pidesk_bg_shell.',
      parameters: Type.Object({
        id: Type.String({ description: 'The task id returned by pidesk_bg_shell' }),
        tail: Type.Optional(Type.Number({ description: 'Characters from the end to return (default 8000)' })),
      }),
      annotations: { readOnlyHint: true },
      async execute(_id, params) {
        const task = shells.get(params.id);
        if (!task) throw new Error(`No background shell with id ${params.id}`);
        const status = task.state === 'running' ? 'running' : `finished (${task.state}, exit code ${task.exitCode ?? 'unknown'})`;
        const out = task.output.slice(-Math.max(1, Math.min(params.tail ?? 8000, 50_000)));
        return { content: [{ type: 'text', text: `Status: ${status}\n${out || '(no output yet)'}` }], details: {} };
      },
    });

    pi.registerTool({
      name: 'pidesk_bg_kill',
      label: 'Stop shell',
      description: 'Stop a background shell command started with pidesk_bg_shell.',
      parameters: Type.Object({ id: Type.String({ description: 'The task id returned by pidesk_bg_shell' }) }),
      async execute(_id, params) {
        const task = shells.get(params.id);
        if (!task) throw new Error(`No background shell with id ${params.id}`);
        if (task.state !== 'running') return { content: [{ type: 'text', text: `Already finished (${task.state}).` }], details: {} };
        task.stop.abort();
        return { content: [{ type: 'text', text: 'Stopping the command.' }], details: {} };
      },
    });
  };
}

export function subagentSummary(stats: SubagentStats) {
  return [
    stats.commands && `ran ${stats.commands} command${stats.commands > 1 ? 's' : ''}${stats.failed ? ` (${stats.failed} failed)` : ''}`,
    stats.reads && `read ${stats.reads} file${stats.reads > 1 ? 's' : ''}`,
    stats.searches && `searched ${stats.searches} time${stats.searches > 1 ? 's' : ''}`,
  ].filter(Boolean).join(', ') || 'working';
}

