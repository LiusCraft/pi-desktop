/**
 * desktop-kit — the pi extension that gives sessions the capabilities the desktop
 * UI expects but pi does not ship by default:
 *   - Permission modes (auto / default / acceptEdits / plan / bypass) gated in `tool_call`
 *   - Output styles appended to the system prompt in `before_agent_start`
 *   - `pidesk_todo_write`      task checklist the UI renders as a todo card
 *   - `pidesk_exit_plan_mode`  plan approval when running in plan mode
 *   - `task`            read-only subagent with a fresh context (optionally in the background)
 *   - `pidesk_bg_shell`        long-running shell command in the background, with `pidesk_bg_output` / `pidesk_bg_kill`
 *
 * Each session gets its own instance through `createDesktopKit(host)`. The host owns
 * the state (so the UI can change the mode at any moment, even mid-run) and turns
 * `ask()` into a permission or plan card in the transcript.
 */
import { isAbsolute, relative, resolve } from 'node:path';
import {
  createLocalBashOperations, createLocalPowerShellOperations,
  type ExtensionAPI, type ExtensionContext, type ExtensionFactory,
} from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { AGENT_TYPES, DEFAULT_AGENT, type AgentType } from './agents';
import { registerManageTools, type ArtifactHost, type CustomizeHost, type PetHost, type ScheduleHost } from './manage-tools';
import {
  PLAN_CHOICES,
  type OutputStyle, type PermissionMode, type SessionKind, type SubagentProgress, type TaskUpdate, type UiRequestInput, type UiResponse,
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

export type KitRequest = Extract<UiRequestInput, { kind: 'permission' | 'plan' }>;
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
  /** The saved artifacts; omit it (subagents) to leave out the artifact tools. */
  artifacts?: ArtifactHost;
  /** The project this session runs in (Work or Code): its standing context each turn, and its memory; omit it for sessions in no project. */
  project?: {
    context(): string | null;
    remember(input: { note?: string; rewrite?: string }): number;
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
  'read', 'grep', 'find', 'ls', 'pidesk_todo_write', 'pidesk_exit_plan_mode', 'pidesk_task', 'pidesk_bg_output', 'pidesk_bg_kill', 'tool_search', 'codemode',
  // Nothing here changes anything: a suggestion is only shown to the user, and the session tools below only look.
  'pidesk_suggest_task', 'pidesk_list_sessions', 'pidesk_read_session',
  // Only changes the label shown in the session list.
  'pidesk_rename_session',
  // Only writes the project's notes, which the user sees and edits on the Projects page.
  'pidesk_remember',
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
      const input = event.input as Record<string, any>;

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

    // ---------------------------------------------------------------- scheduled tasks and customize
    registerManageTools(pi, host);

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
        'When the command exits you get a <task-notification> message. Use the normal shell tool for short commands.',
      promptSnippet: 'Run long-lived shell commands in the background',
      parameters: Type.Object({
        command: Type.String({ description: 'The command to run' }),
        description: Type.Optional(Type.String({ description: '3-6 word summary shown to the user' })),
      }),
      async execute(id, params, _signal, _onUpdate, ctx) {
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
          .exec(params.command, ctx.cwd, {
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
          content: [{ type: 'text', text: `Started \`${params.command}\` in the background (task ${id}). Use pidesk_bg_output to read its output and pidesk_bg_kill to stop it; you will be notified when it exits.` }],
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

