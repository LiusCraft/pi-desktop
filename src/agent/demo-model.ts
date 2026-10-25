/**
 * demo-model — an offline, scripted model for Pi Desktop.
 *
 * Registers provider `demo` / model `demo-coder` built on pi-ai's faux provider.
 * It drives pi's real tools (grep, read, edit, write, bash, todo_write, task,
 * exit_plan_mode) against the bundled demo project, so the whole desktop
 * pipeline — streaming, tools, permissions, plan approval, diffs, subagents —
 * can be tried without an API key. Real models replace it by picking another
 * model in the UI.
 *
 * One provider serves every session in the agent host, so it keeps no session
 * state: Cowork is recognised from the system prompt and plan mode from the
 * marker message desktop-kit injects into the turn.
 */
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
	fauxAssistantMessage as msg,
	fauxProvider,
	fauxText as text,
	fauxThinking as think,
	fauxToolCall as call,
} from "@earendil-works/pi-ai";
import { COWORK_MARKER, PLAN_MODE_MARKER } from "./desktop-kit";

type Block = ReturnType<typeof text> | ReturnType<typeof think> | ReturnType<typeof call>;
type Step = (r: Run) => Block[];
interface Scenario {
	match: (prompt: string) => boolean;
	steps: Step[];
	plan?: { at: number; title: string; md: string; lead: string };
}
interface Run {
	prompt: string;
	results: { toolName: string; text: string; isError: boolean }[];
}

const todos = (items: string[], states: string) =>
	call("todo_write", {
		todos: items.map((content, i) => ({
			content,
			status: ({ p: "pending", i: "in_progress", d: "completed" } as const)[states[i] as "p" | "i" | "d"],
		})),
	});

// ---------------------------------------------------------------- scenarios
const FIX_TODOS = ["定位 formatDate 的问题", "修复月份偏移与补零", "补充边界测试", "运行测试"];
const FEATURE_TODOS = ["新建 ThemeToggle 组件", "添加深色主题变量", "在 App 头部挂载按钮", "构建验证"];

const THEME_TOGGLE = `import { useEffect, useState } from 'react';

export default function ThemeToggle() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') ?? 'light');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  return (
    <button className="theme-toggle" aria-label="切换主题" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}>
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );
}
`;

const SUBAGENT_MARK = "只读、小范围探索";

