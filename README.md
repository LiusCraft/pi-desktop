<div align="center">

# Pi Desktop

**[pi coding agent](https://github.com/badlogic/pi-mono) 的桌面端 · 仿 Claude desktop 的 Work / Code 双模式**

[![build](https://img.shields.io/github/actions/workflow/status/LiusCraft/pi-desktop/build.yml?branch=main&label=build%20%26%20test&logo=githubactions&logoColor=white)](https://github.com/LiusCraft/pi-desktop/actions/workflows/build.yml)
[![release](https://img.shields.io/github/actions/workflow/status/LiusCraft/pi-desktop/release.yml?label=release&logo=github)](https://github.com/LiusCraft/pi-desktop/actions/workflows/release.yml)
[![version](https://img.shields.io/github/v/release/LiusCraft/pi-desktop?include_prereleases&sort=semver&label=version)](https://github.com/LiusCraft/pi-desktop/releases)
[![downloads](https://img.shields.io/github/downloads/LiusCraft/pi-desktop/total?label=downloads)](https://github.com/LiusCraft/pi-desktop/releases)
[![coverage](https://img.shields.io/codecov/c/github/LiusCraft/pi-desktop?logo=codecov&logoColor=white)](https://codecov.io/gh/LiusCraft/pi-desktop)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)
![electron](https://img.shields.io/badge/Electron-45-47848F?logo=electron&logoColor=white)
![react](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![typescript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)
![node](https://img.shields.io/badge/Node-%E2%89%A522.12-339933?logo=nodedotjs&logoColor=white)
![tests](https://img.shields.io/badge/tests-vitest%20%2B%20playwright-6E9F18?logo=vitest&logoColor=white)

---

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#功能一览">功能一览</a> ·
  <a href="#架构">架构</a> ·
  <a href="#测试">测试</a> ·
  <a href="#打包与发布macos--windows">打包与发布</a> ·
  <a href="#已知限制--下一步">已知限制</a>
</p>

</div>

<p align="center">
  <img src="docs/screenshots/new-session.png" alt="Code 新建会话页：待你回复的会话和未合并的 PR" width="32%">
  <img src="docs/screenshots/code.png" alt="Code 模式：对话、Diff 面板、PR 条" width="32%">
  <img src="docs/screenshots/work.png" alt="Work 模式：进度、生成的文件、权限确认" width="32%">
</p>
<p align="center"><sub>左：新建会话页，列出等你回复的会话和未合并的 PR（Draft / Open / Checks failing / Ready to merge…）　·　中：Code 模式修 bug，右侧是 Diff　·　右：Work 模式整理收件箱，移动文件前先问你（均为离线演示模型）</sub></p>

## 简介

界面仿照 Claude desktop，有 **Work** 和 **Code** 两种模式。界面用 React + TypeScript + [shadcn/ui](https://ui.shadcn.com) 构建；agent 直接复用 **pi SDK**（`createAgentSession`），所有会话跑在一个常驻的 Electron utilityProcess 里。Claude 风格界面里 pi 没有的能力（权限模式、计划审批、待办、子 agent、后台任务）由内置的 desktop-kit 扩展补上。

| | 做什么 |
|---|---|
| 💻 **Code** | 在项目的独立 git worktree 里写代码，配有 diff、PR / CI 状态、终端和预览。 |
| 🗂️ **Work** | 在你选的文件夹里做知识类工作，比如整理文件、写文档、做简报；不选文件夹时会新建一个临时工作区。右侧面板显示进度、Pi Desktop 生成的文件和任务上下文。 |

## 功能一览

- 🔐 **权限模式**：Auto / Ask / Accept edits / Plan / Bypass，高风险命令始终先问。
- 🌳 **独立 worktree**：每个 Code 会话一个分支，互不干扰，删会话时一并清理。
- 🔀 **PR 条与 CI 自动化**：host 内监听 PR，CI 变红自动修、可合并时自动合并。
- 🧠 **后台小请求**：会话命名、下一句输入预测，不占会话上下文。
- 🤖 **子 agent 与后台任务**：`explore` / `plan` 内置，自定义身份放 `~/.pi-desktop/agents/`。
- ⏰ **定时任务**：手动 / 每小时 / 每天 / 工作日 / 每周 / 一次性 / cron。
- 🧩 **Customize**：技能、MCP、插件、提示模板，读写 pi 自己的文件，和 CLI 一致。
- 🌐 **远程**：遥控另一台电脑上的 Pi Desktop 或装了 `pi-remote` 的 pi 命令行。
- 📎 **附件与引用**：粘贴截图、拖入文件，Diff / 文件正文里选代码加评论。

## 快速开始

正常使用不用构建：macOS 上 `brew tap liuscraft/tap && brew install --cask pi-desktop`（升级 `brew upgrade --cask pi-desktop`），Windows 用 Release 里的 `Pi-Desktop-<版本>-win-x64-setup.exe`。从源码跑：

```bash
npm install
npm run dev        # electron-vite 开发模式（界面热更新）
npm run build && npm start   # 构建后运行
npm run build && npm run demo  # 打开内置演示项目，默认使用离线演示模型（仅未打包运行可用）
```

- 需要 Node 22.12+（构建与测试用）；运行时 agent 跑在 Electron 自带的 Node 上。
- 离线 demo 只在未打包运行（`npm run dev` / `npm run demo` / 测试）时启用，打包产物不含 `demo/` 目录也不注册 demo 模型。启动时会把 `demo/todo-app`（Code 演示项目）和 `demo/work-workspace`（Work 演示文件夹：收件箱、日程、待办）复制到 `~/.pi-desktop/demo`。不配置任何 API Key 也能用 **Demo (offline)** 模型体验完整流程。
- 接真实模型：打开设置（`Ctrl/⌘+,`）→ **模型管理**，和 pi CLI 用同一套配置：
  - **账号登录**：Anthropic（Claude Pro/Max）、OpenAI（ChatGPT）、GitHub Copilot、xAI、Meta、Kimi、OpenRouter、Radius 等 provider 的 OAuth 登录，浏览器授权或设备码，凭证写入 `~/.pi/agent/auth.json`。
  - **API 密钥**：所有支持密钥的 provider，交互流程和 pi 的 `/login` 完全一致（包括需要多个环境变量的 provider）。
  - **自定义端点**：OpenAI Chat Completions / Responses、Anthropic Messages、Google Generative AI 兼容地址写入 `~/.pi/agent/models.json`；可以直接从端点的 `/models` 拉取模型列表。每个模型都能编辑名称、上下文大小、最大输出、四项每百万 token 价格、推理与图像输入能力；[models.dev](https://models.dev) 仅补充缺失值，手动值（包括免费价格 0）始终优先。保存不等待公开目录网络请求；目录中的 0 token 限制会忽略，重新保存端点也能清理旧配置里的无效 0 值。密钥仍只存 `auth.json`，本地端点自动写入 pi 的占位密钥。
  - 环境变量、`auth.json`、`models.json` 里已有的配置都会识别；你在 `~/.pi/agent` 里装的扩展、技能、提示模板和 MCP 服务器照常加载，和 CLI 一致。
- 设置窗口（`Ctrl/⌘+,`）是独立窗口：外观（浅色 / 深色 / 跟随系统、侧边栏）、通用（通知、输入预测、默认分区）、模型管理、项目与文件夹（Code 项目、Work 文件夹、worktree 位置）、关于。偏好保存在 `~/.pi-desktop/settings.json`，修改后主窗口立即跟随；preload 用同步 IPC（`app:boot`）拿到首屏需要的值，不会先闪一下再变色。

## 数据目录

Pi Desktop 只把**自己的**数据放在 `~/.pi-desktop`（可用 `PI_DESKTOP_HOME` 指向别的位置，测试就靠它隔离）。pi 的配置留在 pi 自己的默认位置，Electron 的 Chromium 数据留在系统默认目录，互不混用。

| 位置 | 内容 |
|---|---|
| `~/.pi-desktop/settings.json` | 应用偏好：主题、通知、输入预测、默认分区、worktree 位置… |
| `~/.pi-desktop/sessions.json`、`projects.json`、`workFolders.json` | 会话元数据、Code 项目列表、Work 文件夹列表 |
| `~/.pi-desktop/cache/models-dev.json` | models.dev 目录缓存（按天刷新，可随时删除） |
| `~/.pi-desktop/demo/` | 首次启动复制的演示项目和 Work 演示文件夹 |
| `~/.pi-desktop/work/` | 没有选择文件夹时 Work 任务的临时工作区 |
| `~/.pi-desktop/extensions/` | Pi Desktop 自己的扩展目录，和 pi 的扩展分开，不污染 `~/.pi` |
| `~/.pi-desktop/.worktree/` | Code 会话 git worktree 的默认根目录；可在设置 → 项目与文件夹 → Worktree 位置改成任意本地文件夹，只影响之后新建的会话 |
| `~/.pi/agent/` | pi 自己的配置：`auth.json`、`models.json`、`sessions/`、扩展 / 技能 / 提示模板、MCP。路径由 pi SDK 决定（`PI_CODING_AGENT_DIR` 可覆盖），Pi Desktop 只在原处读写，不搬家 |
| Electron 的 Chromium 数据 | 仍在系统默认位置（macOS 为 `~/Library/Application Support/Pi Desktop`），和上面的应用配置无关 |

## 架构

```
Renderer (src/renderer)            Main (src/main)                  Agent host (src/agent, utilityProcess)
┌────────────────────────────┐ IPC ┌──────────────────────────┐ port ┌──────────────────────────────────────┐
│ React + shadcn/ui          │◀───▶│ 窗口 / 设置 / 项目        │◀────▶│ SessionHub                           │
│ zustand 状态，pi 事件 →     │     │ 对话框、剪贴板、shell     │      │  每个会话一个 AgentSessionRuntime     │
│ transcript（store/）        │     │ 会话调用原样转发给 host    │      │  （pi SDK，进程内）                    │
│ preload：只暴露协议里的通道 │     │ host 崩溃后下次调用自动重启│      │  desktop-kit · demo 模型 · 命名 · git │
└────────────────────────────┘     └──────────────────────────┘      └──────────────────────────────────────┘
                     src/shared：三方共用的协议类型、附件消息格式、工具预览
```

<details>
<summary><b>目录 / 文件一览</b>（点击展开）</summary>

| 目录 / 文件 | 作用 |
|---|---|
| `src/shared/protocol.ts` | 三个进程之间的契约：渲染进程能调用的每个通道（`Api`）、哪些转发给 agent host（`HOST_CHANNELS`）、host 推回的事件流（`HostEvent`）、交互请求（`UiRequest`） |
| `src/agent/app-paths.ts` | 应用自己的数据目录（`~/.pi-desktop`、`PI_DESKTOP_HOME`）、worktree 根目录、扩展目录；pi 的配置目录只读解析，不搬家 |
| `src/agent/hub.ts` | 会话元数据、worktree、`createAgentSessionRuntime` 创建 / 恢复会话、事件转发、交互请求（权限 / 计划 / 扩展对话框）、子 agent、会话命名、CLI 会话导入 |
| `src/agent/desktop-kit.ts` | 每个会话一个实例的 pi 扩展：权限模式、output style、`bash`（含 `workdir`，见下）、`pidesk_todo_write`、`pidesk_exit_plan_mode`、`pidesk_task`（子 agent）、`pidesk_bg_*`（后台 shell）、`pidesk_suggest_task`、会话间通信；`src/agent/manage-tools.ts` 里的 `pidesk_schedule_*`（定时任务）和 `pidesk_customize_*`（技能 / 连接器 / 插件），让 AI 在对话里代你管理 Scheduled 和 Customize 页 |
| `src/agent/shell-session.ts` | 模型的 shell：一个会话共用的常驻 bash（命令经临时脚本 + 结束标记驱动），以及“每条命令一个进程”的回退 |
| `src/agent/model-admin.ts` | 模型管理：provider / 登录方式枚举、OAuth 与 API key 登录事件桥接、登出、自定义端点保存与热加载 |
| `src/agent/endpoints.ts` | `models.json` 读写（保留手写字段）、`/models` 发现、本地端点占位密钥 |
| `src/agent/models-dev.ts` | models.dev 目录（按天缓存）：按模型 ID / canonical ID 匹配上下文、输出上限和价格 |
| `src/agent/scheduler.ts` / `src/shared/schedule.ts` | 定时任务：任务存储与调度循环（host 内）；计划类型、cron 解析、下次运行时间（host 与界面共用的纯函数） |
| `src/agent/customize.ts` / `src/agent/agents.ts` | Customize 页后端（技能 / MCP / 插件 / 提示模板读写 pi 自己的文件）；子 agent 身份加载 |
| `src/agent/pr-watch.ts` | host 内的 PR watcher（轮询 `gh pr view` / `glab mr view`，必要时起 turn） |
| `src/agent/naming.ts` / `src/agent/suggest.ts` | 后台小请求：会话命名与下一句输入预测（`completeSimple`，不进会话上下文） |
| `src/agent/side-model.ts` | 给后台请求挑同 provider 里最便宜的小模型 |
| `src/agent/demo-model.ts` | 离线演示模型：pi-ai 的 faux provider 注册到共享的 `ModelRuntime`，按脚本调用 pi 的**真实工具** |
| `src/agent/index.ts` | utilityProcess 入口：按 id 关联调用与结果，事件单向推送 |
| `src/main/agent-client.ts` | 启动 / 重启 agent host，`call(method, ...args)` |
| `src/renderer/src/store/transcript.ts` | pi 事件流 → transcript 条目的纯函数（流式文本 / 思考、工具组、权限卡片、计划、todo） |
| `src/renderer/src/store/actions.ts` | 发送、插话 / 排队、停止、模式 / 模型 / 思考强度、面板、PR 轮询等界面逻辑 |
| `src/renderer/src/components/` | 侧边栏、对话、输入框（附件、`/` 命令、`@` 文件 / 终端 / 变更 / 会话）、右侧工作区（Diff / 预览 / 文件 / 终端 / 计划 / 子 agent / 文件查看器 / Work 进度） |

</details>

为什么用一个常驻 utilityProcess：pi SDK 是 ESM、会执行工具和用户扩展，放在主进程里重负载时会拖慢窗口、崩溃会带走整个应用；而每会话一个进程又浪费资源。现在 agent host 崩溃只会让正在运行的会话中断，下一条消息会自动重启并从会话文件恢复。

### pi 事件与界面的对应

| 界面 | pi SDK |
|---|---|
| 发送 / 运行中 ↵ 插话 / Ctrl·⌘+↵ 排队 / Esc | `session.prompt` / `prompt(..., { streamingBehavior: "steer" })` / `followUp` / `clearQueue` + `abort` |
| 流式回复、思考 | `message_update`（`text_delta`、`thinking_delta`），以 `message_end` 为准 |
| 工具组 “Ran…, read…, edited…” | `tool_execution_start` / `_end` |
| 待办卡片 | `todo_write` 工具结果里的 `details.todos` |
| 运行结束 | `agent_settled`（`agent_end` 之后 pi 可能还会重试或压缩，不能当作结束） |
| 模型 / 思考强度 / 上下文圆环 | `ModelRuntime.getAvailable`、`setModel`、`setThinkingLevel`、`getSessionStats` |
| `/compact` `/context` `/clear` `/export` | `compact`、`getSessionStats`、`runtime.newSession()`、`exportToHtml` |
| 终端面板里输入的命令 | `executeBash`（输出会进入下一轮上下文） |
| Transcript view（Normal / Thinking / Verbose） | 纯前端：思考折进工具组，按模式决定摘要、思考或全部步骤 |
| Output style（Default / Proactive / Concise / Explanatory / Learning） | desktop-kit 在 `before_agent_start` 追加对应系统提示 |

### Transcript view 与 Output style

会话标题旁的下拉菜单（或 `Ctrl/⌘+O`）控制 transcript 的详细程度，对应 Claude desktop Code tab 的三个视图：

| 模式 | 显示内容 |
|---|---|
| **Normal**（默认） | 隐藏思考；同一段回复里的工具调用合并成一行摘要，例如 `Ran 2 commands, read 3 files, edited a file +14 −1` |
| **Thinking** | 工具调用仍折叠成摘要，额外显示 `Thought for 12s`（可展开） |
| **Verbose** | 展开工具组，显示每次命令、读文件和思考内容 |

`Output style` 在同一菜单里，和权限模式一样即时生效（直接改 desktop-kit 的会话状态）；它改变的是 Pi Desktop 的回答方式，不是界面，也不是权限。Normal 模式是默认值，选择保存在 localStorage；`Output style` 同时写入当前会话元数据，恢复会话后继续生效。

> 提示：Claude desktop 里 `Thinking` 只在会话已经产生过思考后出现；这里也做了同样的处理。`Ctrl+O` 只在可用的模式之间循环。

### 历史消息操作

历史用户消息下方提供复制、回退和创建分支。回退移除当前上下文中的该消息和后续对话，并把文字与可恢复的附件放回输入框；新分支创建独立会话、保留原对话，从所选消息之前开始并恢复原文。消息使用 pi 的稳定 entry ID 定位，重复文字不会定位错；回退位置会立即持久化。任务运行时暂时禁用历史操作；这些操作只改变对话，已经产生的文件改动会保留。

### 上下文压缩

执行 `/compact`、上下文弹窗里的「立即压缩」或 pi 自动触发压缩时，会话页底部显示「正在压缩上下文…」，侧边栏同步转圈；压缩期间输入框只保留停止按钮，`Esc` 也能取消。结束后摘要作为一张「上下文已压缩 · 120.0k → ~12.0k tokens」卡片进入 transcript，卡片默认展开摘要，被摘要替代的历史默认收起；点「显示之前的 N 条消息」展开。重开会话时摘要仍在，历史消息在点击时才从会话文件读回，不会一次性加载。

### 空闲会话重建上下文

隔了很久再对一个会话说话时，提供方那边的 prompt cache 早就过期，整段历史只能按全价重发。所以在下一次真实消息之前，如果会话空闲超过了阈值、上下文又足够大（`IDLE_RESET_MIN_TOKENS`），就先把上下文重建：

- 旧消息用 `SessionManager.appendContextEdit(id, null)` 从模型上下文里移除。这是 append-only 的投影编辑，**不删会话文件、不调用模型、不花钱**，所以不像 `/compact` 那样还要为摘要再付一次请求。
- 留下一张交接卡（`custom_message`，`customType` 为 `pi-desktop-handoff`）：最近的请求、最后停在哪儿、改过和看过的文件，以及「需要更早的决定时用 `pidesk_search_session` 查，不要猜」。transcript 里这张卡是一行「上下文已重建 · 空闲 5m · 丢弃 64.2k tokens」，被它替掉的历史默认收起，点「显示之前的 N 条消息」再从会话文件读回，和压缩卡片同一套机制（`sessions:handoffHistory`）。
- `pidesk_search_session` 检索的是本会话自己的 JSONL，包含 tool call 的参数和命令输出，所以文件路径和报错都能搜到；返回最新几条摘录。

阈值按 `模型自己的设置 → 模型声明的缓存寿命 → 全局值` 解析：pi-ai 的模型目录里 Anthropic 等提供方已经声明了 `promptCache`（如 `short: 300` / `long: 3600` 秒），所以 Claude 默认 5 分钟就重建；没有声明的模型走全局值（默认 60 分钟，0 表示关闭）。设置 → 通用 → 空闲上下文里可以改全局值，也可以给单个模型覆盖（0 = 只关这个模型）。`PI_CACHE_RETENTION=long` 时按长档解析，和 pi 判断缓存是否还热的规则一致。

### 会话与项目管理

- **新建会话立刻进入对话页**：`sessions:create` 只写元数据就返回；git worktree 和 Agent（扩展、MCP）在第一次启动时后台创建，进度以 `setup` 事件推给界面，对话里显示“正在启动会话…”的步骤卡片，失败时带原因，再发一条消息会重试。打开已有会话时同样显示。
- **归档 / 删除**（侧边栏会话右侧的「…」、顶栏菜单、More → Archived sessions）：归档只关闭 Agent，对话和 worktree 原样保留，可随时恢复；删除会清掉对话文件和 Pi Desktop 自己创建的 worktree（有未提交改动或未推送提交时先在确认框里说明；有只存在于该分支的提交时分支会保留）。用户自己建的 worktree、从 pi CLI 导入的会话文件永远不会被删。
- **移除项目**（项目标题右侧「…」）：只是不再出现在 Pi Desktop 里，文件夹不动，它的会话被归档，可以在 Archived sessions 里找回。
- **打开的文件夹本身是另一个项目的 worktree**：添加项目时会问“作为主仓库项目下的新会话”还是“独立项目”。前者直接在这个 worktree 里工作（不再新建 worktree，Diff 以它离开主分支的位置为基线），需要时一并添加主仓库为项目。
- **建议任务**：Agent 发现当前任务之外的事时调用 `pidesk_suggest_task`，对话里出现卡片：**Start** 在同一项目里新开一个会话（侧边栏里挂在当前会话下面，你留在原处）、**Do it here** 作为一条消息发给当前会话、忽略；多条时有 **Start all**。选择会记在会话里，重开后不会再点一次。
- **会话之间通信**：同一项目的会话可以互相 `pidesk_list_sessions` / `pidesk_read_session` / `pidesk_send_message`。消息以带发送者标记的用户消息送达，接收方显示为“来自会话 …”卡片，可点回发送方；对方正忙时排队到当前一轮结束后；已归档会话收不到；同一对会话 10 分钟内最多 8 条，防止互相回复停不下来。发送受权限模式约束（plan 模式拒绝，default 模式会先问）。

### 会话命名

新会话的名字来自用户的第一条提示词，但分两步：

1. **先顶着**：第一条真实提示词（跳过 `/命令`）会立刻成为标题——去掉 `@文件`、代码块，压成一行并截到 60 字。
2. **再取名**：同时通过共享的 `ModelRuntime.completeSimple` 单独请求一次模型，取一个 2–5 个词的名字。这次请求不经过任何会话、不带工具，用当前 provider 里单价最低的小模型（20 秒超时），所以它不占会话上下文、也不拖慢会话的第一轮。结果写回会话元数据，并通过 `setSessionName` 写进 pi session。

手动重命名后就不再自动命名；模型给出的是句子或礼貌回复时会被丢弃，保留提示词标题。离线演示模型没有可用的真实模型，自动跳过。

### 输入预测

每轮任务结束（`agent_settled`，主动中断不算）后，如果当前打开的会话输入框是空的、窗口也没有隐藏，界面会通过 `sessions:suggest` 让 agent host 单独请求一次模型，猜用户下一句会说什么，并以灰色 ghost text 显示在空输入框里。

- 和会话命名一样，这次请求**不经过会话**：不带工具，8 秒超时（全上下文 20 秒）；不占会话上下文，也不会写进 transcript。
- **模型**（设置 → 通用 → 输入预测 → 预测模型）：**自动**（默认，session 所属 provider 里单价最低的小模型）、**跟随会话**（用会话当前的模型，更好但可能更贵）、**指定模型**（从已配置凭据的模型里选一个）。指定的模型不可用时回退到自动；离线 Demo 模型不参与预测。
- **上下文**：默认最近 6 条 user / assistant 消息，可改成 1–50 条；打开「全部上下文」会发送整段对话，并按预测模型的上下文窗口截断（最多约 12 万字符）。工具输出不参与；消息里附带的文件 / 选区上下文会在发送前剔除。
- **采用**：在空输入框里按 `→`（光标在末尾时）或 `Tab`，灰色文字变成真正的草稿，再按 `↵` 发送；`Esc` 忽略。任何输入都会让预测消失；切换会话、开始新的一轮或停止运行会取消或丢弃旧的预测。
- 预测失败、超时、返回拒绝或复述上一句时什么都不显示；可以在 设置 → 通用 → 输入预测 关闭（默认开启）。

### 会话布局与滚动位置

- **每个会话记住自己的布局**：哪些面板开着（Diff / 预览 / 文件 / 终端 / 进度 / 子 agent）、分栏的宽度、以及被放大的那张卡片，都跟着会话走，切回来原样恢复。文件发生改动不会自动打开 Diff——只有你自己点顶部按钮或 `Ctrl/⌘+D` 才会打开。布局按会话 id 记在 localStorage（`pd_panels:<id>` 和分栏尺寸），重启应用后依然有效。
- **滚动位置**：切回会话时回到上次停留的位置；只有会话在关闭期间产生了新消息（侧边栏有未读圆点）时才直接跳到最新一条。往上翻时底部中央会出现悬浮的 **Latest** 按钮，点一下平滑回到底部，回去后自动消失。
- **大 diff 默认折叠**：单个文件改动达到 400 行，或新旧内容合计 200 KB 时，Diff 面板只显示文件头和 `Large diff · +a −b lines · hidden by default`，点 **Show diff** 才渲染行（生成文件如 lockfile / 打包产物同样默认折叠）。改动行数按内容指纹缓存，同一份内容不会重复做一次 O(n²) 的行级 diff。

### 文件工具预览与附件

- **Read / Edit / Write**：展开工具行可查看带行号的读取片段、本次编辑的红绿 diff，或实际写入的内容快照。点击文件名会在现有右侧文件查看器打开**当前正文**并定位；历史快照不会被当前正文或累计 Git diff 替代。需要累计改动时使用独立的 **Diff** 入口。
- **选区与评论**：在 Diff 或文件正文预览中选择代码，可以附加为上下文或添加评论；也可点击行号旁的 `+`，用 Shift 点击选择多行。评论编辑器显示在选区下方，引用和评论以可移除卡片加入当前会话草稿，随下一条消息发送；模型收到文件路径、行号、旧侧 / 新侧和选中代码的快照。最多 20 项引用，总内容最多 100,000 个字符。
- **树列表右键菜单**：Diff 和 Files 中的文件、文件夹支持附加为上下文，复制绝对路径 / 相对路径 / 名称，用 VS Code / Cursor / Terminal / 默认应用打开，以及在 Finder（其他平台为文件管理器）中显示。Terminal 打开所选文件的所在目录；已删除的文件可从 Diff 快照引用。
- **添加附件**：Code 和 Work 的输入框都支持粘贴截图、复制的本地文件、拖入文件，以及点击 **+** 多选文件。发送前可以预览和移除，也可以只发附件。多行文字保留换行、制表符和缩进，富文本只提取纯文本，不加载其中的远程内容。
- **`@` 与 `/` 菜单**：两个菜单都按模糊匹配排序（任意顺序的字符也算命中：前缀优先，其次词首，再次分散字符），项目有几千个文件时也只扫一遍、只留前几十项，不会因为列表变长而卡。`@` 可以引用项目文件、当前会话的终端标签页（抓取最近 N 行，N 在 设置 → Code → 终端）、工作区变更（跟 Diff 面板一致：会话基准以来改动的文件和行数），以及同项目的其它会话（只发标题和 id，模型需要时用 `pidesk_read_session` 去读）。`/` 列出应用自己的命令和 pi 的技能 / 提示模板。
- **内联 badge**：`@` 引用和消息开头的 `/命令` 在输入框里就画成药丸，发送后仍以 badge 嵌在消息气泡里；点 badge 查看当时抓取到的内容（终端快照、变更文件列表、另一个会话），文件 badge 直接打开文件。快照在选中那一刻拍下，所以提示词里的内容和 badge 里看到的完全一致；删掉 badge 的 token，这段上下文就不会随消息发出。
- **发送与恢复**：附件单独排列在文字气泡上方，图片可点击放大。图片使用 pi 原生 image blocks 传给支持图片的模型并随会话保存；普通文件是供 agent 读取的**本地路径引用**，不会自动解析 PDF / Office，也不会另存一份。移动或删除原文件后，该引用可能失效。
- **草稿与取消**：会话间草稿互相隔离；导入失败或发送失败不会清空附件。停止运行时，已取消的排队消息可恢复为草稿；有新草稿时显示 Restore / Discard，避免覆盖。未发送草稿仅在本次应用运行期间保留。
- **默认限制**：每条消息最多 10 个附件，单个源文件最多 20 MiB、源文件合计最多 50 MiB。图片会缩放至最长边 2000 px，单张输出 base64 最多 4.5 MiB、图片 base64 合计最多 20 MiB。不支持图片的模型会明确报错；应用自己处理的 slash command（`/compact`、`/clear` 等）带附件会被拒绝，不会静默执行后丢掉附件，`/skill` 之类的技能消息可以带 `@` 引用。

历史恢复沿用 pi 会话里的 `session.messages`：可恢复当前会话上下文中的附件。压缩过的会话保留一张摘要卡片，被摘要替代的消息默认收起，点击时再从会话文件读回；不提供历史分支浏览器。文件正文预览限于当前会话工作目录内、最多 1 MiB 的文本文件；历史内联工具片段不受文件后来移动或删除影响。

### PR 条与 CI 自动化

Code 会话输入框上方的 PR 条报告当前分支的 PR：状态颜色、`+2,504 −132` 这样的改动规模、评审意见数，以及一个 CI 圆点（未开 PR 时这里显示工作区里待提交的改动）。点编号在 GitHub 打开 PR。

悬停编号会展开一张卡片：`Merge conflicts` / `Draft` / `Checks failing` / `Ready to merge` 这类状态、PR 标题、作者、改动行数和文件数、最近更新时间。数据来自 `gh pr view`（GitLab 仓库用 `glab mr view` 和 `glab api`，Merge Request 在这里同样叫 PR；未解决的讨论按「Changes requested」处理，没有行数统计），token 读不到的字段就不显示，条本身照常工作。

点 **CI** 打开检查面板：逐条列出每个检查的结果（点名字直接打开那一条的日志），一行说明是全部通过、几个在跑还是几个失败，右上角通往 GitHub 的 checks 页。同一个检查重跑过几次也只列最新的一次：旧的结果不会再混进来，也不会被误判成失败。面板底部两个开关保存在会话里，重启后仍然有效：

- **Auto-fix CI & address comments**：CI 变红时自动让 agent 读失败日志、修好并推送；同一个提交只触发一次，不会循环。新评论和 `CHANGES_REQUESTED` 也会处理（同一轮的修复会顺带带上它们）。
- **Auto-merge when ready**：GitHub 说分支可合并、检查既不红也不在跑、也没有待处理的评审意见时，自动让 agent 用 `gh pr merge --auto` 开启自动合并；每个 PR 一次。

**监听发生在 host 里，不是让 agent 去盯着。** 每个打开着的 Code 会话在 agent host 里有一个 PR watcher：`gh pr view` 每 15 秒看一次（CI 已结束就退到 60 秒，`gh` 连续失败则退避到 5 分钟），把状态推给 PR 条，并在 CI 变红、有新的评论/评审、PR 变得可合并时**自己起一个 turn**。这类 turn 的消息不是用户发的，transcript 里渲染成一张事件卡片——`CI 失败 · PR #4`、新评论原文、失败检查列表，下面实时显示「Pi 正在处理…」/「等待你的确认」；展开还能看到交给 Pi 的说明。重开会话后卡片仍在。修复的 turn 在 `push` 后就结束，不会自己去 `gh pr checks --watch` 或轮询 CI：下一次结果仍由 host 的 watcher 看准了再起新 turn。

会话正在跑的时候事件不会插队，等它空闲后的下一次查看再发，所以既不会打断你，也不会丢。因为那是真正的 turn，`git push` 这类高风险命令仍然会先问你（这就是卡片上「等待你的确认」的由来）。

### 定时任务（Scheduled）

侧边栏的 **Scheduled**（Code 和 Work 各列自己的任务）让任务按计划自动运行。任务在 agent host 里执行，应用开着才会触发。

- **计划类型**：手动、每小时、每天、工作日、每周、一次性、cron（5 个字段，本地时间）。
- **每次运行都是一个全新会话**：Code 可选在独立 worktree 里跑；Work 可指定文件夹，或每次用临时工作区。权限模式和模型随任务保存。
- **调度规则**：host 里每 30 秒检查一次；应用关闭期间错过的任务启动时补跑一次（最多回溯 7 天）；上一次运行还没结束就跳过；一次性任务跑完自动停用。
- 页面支持立即运行、暂停、编辑，并保留最近 30 次运行记录（可跳到对应会话）。

### Customize

**Customize** 页把 pi 的扩展点做成界面，读写的都是 pi 自己的文件，所以和 CLI 始终一致：

| 分区 | 对应 pi |
|---|---|
| Skills | `SKILL.md` 技能目录 |
| Connectors | MCP 服务器（`mcp.json`，个人级和 `<项目>/.pi/mcp.json`） |
| Plugins | pi packages（`settings.json` 的 `packages`） |
| Commands | 提示模板（`/` 命令） |
| Subagents | 子 agent 身份，见下 |

项目级条目只对已信任的项目生效。

### 模型的 shell

pi 默认每条命令起一个进程，一条命令里的 `cd` 到下一条就没了。Pi Desktop 用自己的 `bash`（`src/agent/shell-session.ts`）替换了它：

- **共用一个 shell（默认）**：每个会话一个常驻 shell，`cd` 和 `export` 的变量带到下一条命令，和 Claude Code 一样。命令先写进临时脚本再 `source`，所以模型写错引号或 heredoc 只会让那条命令失败，不会卡住 shell；超时或停止会杀掉整个进程组，下一条命令自动换一个新的。
- **每条命令独立**：每条命令单独一个进程，从会话目录开始。
- 两种模式都可以给 `bash`（以及 `pidesk_bg_shell`）传 `workdir`，在子目录里跑一条命令而不用 `cd`；共用 shell 下用子 shell 包住，不改变 shell 当前所在目录。
- 命令把 shell 留在会话目录之外时，结果末尾会多一行 `[shell folder: …]`，模型据此知道自己站在哪（`read` / `edit` 的相对路径仍按会话目录算）。
- 切换在 设置 → 通用 → 基础 → 命令使用的 shell（Work 和 Code 都会生效），立即生效；只作用于 `bash`。Windows 上如果改用 pi 的 `powershell` 工具，仍然是每条命令一个进程。
- 共用 shell 起不来时（例如 Windows 没装 Git Bash）自动退回每条命令一个进程，并在结果里说明一次。

### 后台任务与子 agent

- **子 agent**（`pidesk_task`）：内置 `explore`、`plan` 两种身份；自己的身份是 `~/.pi-desktop/agents/*.md`（frontmatter 写 `name`、`description`、可选 `model` 和 `tools` 白名单，正文是系统提示），可在 Customize → Subagents 里编辑。子 agent 始终运行在 plan 模式，配置不能放宽它能改的范围；只加载只读的 MCP 工具。
- **后台运行**：`pidesk_task` 可带 `run_in_background`，立即返回，报告稍后作为任务通知唤醒模型。`pidesk_bg_shell` / `pidesk_bg_output` / `pidesk_bg_kill` 用来跑长期存活的 shell 命令。两类任务共用 **Background tasks** 面板，可查看、停止；它们不随发起它们的那一轮结束，但停止该轮时会一并停掉，避免任务事后又把会话唤醒。
- 内置工具统一使用 `pidesk_` 前缀；transcript 仍能读懂旧会话里记录的裸名称。

### 远程（Remote）

一台电脑上的 Pi Desktop 可以遥控另一台电脑上的会话，会话始终在**被遥控的那台**运行（文件、shell、模型凭据都在那边），这边只是界面。有两种被遥控的对象，对 Desktop 客户端来说协议完全相同：

- **另一台 Pi Desktop**：设置 → 远程 →「共享这台电脑」开启，把地址和访问令牌告诉对方。
- **只装了 pi 命令行的电脑**：安装 `pi-remote` 插件（`pi install npm:@liuscraft/pi-remote`，设置 → 远程 里有现成命令；开发时可 `pi install` 仓库里的 `plugin/pi-remote` 目录），在 pi 里执行 `/remote start [--lan] [--port N]`，或用 `pi --remote` 启动即自动开启；`/remote status | token | rotate | stop`。插件在 pi 进程内跑一个无头的 session hub（共用 pi 的登录与模型配置，状态放 `~/.pi-remote`，`PI_REMOTE_HOME` 可改），pi 退出服务即停止。插件和 App 由同一个 tag 发布（见「发布一个版本」），所以 npm 上的版本和 dmg 对齐。

连接端：设置 → 远程 →「连接到远程」添加地址 + 令牌并点「连接」，主窗口整体切换为对方的项目与会话（侧边栏底部显示连接状态与「断开」）；断开后回到本机。断线会自动重连，重连后重新读取对方的会话状态。

协议（`src/shared/remote.ts`，实现在 `src/agent/remote/`）：不引入新依赖，纯 HTTP —— `POST /v1/rpc {method,args}` 对应 agent host 的一次调用，`GET /v1/events` 是 SSE 事件流（即 `HostEvent`），`GET /v1/ping` 免令牌用于识别。`ping` 带 `version`（`REMOTE_API_VERSION`），两边对不上时连接直接失败并说明该更新哪一边，不会连上去才在某个调用上莫名其妙地报错。凭 `Authorization: Bearer <令牌>` 鉴权。服务端只放行 `HOST_CHANNELS`、项目/文件夹列表与 `remote:browse`；浏览器登录类调用（`models:login*`）因需要对方本机界面而不开放。`ProjectBook` 保存对方的项目列表，所以远程添加项目是在对方的目录树里选。

跨网络连接：Pi Desktop 的远程功能**默认关闭**（不监听任何端口）。要从外网连，开启「通过 Cloudflare Tunnel 公开」（插件用 `/remote start --tunnel`）：本机用 `cloudflared tunnel --url` 起一个免账号的 `https://xxx.trycloudflare.com` 快速隧道，设置页显示该地址，对方当作连接地址填入即可（HTTPS，无需端口映射）。需先安装 `cloudflared`；地址每次启动都会变。隧道对公网可达，所以令牌就是唯一的门，别泄露。

安全模型：**令牌等于对方那台电脑上的命令执行权限**（会话能跑 shell），按密码保管。默认只监听 `127.0.0.1`（可配合 SSH 隧道 / Tailscale）；开启「局域网访问」后监听所有网卡，但连接**不加密**，不要暴露到公网。

远程模式下的限制：终端面板、「在编辑器中打开」、「在访达中显示」作用于本机文件系统，不可用；文件附件是本机路径，对方读不到（图片内联，可用）；定时任务只在 Pi Desktop 主机上有，插件主机没有；插件模式下 `models:login*` 需在那台电脑上用 `pi` 完成登录。

### 其他界面细节

- **Mermaid**：回复里的 `mermaid` 代码块渲染成图。
- **桌宠**：输入框旁的状态宠物，可在设置里关闭或换皮肤；侧边栏的会话状态图标一眼看出谁在跑、谁在等批准。
- **系统通知**：需要批准或会话完成时发 OS 通知，点击跳回对应会话；toast 只用于出问题的情况。

### Work 与 Code 的区别

| | Code | Work |
|---|---|---|
| 工作目录 | 项目的独立 worktree（`claude/<名字>` 分支，默认在 `~/.pi-desktop/.worktree`，可在设置里改根目录） | 选定的文件夹，直接修改；或新建的临时工作区（`~/.pi-desktop/work`） |
| 会话配置 | desktop-kit profile `code` | desktop-kit profile `work`，追加系统提示 `src/agent/work-prompt.md` |
| 右侧面板 | Diff、计划、子 agent、终端、预览 | 进度、生成的文件（可预览、打开、在文件夹中显示）、上下文 |
| 底部 | PR 条 + CI 状态 | — |
| 额外需要确认的命令 | — | 删除 / 移动文件（`rm` `mv` `del`…）、往外发数据（`scp` `rsync`、带 POST/上传参数的 `curl`/`wget`、`mail`） |

### 权限模式（desktop-kit）

pi 本身不做权限确认。desktop-kit 在 `tool_call` 钩子里按模式决定放行、拦截，还是询问用户；询问通过 `KitHost.ask()` 变成一条带 `toolCallId` 的 `UiRequest`（`kind: "permission"` / `"plan"`），由界面渲染成权限卡片或计划审批。其他 pi 扩展调用的 `ctx.ui.select / confirm / input / editor` 也会变成 transcript 里的卡片。

| 模式 | 编辑项目内文件 | 只读命令 | 其他命令 | 高风险命令（push、发 PR、rm -r…） |
|---|---|---|---|---|
| Auto（默认） | 放行 | 放行 | 放行 | 询问（Work 中删除 / 移动文件也算高风险） |
| Ask permissions | 询问 | 放行 | 询问 | 询问 |
| Accept edits | 放行 | 放行 | 询问 | 询问 |
| Plan | 拦截 | 放行 | 拦截 | 拦截 |
| Bypass | 放行 | 放行 | 放行 | 放行 |

- 编辑项目目录**之外**的文件，除 Bypass 外一律询问。
- 选择“始终允许”时：命令按前两个词记入本会话白名单；编辑则把本会话切换到 Accept edits。
- 模式保存在每个会话自己的 desktop-kit 状态里，界面随时切换，下一次工具调用立即生效（运行中也一样）；计划审批、“始终允许”编辑引起的模式变化通过 `meta` 事件通知界面。
- 停止运行或会话关闭时，等待中的询问会自动取消。

## 测试

```bash
npm run typecheck   # main / agent / preload 与渲染进程两套 tsconfig
npm test            # vitest：真实的进程内 pi 会话 + desktop-kit + 演示模型，无需 API Key
npm run test:coverage # 同上并输出覆盖率（CI 上传到 Codecov）
npm run test:desktop # 构建后用项目自带的 Electron 运行 Playwright 窗口交互测试
```

<details>
<summary><b>测试文件一览</b>（点击展开）</summary>

- `test/hub.e2e.test.ts`：Auto 模式在隔离 worktree 里修 bug（修复前测试真的失败，修复后真的通过，主工作区不被改动）、worktree 默认根目录与设置里的自定义根目录、Ask 模式拒绝、Plan 模式审批后自动切到 Accept edits、运行中切换模式、进程内子 agent、高风险命令仍需询问、带图片附件的会话关闭后从会话文件恢复、`/clear`、首条提示词命名与手动重命名；Work 整理收件箱时只有移动文件需要确认、拒绝后文件保持原样、生成简报文件、临时工作区。
- `test/desktop/interactions.spec.ts`：临时配置目录（`PI_DESKTOP_HOME`）中的真实 Electron 窗口，覆盖模型元数据编辑、价格 0、token 限制校验、文件菜单、预览引用、Diff 评论、随消息发送及历史回退 / 分支；`test/context-reference.test.ts` 覆盖引用格式、草稿隔离与恢复、容量限制。
- `test/desktop/sessions.spec.ts`：真实窗口里的会话生命周期（新建、归档、恢复、删除、移除项目），以及每个会话自己的工作区（不会自动弹出 Diff，切回来时布局还在）。
- `test/session-ui-memory.test.ts` / `test/diff-fold.test.ts`：面板与滚动位置的记忆（按会话隔离、删除会话时清掉），以及大 diff 的折叠阈值和改动行数缓存。
- `test/schedule.test.ts` / `test/background-tasks.test.ts` / `test/agents.test.ts` / `test/customize.test.ts`：计划与 cron 计算、后台任务生命周期、子 agent 身份加载、Customize 对 pi 配置文件的读写。
- `test/bash-shell.test.ts`：Windows 上挑 `bash.exe` 的规则（标准 Git 安装、`where git` 指向的自定义安装、MSYS2，以及绝不选中 System32 的 WSL 启动器）。
- `test/attachment-message.test.ts` / `test/attachments-backend.test.ts`：附件消息往返、校验限制、剪贴板格式（macOS / Windows / Linux）和图片规范化。
- `test/tool-previews.test.ts` / `test/files.test.ts`：原生工具输出、行号 / 分页，以及文件边界、符号链接（需要系统允许创建符号链接）、二进制和大小限制。
- `test/naming.test.ts`、`test/suggest.test.ts`、`test/side-model.test.ts`、`test/git-pr.test.ts`：命名规则、输入预测的上下文裁剪与回复清洗、小模型挑选、`gh pr view` 结果映射。

</details>

## 打包与发布（macOS / Windows）

### Windows

需要 Windows + Node 22.19+，不需要额外工具链（NSIS 由 electron-builder 自动下载）。

```powershell
npm ci
npm run pack:win       # 只出 dist/win-unpacked/Pi Desktop.exe，最快
npm run dist:win       # NSIS 安装包 dist/Pi-Desktop-<版本>-win-x64-setup.exe
```

默认未签名（安装时会有 SmartScreen 提示）。要签名就设 `CSC_LINK`（pfx 路径或 base64）和 `CSC_KEY_PASSWORD`；CI 里对应仓库 secret `WIN_CERT_PFX` / `WIN_CERT_PASSWORD`。tag 推送时 `release.yml` 的 `windows` job 会把安装包挂到同名 Release。

Windows 上 agent 的 `bash` 工具需要一个真的 bash：Pi Desktop 启动时会从标准 Git 安装、`where git.exe` 指向的位置、以及 PATH 里的 MSYS2 / Cygwin 中挑一个，并把它的目录放到 PATH 最前面。找不到时不会退到 `C:\Windows\System32\bash.exe`（那是 WSL 启动器，没装发行版时会直接报 `execvpe(/bin/bash) failed`）。从资源管理器 / PowerShell 直接启动也能正常工作，不需要在 Git Bash 里运行。

### macOS

构建走 `Makefile`（CI 调的是同一批 npm 脚本），需要 macOS + Xcode 命令行工具（`xcode-select --install`，`codesign` / `iconutil` / `sips` / `hdiutil` 都在里面）和 Node 22.19+。

```bash
make help              # 列出所有目标
make install           # npm ci
make app               # 只出 .app（当前架构），几十秒，改完就能双击跑
make run               # 同上，然后 open 打开
make dmg               # 当前架构的 dmg
make dist              # arm64 + x64 各一个 dmg
make icon              # 重新生成 build/icon.png + icon.icns
make clean             # 删 dist/
```

产物：`dist/mac-arm64/Pi Desktop.app`（x64 是 `dist/mac/`）、`dist/Pi-Desktop-<版本>-<架构>.dmg`。dmg 里就一个 app 加一个 `/Applications` 快捷方式。

### 签名与公证

默认是**未签名**构建，本地能用；下载分发会弹 Gatekeeper。要正式发布就配好下面这套，配置一存在，`make dmg` 和 CI 都自动变成「Developer ID 签名 → 公证 → staple」，不需要改命令：

| 变量 | 含义 |
|---|---|
| `CSC_LINK` | 导出的 `.p12`（Developer ID Application），路径或 base64 |
| `CSC_KEY_PASSWORD` | `.p12` 的密码 |
| `APPLE_ID` | Apple ID |
| `APPLE_APP_SPECIFIC_PASSWORD` | App 专用密码（appleid.apple.com 生成） |
| `APPLE_TEAM_ID` | Team ID |

也可以改用 App Store Connect API Key：`APPLE_API_KEY`（.p8 路径）+ `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`，或钥匙串里的 `APPLE_KEYCHAIN_PROFILE`（`xcrun notarytool store-credentials`）。

`scripts/after-sign.cjs` 是 electron-builder 的 `afterSign` 钩子：拿到 Developer ID 签名就公证 + staple，没有就做一次 ad-hoc 签名（Apple Silicon 上完全没有签名的 arm64 app 根本起不来，所以 ad-hoc 不是可选步骤）。

### 发布一个版本

```bash
make release                  # 把最新的 v* tag 递增 patch（v0.1.2 → v0.1.3），给 HEAD 打 tag 并 push
make release BUMP=minor       # 递增 minor（BUMP=patch|minor|major）
make release VERSION=0.2.0     # 直接指定版本
make release DRY_RUN=1         # 只打印要打的 tag，不真的打、不 push
```

版本号以 tag 为准，CI 里写进 package.json，所以本地不 bump 也不提交。`scripts/release.mjs` 会先挡住几种常见误操作：worktree 脏、版本不比最新 tag 大（`FORCE=1` 可绕过）、tag 已在本地或 origin 存在；push 失败会把本地 tag 删掉，方便改完重试。`make release` 只打 tag + push，不 push 分支，HEAD 没推到上游时会给个 warning。

推上去的 `v0.2.0` tag 触发 `.github/workflows/release.yml`：arm64 和 x64 两个 dmg 在 `macos-14` 上交叉构建（没有按架构编译的原生模块，只有 Electron 的 zip 不同），然后 `gh release create/upload` 挂到同名 Release，附 `SHA256SUMS.txt`。签名靠仓库 secret：`MAC_CERT_P12`、`MAC_CERT_PASSWORD`、`APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID`；不填也能跑通，只是产物未签名。

不想走 tag 的话，本地直接 `GH_TOKEN=… make publish` 也能上传。

同一个 tag 还会发两样东西，各靠一个仓库 secret（没配时该步骤报警告或失败，不影响 dmg / exe）：

- **pi-remote 插件**（`plugin` job）：`npm run build:plugin` 之后 `scripts/publish-plugin.mjs` 用 tag 版本发布到 npm（`npm publish --access public --provenance`）。认证走 npm 的 **trusted publishing**：workflow 里的 `id-token: write` 换一张一次性 token，仓库里不存任何 npm 凭据（需要 npm 上一次性配好，见下）。版本已在 npm 上就跳过，重跑同一次 release 不失败；比 npm 上的 `latest` 还旧则直接报错（npm 会把 `latest` 移到最后发布的那版，力推旧 tag 会把大家的插件降级）。provenance 把 tarball 绑到这个 commit 和这次 workflow 上。
- **Homebrew cask**（mac job 的最后一步）：`scripts/cask.mjs` 按两个 dmg 的 sha256 生成 `Casks/pi-desktop.rb`，推到 `liuscraft/homebrew-tap`。凭据是那个仓库上的一把 **deploy key**（只写那一个仓库，别的什么都碰不到），私钥存为 `HOMEBREW_TAP_KEY`；没配时只打印生成的 cask。本地可以 `make cask` 看同一份内容。

两个发布目标各自的一次性配置（都在网页上，只能做一次）：

- npmjs.com → `@liuscraft/pi-remote` → Settings → **Trusted Publisher** → GitHub Actions：Organization `LiusCraft`、Repository `pi-desktop`、Workflow `release.yml`，并允许直接 `npm publish`。不配的话 `plugin` job 会以 `ENEEDAUTH` 失败（dmg/exe 不受影响）。
- `liuscraft/homebrew-tap` → Settings → Deploy keys：需要一把 write 权限的 key（当前这把的私钥在 `HOMEBREW_TAP_KEY` 里）；丢了就重新生成一对，把公钥加回去、私钥覆盖这个 secret。

`.github/workflows/build.yml` 是 PR 上的打包冒烟测试：跑 `--dir` 打包，然后断言 `Resources/app/node_modules/@earendil-works/pi-coding-agent` 和两个扩展真的进了包。

### 未签名产物怎么打开

首次打开会被拦（「无法打开，因为 Apple 无法验证」）：右键 → 打开，或者

```bash
xattr -cr /Applications/Pi\ Desktop.app   # 只在你自己确认过来源的情况下
```

### 两处刻意的选择

- **`asar: false`**：agent host 里的 pi SDK 要从文件系统读自己的资源、用 jiti 加载用户的 TS 扩展、加载预编译 `.node` 并启动工具二进制；全部保持普通文件最省心。代价是 app 目录里有一万多文件。
- **不做 universal 单包**：`@earendil-works/pi-tui` 自带 `darwin-arm64` / `darwin-x64` 两份预编译 `.node`，合并成 universal 要额外配 `@electron/universal` 的 `x64ArchFiles`，体积还翻倍。arm64 / x64 各一个 dmg 更省事。

README 里的界面图由 `npm run build && node scripts/screenshots.mjs` 用离线演示模型重新生成到 `docs/screenshots/`。

图标是 `scripts/make-icon.mjs` 用纯 Node（SDF 画形状 + 手写 PNG 编码，无依赖）生成的，改完跑 `make icon` 会一起更新 `.png` 和 `.icns`。

## 已知限制 / 下一步

- 定时任务只在应用运行时触发，没有系统级后台服务。
- Work 还没接日历、邮箱这类连接器；可以通过 pi 的 MCP（`~/.pi/agent/mcp.json`）或扩展接入。
- **Cloud 环境**还没实现，菜单里是禁用状态。
- pi 的 `find` 工具依赖 `fd`，pi 会自动下载；在离线环境下这一项会失败（`grep` 用系统里的 `rg`）。
- **PR / CI 状态**依赖 `gh`（GitHub）或 `glab`（GitLab，含自建实例）CLI 已登录。按 `origin` 的域名判断用哪个；域名里没有 github/gitlab 字样的自建主机会依次尝试两者。
- **预览**面板只允许 `localhost` 地址。
- React 重写版已在 Windows 11 上用真实窗口跑通离线 demo（Code 修 bug + Diff 面板、Work 整理收件箱 + 权限确认），并加载了用户自己的 pi 扩展；macOS 打包版尚未在重写后重新验证。旧版的 Playwright 界面测试（`test/ui-*.js`）随旧界面一起移除，界面自动化测试待补。
- 没有自动更新：Homebrew 装的用 `brew upgrade --cask pi-desktop` 升级，其余重新下载 dmg。要接 `electron-updater` 得再产一个 `zip` target（dmg 不能做增量更新），并加一个设置项。
