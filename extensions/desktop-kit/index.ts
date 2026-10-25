/**
 * desktop-kit — pi extension bundled with Pi Desktop.
 *
 * Adds the capabilities the desktop UI expects but pi does not ship by default:
 *   - Permission modes (auto / default / acceptEdits / plan / bypass) gated in `tool_call`
 *   - `todo_write`      task checklist the UI renders as a todo card
 *   - `exit_plan_mode`  plan approval when running in plan mode
 *   - `task`            read-only subagent that runs in a child pi process
 *
 * Desktop protocol (over RPC extension UI):
 *   - Permission prompts are `select` requests whose title starts with
 *     `[[pi-desktop:perm:<toolCallId>]]`, options PERM_OPTIONS.
 *   - Plan approval is a `select` whose title starts with `[[pi-desktop:plan:<toolCallId>]]`.
 *   - Mode changes are announced with `setStatus("pi-desktop-mode", mode)`.
 *   - Output style changes are announced with `setStatus("pi-desktop-output-style", style)`.
 *   - The desktop switches modes with the `/desktop-mode <mode>` command, which pi runs
 *     immediately even while the agent is streaming. Output styles use the same pattern
 *     with `/desktop-output-style <style>`.
 */
import { spawn } from "node:child_process";
import { delimiter, isAbsolute, relative, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

type Mode = "auto" | "default" | "acceptEdits" | "plan" | "bypass";
const MODES: Mode[] = ["auto", "default", "acceptEdits", "plan", "bypass"];
type OutputStyle = "default" | "proactive" | "concise" | "explanatory" | "learning";
const OUTPUT_STYLES: OutputStyle[] = ["default", "proactive", "concise", "explanatory", "learning"];
const PERM_OPTIONS = ["Allow", "Always allow", "Deny"];
const PLAN_OPTIONS = ["Approve & auto-accept edits", "Approve, ask for edits", "Keep planning"];
const STATUS_KEY = "pi-desktop-mode";
const STYLE_STATUS_KEY = "pi-desktop-output-style";

// Appended to the system prompt for the current turn. These change how Claude talks,
// not what it is allowed to do (permission modes still decide that).
const STYLE_PROMPTS: Record<Exclude<OutputStyle, "default">, string> = {
	proactive: `# Output style: Proactive
Start work immediately instead of asking about routine decisions. Make reasonable assumptions, state them briefly, and keep going. Do not pause for confirmation on reversible, in-scope work. Destructive actions, security warnings, and permission requests still require the normal safeguards.`,
	concise: `# Output style: Concise
Lead with the result. Omit preambles, restatements of the request, narration of what you are about to do, and closing recaps. Prefer short paragraphs and tight bullets. Full detail is still required for errors, security warnings, destructive-action confirmations, and whenever the user asks for an explanation.`,
	explanatory: `# Output style: Explanatory
While working, explain implementation choices and relevant codebase patterns in brief "Insight" asides: what you chose, the alternative, and why. Keep them short and skippable, and do not let them interrupt the flow of the work.`,
	learning: `# Output style: Learning
Work collaboratively and teach as you go. Explain key concepts in plain language, and when a small piece of the work is a good learning exercise, leave a clearly scoped \`TODO(human)\` marker with instructions instead of completing that piece. Keep making progress on everything else; ask before handing over larger chunks.`,
};

const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls", "todo_write", "exit_plan_mode", "task", "tool_search", "codemode"]);
const EDIT_TOOLS = new Set(["edit", "write"]);
const SHELL_TOOLS = new Set(["bash", "powershell"]);

// Commands that only inspect state. Anything else (including running tests) counts as execution.
const SAFE_COMMANDS = new Set([
	"cat", "head", "tail", "less", "more", "wc", "ls", "pwd", "tree", "find", "grep", "rg", "fd", "echo",
	"which", "file", "stat", "du", "df", "date", "uname", "whoami", "printenv", "sort", "uniq", "cut", "diff",
]);
const SAFE_GIT = new Set(["status", "log", "diff", "show", "branch", "rev-parse", "ls-files", "blame", "remote"]);
const RISKY = [
	/\bgit\s+push\b/, /\bgh\s+(pr\s+(create|merge|close)|release|repo\s+delete)\b/, /\bnpm\s+publish\b/,
	/\brm\s+-[a-z]*r/i, /\bsudo\b/, /\bgit\s+reset\s+--hard\b/, /\bgit\s+clean\b/, /\bchmod\s+(-R\s+)?777\b/,
	/\b(curl|wget)\b[^|]*\|\s*(ba|z)?sh\b/, /\bmkfs\b/, /\bdd\s+if=/, /\bgit\s+checkout\s+--\s/,
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
			if (cmd === "git") return SAFE_GIT.has(sub ?? "");
			if (cmd === "sed") return !/\s-i\b/.test(seg);
			return SAFE_COMMANDS.has(cmd);
		});
}
// Cowork works in the user's own folders (documents, downloads…), so anything that
// deletes, moves or sends data away also needs approval.
const COWORK_RISKY = [
	/\b(rm|rmdir|mv|del|erase|unlink|shred|truncate)\b/, /\bfind\b.*-delete\b/, /\b(scp|rsync|sftp|ftp)\b/,
	/\b(curl|wget)\b.*(-X\s*(POST|PUT|PATCH|DELETE)|--data|\s-d\s|\s-F\s|--upload-file|\s-T\s)/, /\b(sendmail|mail|mutt)\b/,
];
export const isRiskyCommand = (command: string, profile = "code") =>
	RISKY.some((r) => r.test(command)) || (profile === "cowork" && COWORK_RISKY.some((r) => r.test(command)));