const scenarios: Scenario[] = [
	{
		// subagent run (child process started by the `task` tool)
		match: (p) => p.startsWith(SUBAGENT_MARK),
		steps: [
			() => [call("ls", { path: "src" }), call("read", { path: "src/App.jsx" }), call("read", { path: "src/components/TodoList.jsx" })],
			() => [call("bash", { command: "grep -rn \"formatDate\\|isOverdue\" src" })],
			() => [
				text(`### 数据流
1. src/App.jsx:6 用 \`useState([])\` 定义 \`todos\`
2. src/App.jsx:7 \`toggle(id)\` 以不可变方式翻转 \`done\`
3. src/components/TodoList.jsx:3 通过 props 接收 \`todos\` / \`onToggle\`
4. src/components/TodoList.jsx:10 渲染时调用 \`formatDate(t.due)\`

### 风险点
- \`formatDate\` 没有 \`+1\`，月份偏移
- \`isOverdue\` 对纯日期按 UTC 零点解析`),
			],
		],
	},
	{
		match: (p) => /isOverdue|逾期/.test(p),
		steps: [
			() => [think("纯日期 YYYY-MM-DD 会按 UTC 零点解析；应按当天本地时间结束时刻比较。"), call("grep", { pattern: "isOverdue" }), call("read", { path: "src/utils/date.js" })],
			() => [
				text("确认了：`isOverdue` 直接 `new Date(due) < now`，当天到期的任务从早上就会被标红。"),
				call("edit", {
					path: "src/utils/date.js",
					edits: [{
						oldText: "export function isOverdue(due, now = new Date()) {\n  return new Date(due) < now;\n}",
						newText: "export function isOverdue(due, now = new Date()) {\n  // 只有日期（YYYY-MM-DD）时，按当天本地时间的结束时刻判断\n  const end = /^\\d{4}-\\d{2}-\\d{2}$/.test(due) ? new Date(`${due}T23:59:59.999`) : new Date(due);\n  return end < now;\n}",
					}],
				}),
			],
			() => [call("bash", { command: "npm test" })],
			(r) => [text(r.results.at(-1)?.isError
				? "`isOverdue` 已修复；剩下的失败用例来自 `formatDate` 的月份偏移，那是另一个问题。"
				: "`isOverdue` 已修复，测试全部通过。")],
		],
	},
	{
		match: (p) => /提交|\bPR\b|\bcommit\b|\bpush\b/.test(p),
		steps: [
			() => [call("bash", { command: "git status --short" })],
			() => [call("bash", { command: "git add -A && git commit -m \"fix: 修正 formatDate 的月份偏移\"" })],
			() => [call("bash", { command: "git push -u origin HEAD" })],
			(r) => r.results.at(-1)?.isError
				? [text("已提交到当前分支，但**推送失败**：这个仓库还没有配置远程（`origin`）。添加远程后我可以继续推送并用 `gh pr create` 创建 PR。")]
				: [call("bash", { command: "gh pr create --fill" })],
			() => [text("PR 已创建。")],
		],
	},
	{
		match: (p) => /修|bug|错|fix|问题|不对|少了/i.test(p),
		plan: {
			at: 2,
			title: "修复日期格式化问题",
			lead: "根因在 src/utils/date.js:5 —— `getMonth()` 从 0 开始计数，而且没有补零。",
			md: `## Context
\`formatDate\` 在 src/utils/date.js:5 直接使用 \`getMonth()\`（0–11），所有日期少一个月；月、日也未补零。

## 改动
1. \`formatDate\`：月份 \`+1\`，月和日用 \`padStart(2, '0')\` 补零
2. 非法日期返回空字符串
3. \`tests/date.test.js\` 增加 12 月和非法输入的用例

## 验证
- \`npm test\` 全部通过`,
		},
		steps: [
			() => [
				think("用户说日期少了一个月，多半是 getMonth() 从 0 开始。先找 formatDate 的定义和调用方，再跑测试确认能复现。"),
				text("我先找一下日期格式化相关的代码。"),
				todos(FIX_TODOS, "ippp"),
				call("grep", { pattern: "formatDate" }),
			],
			() => [call("read", { path: "src/utils/date.js" }), call("read", { path: "tests/date.test.js" })],
			() => [call("bash", { command: "npm test" })],
			() => [
				text("能复现：现有用例就是失败的。根因在 src/utils/date.js:5 —— `getMonth()` 返回 **0–11**，直接拼接没有 `+1`；月和日也没有补零。"),
				todos(FIX_TODOS, "dipp"),
				call("edit", {
					path: "src/utils/date.js",
					edits: [
						{ oldText: "  const d = new Date(date);\n", newText: "  const d = new Date(date);\n  if (Number.isNaN(d.getTime())) return '';\n" },
						{
							oldText: "  const month = d.getMonth();\n  const day = d.getDate();",
							newText: "  const month = String(d.getMonth() + 1).padStart(2, '0');\n  const day = String(d.getDate()).padStart(2, '0');",
						},
					],
				}),
			],
			() => [
				todos(FIX_TODOS, "ddip"),
				call("edit", {
					path: "tests/date.test.js",
					edits: [{
						oldText: "    assert.equal(formatDate('2026-03-05T10:00:00'), '2026-03-05');\n  });\n",
						newText: "    assert.equal(formatDate('2026-03-05T10:00:00'), '2026-03-05');\n  });\n\n  it('12 月不会溢出', () => {\n    assert.equal(formatDate('2026-12-31T08:00:00'), '2026-12-31');\n  });\n\n  it('非法日期返回空字符串', () => {\n    assert.equal(formatDate('not a date'), '');\n  });\n",
					}],
				}),
			],
			() => [todos(FIX_TODOS, "dddi"), call("bash", { command: "npm test" })],
			() => [todos(FIX_TODOS, "dddd")],
			(r) => [
				text(r.results.filter((x) => x.toolName === "bash").at(-1)?.isError
					? "改动已完成，但测试仍有失败，请看上面的输出。"
					: `修好了，测试全部通过。

### 改动
- **src/utils/date.js:5** 月份改为 \`getMonth() + 1\`，月和日补零；非法日期返回空字符串
- **tests/date.test.js** 新增「12 月不溢出」和「非法日期」两个用例

顺带发现 \`isOverdue\` 对纯日期按 UTC 解析，当天到期会被误判为逾期——可以另开一个会话修。`),
			],
		],
	},
	{
		match: (p) => /添加|加个|加一|实现|深色|暗色|dark|主题|功能|add|feature|新增/i.test(p),
		plan: {
			at: 1,
			title: "添加深色模式",
			lead: "样式已经基于 CSS 变量（src/styles.css:2），用 `data-theme` 切换即可。",
			md: `## Context
样式基于 CSS 变量（\`--bg\`、\`--fg\`），可以通过 \`<html data-theme>\` 切换主题。

## 改动
1. 新建 \`src/components/ThemeToggle.jsx\`，主题持久化到 \`localStorage\`
2. \`src/styles.css\` 增加 \`[data-theme='dark']\` 变量覆盖
3. \`App.jsx\` 头部挂载切换按钮

## 验证
- \`npm run build\``,
		},
		steps: [
			() => [
				think("先看样式是怎么组织的——如果已经用了 CSS 变量，只要在 data-theme 下覆盖变量。"),
				call("ls", { path: "src/components" }),
				call("read", { path: "src/App.jsx" }),
				call("read", { path: "src/styles.css" }),
			],
			() => [
				text("样式已经基于 CSS 变量（src/styles.css:2），很适合用 `data-theme` 切换，不需要额外依赖。"),
				todos(FEATURE_TODOS, "ippp"),
				call("write", { path: "src/components/ThemeToggle.jsx", content: THEME_TOGGLE }),
			],
			() => [
				todos(FEATURE_TODOS, "dipp"),
				call("edit", { path: "src/styles.css", edits: [{ oldText: "  --fg: #1a1a1a;\n}\n", newText: "  --fg: #1a1a1a;\n}\n\n[data-theme='dark'] {\n  --bg: #1c1c1e;\n  --fg: #f2f2f2;\n}\n" }] }),
			],
			() => [
				todos(FEATURE_TODOS, "ddip"),
				call("edit", {
					path: "src/App.jsx",
					edits: [
						{ oldText: "import TodoList from './components/TodoList.jsx';", newText: "import TodoList from './components/TodoList.jsx';\nimport ThemeToggle from './components/ThemeToggle.jsx';" },
						{ oldText: "        <h1>我的待办</h1>\n", newText: "        <h1>我的待办</h1>\n        <ThemeToggle />\n" },
					],
				}),
			],
			() => [todos(FEATURE_TODOS, "dddi"), call("bash", { command: "npm run build" })],
			() => [todos(FEATURE_TODOS, "dddd")],
			() => [
				text(`深色模式已加好，构建通过。

- **新增** src/components/ThemeToggle.jsx:1 —— 在 🌙 / ☀️ 间切换，选择记在 \`localStorage\`
- **src/styles.css:6** 在 \`[data-theme='dark']\` 下覆盖 \`--bg\` 和 \`--fg\`
- **src/App.jsx:14** 按钮放在标题旁边`),
			],
		],
	},
	{
		match: (p) => /解释|结构|explain|介绍|看看|状态|进度|数据流/i.test(p),
		steps: [
			() => [think("先看目录和依赖；组件间的数据流交给子 agent 梳理。"), call("ls", { path: "." }), call("read", { path: "package.json" })],
			() => [
				call("task", {
					description: "Trace data flow between components",
					prompt: `${SUBAGENT_MARK}。梳理 App → TodoList → utils/date 之间的数据流与调用关系：todos 状态在哪里定义、如何更新、哪些函数参与渲染。给出文件与行号证据，不要修改任何文件。`,
				}),
			],
			() => [call("read", { path: "src/App.jsx" })],
			() => [
				text(`这是一个很小的待办应用，测试用 Node 自带的 \`node:test\`。

### 结构
- src/App.jsx:5 根组件，用 \`useState\` 持有 \`todos\`
- src/components/TodoList.jsx:3 纯展示组件，给逾期项加 \`overdue\` 类
- src/utils/date.js:2 \`formatDate\` / \`isOverdue\` 两个纯函数

### 数据流
\`App\` → props → \`TodoList\` → 勾选时回调 \`onToggle(id)\` → \`App\` 不可变地更新状态。子 agent 的完整报告在它的工具行里，点开即可查看。`),
			],
		],
	},
];


