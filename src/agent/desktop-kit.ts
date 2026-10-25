/**
 * desktop-kit — the pi extension that gives sessions the capabilities the desktop
 * UI expects but pi does not ship by default:
 *   - Permission modes (auto / default / acceptEdits / plan / bypass) gated in `tool_call`
 *   - Output styles appended to the system prompt in `before_agent_start`
 *   - `todo_write`      task checklist the UI renders as a todo card
 *   - `exit_plan_mode`  plan approval when running in plan mode
 *   - `task`            read-only subagent with a fresh context
 *
 * Each session gets its own instance through `createDesktopKit(host)`. The host owns
 * the state (so the UI can change the mode at any moment, even mid-run) and turns
 * `ask()` into a permission or plan card in the transcript.
 */
import { isAbsolute, relative, resolve } from 'node:path';
import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import {
  PLAN_CHOICES,
  type OutputStyle, type PermissionMode, type SessionKind, type UiRequestInput, type UiResponse,
} from '@shared/protocol';

/** First words of the hidden message injected in plan mode (the demo model looks for it). */
export const PLAN_MODE_MARKER = '[pi-desktop] You are in PLAN MODE.';
/** Distinctive phrase of the Cowork system prompt (the demo model looks for it). */
export const COWORK_MARKER = 'You are running in Cowork';

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
  prompt: string;
  ctx: ExtensionContext;
  signal: AbortSignal | undefined;
  onProgress: (stats: SubagentStats) => void;
}

export interface KitHost {
  state: KitState;
  /** Ask the user. Resolves `{ cancelled: true }` when nobody can answer. */
  ask(request: KitRequest, signal?: AbortSignal): Promise<UiResponse>;
  /** Called when the kit itself changes the mode (plan approval, "Always allow" on an edit). */
  setMode(mode: PermissionMode): void;
  /** Runs a subagent and returns its report; omit it to leave out the `task` tool. */
  runSubagent?(run: SubagentRun): Promise<string>;
}

// Appended to the system prompt for the current turn. These change how Claude talks,
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

const READ_ONLY_TOOLS = new Set(['read', 'grep', 'find', 'ls', 'todo_write', 'exit_plan_mode', 'task', 'tool_search', 'codemode']);
const EDIT_TOOLS = new Set(['edit', 'write']);
const SHELL_TOOLS = new Set(['bash', 'powershell']);

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
// Cowork works in the user's own folders (documents, downloads…), so anything that
// deletes, moves or sends data away also needs approval.
const COWORK_RISKY = [
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
  RISKY.some((r) => r.test(command)) || (profile === 'cowork' && COWORK_RISKY.some((r) => r.test(command)));
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
        if (mode === 'plan') return { block: true, reason: 'Plan mode is read-only. Present your plan with exit_plan_mode.' };
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
                'When you understand the change, call exit_plan_mode with a concise markdown plan ' +
                '(Context, Changes as a numbered list, Verification) and wait for approval.',
            }
          : null;
      if (!stylePrompt && !planMessage) return undefined;
      return {
        ...(stylePrompt ? { systemPrompt: `${event.systemPrompt}\n\n${stylePrompt}` } : {}),
        ...(planMessage ? { message: planMessage } : {}),
      };
    });

    // ---------------------------------------------------------------- todo_write
    const TodoItem = Type.Object({
      content: Type.String({ description: "Imperative description, e.g. 'Fix the date formatter'" }),
      status: StringEnum(['pending', 'in_progress', 'completed'] as const),
      activeForm: Type.Optional(Type.String({ description: "Present continuous form, e.g. 'Fixing the date formatter'" })),
    });
    pi.registerTool({
      name: 'todo_write',
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

    // ---------------------------------------------------------------- exit_plan_mode
    pi.registerTool({
      name: 'exit_plan_mode',
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

    // ---------------------------------------------------------------- task (subagent)
    const runSubagent = host.runSubagent;
    if (!runSubagent) return;
    pi.registerTool({
      name: 'task',
      label: 'Agent',
      description:
        'Delegate a focused, read-only investigation to a subagent with a fresh context. ' +
        'Use it for broad searches or tracing code paths; it returns a written report.',
      promptSnippet: 'Delegate read-only investigations to a subagent',
      parameters: Type.Object({
        description: Type.String({ description: '3-6 word summary shown to the user' }),
        prompt: Type.String({ description: 'Complete, self-contained instructions for the subagent' }),
      }),
      annotations: { readOnlyHint: true },
      async execute(_id, params, signal, onUpdate, ctx) {
        let stats: SubagentStats = { commands: 0, reads: 0, searches: 0, failed: 0 };
        const text = await runSubagent({
          prompt: params.prompt,
          ctx,
          signal,
          onProgress: (next) => {
            stats = next;
            onUpdate?.({ content: [{ type: 'text', text: subagentSummary(stats) }], details: { ...params, stats, text: '' } });
          },
        });
        if (signal?.aborted) throw new Error('Subagent aborted');
        if (!text) throw new Error('Subagent produced no report');
        return {
          content: [{ type: 'text', text: text.length > 20000 ? `${text.slice(0, 20000)}\n…(truncated)` : text }],
          details: { ...params, stats, summary: subagentSummary(stats), text },
        };
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