const cmdKey = (command: string) => command.trim().split(/\s+/).slice(0, 2).join(" ");

// Shared with other desktop extensions (the offline demo model reads the mode from here).
const shared = ((globalThis as any).__piDesktop ??= { mode: "auto" as Mode, profile: "code", outputStyle: "default" as OutputStyle });

export default function (pi: ExtensionAPI) {
	const allowed = new Set<string>(); // "Always allow" command prefixes for this session

	pi.registerFlag("desktop-mode", { type: "string", default: "auto", description: "Pi Desktop permission mode" });
	pi.registerFlag("desktop-profile", { type: "string", default: "code", description: "Pi Desktop profile: code or cowork" });
	pi.registerFlag("desktop-output-style", { type: "string", default: "default", description: "Pi Desktop output style" });

	const setMode = (mode: Mode, ctx?: ExtensionContext) => {
		shared.mode = mode;
		ctx?.ui.setStatus(STATUS_KEY, mode);
	};
	const setOutputStyle = (style: OutputStyle, ctx?: ExtensionContext) => {
		shared.outputStyle = style;
		ctx?.ui.setStatus(STYLE_STATUS_KEY, style);
	};

	pi.on("session_start", async (_event, ctx) => {
		shared.profile = pi.getFlag("desktop-profile") === "cowork" ? "cowork" : "code";
		const flag = String(pi.getFlag("desktop-mode") ?? "auto") as Mode;
		setMode(MODES.includes(flag) ? flag : "auto", ctx);
		const styleFlag = String(pi.getFlag("desktop-output-style") ?? "default") as OutputStyle;
		setOutputStyle(OUTPUT_STYLES.includes(styleFlag) ? styleFlag : "default", ctx);
	});

	pi.registerCommand("desktop-mode", {
		description: "Set the Pi Desktop permission mode (auto, default, acceptEdits, plan, bypass)",
		getArgumentCompletions: (prefix) => MODES.filter((m) => m.startsWith(prefix)).map((m) => ({ value: m, label: m })),
		handler: async (args, ctx) => {
			const mode = args.trim() as Mode;
			if (!MODES.includes(mode)) {
				ctx.ui.notify(`Unknown mode "${args}". Use: ${MODES.join(", ")}`, "warning");
				return;
			}
			setMode(mode, ctx);
		},
	});

	pi.registerCommand("desktop-output-style", {
		description: "Set the Pi Desktop output style (default, proactive, concise, explanatory, learning)",
		getArgumentCompletions: (prefix) => OUTPUT_STYLES.filter((s) => s.startsWith(prefix)).map((s) => ({ value: s, label: s })),
		handler: async (args, ctx) => {
			const style = args.trim() as OutputStyle;
			if (!OUTPUT_STYLES.includes(style)) {
				ctx.ui.notify(`Unknown output style "${args}". Use: ${OUTPUT_STYLES.join(", ")}`, "warning");
				return;
			}
			setOutputStyle(style, ctx);
		},
	});

	// ---------------------------------------------------------------- permissions
	const ask = async (ctx: ExtensionContext, toolCallId: string, title: string, key?: string) => {
		if (!ctx.hasUI) return { block: true, reason: "Approval required but no UI is attached" };
		const choice = await ctx.ui.select(`[[pi-desktop:perm:${toolCallId}]] ${title}`, PERM_OPTIONS);
		if (choice === "Always allow") {
			if (key) allowed.add(key);
			else setMode("acceptEdits", ctx); // "always allow" on an edit = accept edits for this session
			return undefined;
		}
		if (choice === "Allow") return undefined;
		return { block: true, reason: "The user denied this tool call. Ask how they want to proceed." };
	};

	pi.on("tool_call", async (event, ctx) => {
		const mode = shared.mode as Mode;
		if (mode === "bypass") return undefined;
		const name = event.toolName;
		const input = event.input as Record<string, any>;

		if (READ_ONLY_TOOLS.has(name)) return undefined;

		if (EDIT_TOOLS.has(name)) {
			if (mode === "plan") return { block: true, reason: "Plan mode is read-only. Present your plan with exit_plan_mode." };
			const abs = resolve(ctx.cwd, String(input.path ?? ""));
			const rel = relative(ctx.cwd, abs);
			const outside = rel.startsWith("..") || isAbsolute(rel);
			if (!outside && (mode === "auto" || mode === "acceptEdits")) return undefined;
			return ask(ctx, event.toolCallId, `${outside ? "Edit outside the project" : name === "write" ? "Create" : "Edit"} ${input.path}`);
		}

		if (SHELL_TOOLS.has(name)) {
			const command = String(input.command ?? "");
			const readOnly = isReadOnlyCommand(command);
			if (mode === "plan") return readOnly ? undefined : { block: true, reason: "Plan mode only allows read-only commands." };
			if (readOnly || allowed.has(cmdKey(command))) return undefined;
			if (mode === "auto" && !isRiskyCommand(command, shared.profile)) return undefined;
			return ask(ctx, event.toolCallId, `Run ${command}`, cmdKey(command));
		}

		// MCP and other extension tools: trust their annotations.
		const hints = pi.getAllTools().find((t) => t.name === name)?.annotations;
		if (hints?.readOnlyHint) return undefined;
		if (mode === "plan") return { block: true, reason: `Plan mode blocks ${name}.` };
		if (mode === "auto" && hints?.destructiveHint !== true) return undefined;
		return ask(ctx, event.toolCallId, `Use ${name}`, `tool:${name}`);
	});

	pi.on("before_agent_start", async (event) => {
		const style = shared.outputStyle as OutputStyle;
		const stylePrompt = style !== "default" ? STYLE_PROMPTS[style] : null;
		const planMessage =
			shared.mode === "plan"
				? {
						customType: "pi-desktop-plan-mode",
						display: false,
						content:
							"[pi-desktop] You are in PLAN MODE. Explore the code with read-only tools only. Do not edit files. " +
							"When you understand the change, call exit_plan_mode with a concise markdown plan " +
							"(Context, Changes as a numbered list, Verification) and wait for approval.",
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
		status: StringEnum(["pending", "in_progress", "completed"] as const),
		activeForm: Type.Optional(Type.String({ description: "Present continuous form, e.g. 'Fixing the date formatter'" })),
	});
	pi.registerTool({
		name: "todo_write",
		label: "Todos",
		description:
			"Create or update the task checklist shown to the user. Send the complete list every time. " +
			"Use it for work with 3+ steps; keep exactly one item in_progress while working.",
		promptSnippet: "Track multi-step work with a visible checklist",
		parameters: Type.Object({ todos: Type.Array(TodoItem) }),
		async execute(_id, params) {
			const done = params.todos.filter((t) => t.status === "completed").length;
			return {
				content: [{ type: "text", text: `Todo list updated (${done}/${params.todos.length} completed).` }],
				details: { todos: params.todos },
			};
		},
	});

	// ---------------------------------------------------------------- exit_plan_mode
	pi.registerTool({
		name: "exit_plan_mode",
		label: "Plan",
		description: "In plan mode, present the implementation plan (markdown) to the user for approval.",
		parameters: Type.Object({
			title: Type.String({ description: "Short plan title" }),
			plan: Type.String({ description: "The plan in markdown" }),
		}),
		async execute(toolCallId, params, _signal, _onUpdate, ctx) {
			if (shared.mode !== "plan") {
				return { content: [{ type: "text", text: "Not in plan mode. Proceed with the task." }], details: { status: "skipped" } };
			}
			const choice = ctx.hasUI ? await ctx.ui.select(`[[pi-desktop:plan:${toolCallId}]] ${params.title}`, PLAN_OPTIONS) : undefined;
			if (choice === PLAN_OPTIONS[0] || choice === PLAN_OPTIONS[1]) {
				setMode(choice === PLAN_OPTIONS[0] ? "acceptEdits" : "default", ctx);
				return {
					content: [{ type: "text", text: "The user approved the plan. Implement it now, step by step." }],
					details: { status: "approved", mode: shared.mode },
				};
			}
			return {
				content: [{ type: "text", text: "The user wants to keep refining the plan. Stop and wait for their feedback." }],
				details: { status: "keep" },
				terminate: true,
			};
		},
	});

	// ---------------------------------------------------------------- task (subagent)
	pi.registerTool({
		name: "task",
		label: "Agent",
		description:
			"Delegate a focused, read-only investigation to a subagent with a fresh context. " +
			"Use it for broad searches or tracing code paths; it returns a written report.",
		promptSnippet: "Delegate read-only investigations to a subagent",
		parameters: Type.Object({
			description: Type.String({ description: "3-6 word summary shown to the user" }),
			prompt: Type.String({ description: "Complete, self-contained instructions for the subagent" }),
		}),
		annotations: { readOnlyHint: true },
		async execute(_id, params, signal, onUpdate, ctx) {
			const extensionArgs = (process.env.PI_DESKTOP_EXTENSIONS ?? "")
				.split(delimiter)
				.filter(Boolean)
				.flatMap((p) => ["-e", p]);
			const model = ctx.model ? ["--model", `${ctx.model.provider}/${ctx.model.id}`] : [];
			const args = [
				process.argv[1], "--mode", "json", "-p", "--no-session",
				"--tools", "read,grep,find,ls,bash", "--desktop-mode", "plan", "--desktop-profile", shared.profile,
				...extensionArgs, ...model, "--", params.prompt,
			];
			const stats = { commands: 0, reads: 0, searches: 0, failed: 0 };
			let text = "";
			const summary = () =>
				[
					stats.commands && `ran ${stats.commands} command${stats.commands > 1 ? "s" : ""}${stats.failed ? ` (${stats.failed} failed)` : ""}`,
					stats.reads && `read ${stats.reads} file${stats.reads > 1 ? "s" : ""}`,
					stats.searches && `searched ${stats.searches} time${stats.searches > 1 ? "s" : ""}`,
				].filter(Boolean).join(", ") || "working";

			const exitCode = await new Promise<number>((done) => {
				const child = spawn(process.execPath, args, { cwd: ctx.cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
				signal?.addEventListener("abort", () => child.kill(), { once: true });
				let buf = "";
				child.stdout.setEncoding("utf8");
				child.stdout.on("data", (chunk: string) => {
					buf += chunk;
					let nl: number;
					while ((nl = buf.indexOf("\n")) >= 0) {
						const line = buf.slice(0, nl).replace(/\r$/, "");
						buf = buf.slice(nl + 1);
						if (!line) continue;
						let ev: any;
						try { ev = JSON.parse(line); } catch { continue; }
						if (ev.type === "tool_execution_end") {
							if (ev.toolName === "bash") stats.commands++;
							else if (ev.toolName === "read") stats.reads++;
							else stats.searches++;
							if (ev.isError) stats.failed++;
							onUpdate?.({ content: [{ type: "text", text: summary() }], details: { ...params, stats: { ...stats }, text: "" } });
						}
						if (ev.type === "message_end" && ev.message?.role === "assistant") {
							const t = (ev.message.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
							if (t) text = t;
						}
					}
				});
				child.stderr.resume();
				child.on("close", (code) => done(code ?? 1));
			});
			if (signal?.aborted) throw new Error("Subagent aborted");
			if (!text) throw new Error(`Subagent produced no report (exit ${exitCode})`);
			return {
				content: [{ type: "text", text: text.length > 20000 ? `${text.slice(0, 20000)}\n…(truncated)` : text }],
				details: { ...params, stats, summary: summary(), text },
			};
		},
	});
}