// ---------------------------------------------------------------- cowork scenarios
const today = () => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const INBOX = ["01-季度预算审批.txt", "02-周会改期.txt", "03-差旅发票.txt", "04-行业周刊.txt", "05-客户反馈.txt"];
const INBOX_TODOS = ["读取收件箱里的邮件", "按紧急程度归类并起草回复", "写出整理结果", "归档不需要处理的邮件"];

const coworkScenarios: Scenario[] = [
	{
		match: (p) => /收件箱|inbox/i.test(p) || (/邮件/.test(p) && !/简报|briefing/i.test(p)),
		steps: [
			() => [think("先看收件箱里有哪些邮件，再逐封读。"), todos(INBOX_TODOS, "ippp"), call("ls", { path: "inbox" })],
			() => INBOX.map((f) => call("read", { path: `inbox/${f}` })),
			() => [
				text("5 封邮件都看完了：2 封今天必须处理，1 封有截止日期，1 封只是通知，1 封是订阅周刊。"),
				todos(INBOX_TODOS, "ddip"),
				call("write", {
					path: "收件箱整理.md",
					content: `# 收件箱整理（${today()}）

| 优先级 | 邮件 | 需要做什么 | 截止 |
|---|---|---|---|
| 🔴 紧急 | 财务部：Q4 预算审批 | 补充市场部分明细并回复确认 | 今天 12:00 |
| 🔴 紧急 | 星河科技：导出功能反馈 | 给出 PDF 截断问题的修复时间表 | 本周内（对方下周一演示） |
| 🟡 有截止 | 报销系统：差旅发票 | 提交 10/12、10/18 两张发票 | 本月 28 日 |
| ⚪ 知悉 | 李航：周会改期 | 日历改到周四 15:00 | — |
| ⚪ 归档 | 行业周刊 | 无需处理 | — |

## 回复草稿

**回复王敏（Q4 预算）**
> 王敏你好，市场部分的明细我中午前补到表里，补完再回邮件确认，下午评审会见。

**回复陈晓（导出反馈）**
> 陈晓你好，感谢反馈。A4 导出截断右侧一列的问题已经复现，我们会在本周四前给出修复版本，并在周五前和你确认演示用的导出效果。
`,
				}),
			],
			() => [todos(INBOX_TODOS, "dddi"), call("bash", { command: "mkdir -p inbox/已归档 && mv inbox/04-行业周刊.txt inbox/已归档/" })],
			() => [todos(INBOX_TODOS, "dddd")],
			() => [
				text(`收件箱整理好了：

- **今天必须处理**：财务部的 Q4 预算（12:00 前）、星河科技的导出反馈
- **有截止日期**：两张差旅发票，本月 28 日前提交
- **只需知悉**：周会改到周四 15:00
- 行业周刊已移到 \`inbox/已归档/\`

两封紧急邮件的回复草稿都写在 收件箱整理.md:1 里，确认后可以直接复制发送。`),
			],
		],
	},
	{
		match: (p) => /简报|briefing|日程/i.test(p),
		steps: [
			() => [
				think("简报需要今天的日程、未完成的待办和重要邮件。先读日程和待办，再看收件箱。"),
				call("read", { path: "今日日程.md" }),
				call("read", { path: "todo.md" }),
				call("ls", { path: "inbox" }),
			],
			() => [call("read", { path: "inbox/01-季度预算审批.txt" }), call("read", { path: "inbox/05-客户反馈.txt" })],
			() => [
				call("write", {
					path: `每日简报-${today()}.md`,
					content: `# 每日简报 · ${today()}

## 今天的日程
- 09:30 产品周会（线上）
- 11:00 与设计讨论新版首页
- **14:00 季度预算评审** —— 记得带上市场部分的数据
- 16:30 星河科技客户回访

## 需要优先处理
1. **Q4 预算表**：财务部要求今天 12:00 前补齐市场部分明细（下午评审要用）
2. **星河科技反馈**：PDF 导出截断问题，对方下周一演示，需本周内给修复时间表——正好在 16:30 回访时同步

## 其他待办
- 报销 10 月差旅发票（本月 28 日截止）
`,
				}),
			],
			() => [
				text(`今天的简报生成好了：每日简报-${today()}.md:1

最重要的两件事：**中午前补齐 Q4 预算的市场明细**，以及在 16:30 回访前准备好**星河科技导出问题的修复时间表**。

每个工作日自动发送需要 Scheduled（定时任务）功能，Pi Desktop 里这个功能还没上线；现在可以每天早上对我说“生成今天的简报”。`),
			],
		],
	},
	{
		match: (p) => /定制|Customize|配置|适合/i.test(p),
		steps: [
			() => [call("ls", { path: "." }), call("read", { path: "README.md" }), call("read", { path: "todo.md" })],
			() => [
				text(`看了一下这个文件夹，你的工作主要是**邮件处理、日程安排和报表**。建议这样用 Cowork：

1. **把常用文件夹设为项目**：例如这个工作区，Cowork 每次都能直接读到收件箱和待办
2. **每天早上**：“生成今天的简报”——汇总日程、待办和紧急邮件
3. **处理邮件**：“整理收件箱并起草回复”——按紧急程度分类，草稿写进文件，不会自动发送
4. **报表类工作**：把原始数据放进文件夹，让 Cowork 生成 CSV/Markdown 报表

想接入真实的日历和邮箱，可以给 pi 安装对应的 MCP 服务器或扩展（\`~/.pi/agent/mcp.json\`）。`),
			],
		],
	},
];

const COWORK_GREETING = `你好！这里是 **Cowork**，现在用的是离线演示模型，会用真实工具操作你选的文件夹。可以试试：

- 「帮我整理收件箱：归类、标记需要回复的邮件，并起草回复」——移动文件前会请你确认
- 「每个工作日早上给我发一份简报」——读取日程、待办和邮件，生成简报文件
- 「根据我的工作方式，帮我定制 Cowork」

切换到真实模型后，就由真正的 LLM 来完成任务。`;

const GREETING = `你好！我是 **离线演示模型**（demo-coder），不需要 API Key，会用 pi 的真实工具操作当前项目。可以试试：

- 「日期显示少了一个月，帮我修一下」——搜索、读文件、跑测试、编辑、再跑测试
- 「添加深色模式」——切到 **Plan** 模式试试计划审批
- 「解释一下项目结构」——会启动一个子 agent
- 「提交并创建 PR」——触发需要确认的危险命令

在右下角切换到真实模型后，就由真正的 LLM 来驱动。`;

// ---------------------------------------------------------------- driver
function contentText(m: any): string {
	if (typeof m.content === "string") return m.content;
	return (m.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
}

function respond(context: any) {
	const messages: any[] = context.messages ?? [];
	// Messages injected by extensions reach the model as user messages; skip them.
	let u = messages.length - 1;
	while (u >= 0 && (messages[u].role !== "user" || contentText(messages[u]).startsWith("[pi-desktop]"))) u--;
	// Other extensions (the user's own, from ~/.pi/agent) may inject user-role messages
	// right after the prompt. The prompt is the first message of that trailing user block.
	while (u > 0 && messages[u - 1].role === "user") u--;
	while (u < messages.length - 1 && contentText(messages[u]).startsWith("[pi-desktop]")) u++;
	const prompt = u >= 0 ? contentText(messages[u]).trim() : "";
	const after = messages.slice(u + 1);
	const assistants = after.filter((m) => m.role === "assistant");
	const results = after
		.filter((m) => m.role === "toolResult")
		.map((m) => ({ toolName: m.toolName, text: contentText(m), isError: !!m.isError }));
	const lastAssistant = after.map((m, i) => (m.role === "assistant" ? i : -1)).filter((i) => i >= 0).at(-1) ?? -1;
	const latest = after.slice(lastAssistant + 1).filter((m) => m.role === "toolResult");

	// The user denied a tool call, or plan mode blocked it: stop and ask.
	const denied = latest.find((m) => m.isError && /denied|Plan mode|blocked|no UI/i.test(contentText(m)));
	if (denied) return msg("好的，这一步我不执行了。你希望我换一种做法，还是先停在这里？");

	const cowork = messages.some((m) => m.role === "system" && JSON.stringify(m).includes(COWORK_MARKER)) && !prompt.startsWith(SUBAGENT_MARK);
	const planMode = after.some((m) => m.role === "user" && contentText(m).startsWith(PLAN_MODE_MARKER));
	const sc = (cowork ? coworkScenarios : scenarios).find((s) => s.match(prompt));
	if (!sc) return msg(cowork ? COWORK_GREETING : GREETING);

	// Plan mode: insert an exit_plan_mode call before the first editing step.
	const planCalls = assistants.filter((a) => (a.content ?? []).some((c: any) => c.type === "toolCall" && c.name === "exit_plan_mode")).length;
	const step = assistants.length - planCalls;
	if (sc.plan && step === sc.plan.at && planMode && planCalls === 0) {
		return msg([text(sc.plan.lead), call("exit_plan_mode", { title: sc.plan.title, plan: sc.plan.md })], { stopReason: "toolUse" });
	}
	const fn = sc.steps[step];
	if (!fn) return msg("完成。");
	const blocks = fn({ prompt, results });
	return msg(blocks, { stopReason: blocks.some((b: any) => b.type === "toolCall") ? "toolUse" : "stop" });
}

/** Register the offline demo provider on the agent host's shared model runtime. */
export function registerDemoModel(modelRuntime: ModelRuntime) {
	const faux = fauxProvider({
		provider: "demo",
		models: [{ id: "demo-coder", name: "Demo (offline)", reasoning: true, contextWindow: 200000, maxTokens: 16000 }],
		tokensPerSecond: 260,
	});
	const step = (context: any) => {
		faux.appendResponses([step]); // keep exactly one scripted response pending
		return respond(context);
	};
	faux.setResponses([step]);
	modelRuntime.registerNativeProvider(faux.provider);
}
