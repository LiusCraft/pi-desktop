# Pi Desktop

基于 [pi coding agent](https://github.com/badlogic/pi-mono) 的桌面端，界面仿照 Claude desktop，有 **Cowork** 和 **Code** 两种模式。界面用 React + TypeScript + [shadcn/ui](https://ui.shadcn.com) 构建；agent 直接复用 **pi SDK**（`createAgentSession`），所有会话跑在一个常驻的 Electron utilityProcess 里。Claude 风格界面里 pi 没有的能力（权限模式、计划审批、待办、子 agent）由内置的 desktop-kit 扩展补上。

- **Code**：在项目的独立 git worktree 里写代码，配有 diff、PR / CI 状态、终端和预览。
- **Cowork**：在你选的文件夹里做知识类工作，比如整理文件、写文档、做简报；不选文件夹时会新建一个临时工作区。右侧面板显示进度、Claude 生成的文件和任务上下文。

## 快速开始

```bash
npm install
npm run dev        # electron-vite 开发模式（界面热更新）
npm run build && npm start   # 构建后运行
npm run build && npm run demo  # 打开内置演示项目，默认使用离线演示模型
```

- 需要 Node 22.12+（构建与测试用）；运行时 agent 跑在 Electron 自带的 Node 上。
- 首次启动会把 `demo/todo-app`（Code 演示项目）和 `demo/cowork-workspace`（Cowork 演示文件夹：收件箱、日程、待办）复制到 `~/.pi-desktop/demo`。不配置任何 API Key 也能用 **Demo (offline)** 模型体验完整流程。
- 接真实模型：打开设置（`Ctrl/⌘+,`）→ **模型管理**，和 pi CLI 用同一套配置：
  - **账号登录**：Anthropic（Claude Pro/Max）、OpenAI（ChatGPT）、GitHub Copilot、xAI、Meta、Kimi、OpenRouter、Radius 等 provider 的 OAuth 登录，浏览器授权或设备码，凭证写入 `~/.pi/agent/auth.json`。
  - **API 密钥**：所有支持密钥的 provider，交互流程和 pi 的 `/login` 完全一致（包括需要多个环境变量的 provider）。
  - **自定义端点**：OpenAI Chat Completions / Responses、Anthropic Messages、Google Generative AI 兼容地址写入 `~/.pi/agent/models.json`；可以直接从端点的 `/models` 拉取模型列表。每个模型都能编辑名称、上下文大小、最大输出、四项每百万 token 价格、推理与图像输入能力；[models.dev](https://models.dev) 仅补充缺失值，手动值（包括免费价格 0）始终优先。保存不等待公开目录网络请求；目录中的 0 token 限制会忽略，重新保存端点也能清理旧配置里的无效 0 值。密钥仍只存 `auth.json`，本地端点自动写入 pi 的占位密钥。
  - 环境变量、`auth.json`、`models.json` 里已有的配置都会识别；你在 `~/.pi/agent` 里装的扩展、技能、提示模板和 MCP 服务器照常加载，和 CLI 一致。
- 设置窗口（`Ctrl/⌘+,`）是独立窗口：外观（浅色 / 深色 / 跟随系统、侧边栏）、通用（通知、输入预测、默认分区）、模型管理、项目与文件夹（Code 项目、Cowork 文件夹、worktree 位置）、关于。偏好保存在 `~/.pi-desktop/settings.json`，修改后主窗口立即跟随；preload 用同步 IPC（`app:boot`）拿到首屏需要的值，不会先闪一下再变色。

## 数据目录

Pi Desktop 只把**自己的**数据放在 `~/.pi-desktop`（可用 `PI_DESKTOP_HOME` 指向别的位置，测试就靠它隔离）。pi 的配置留在 pi 自己的默认位置，Electron 的 Chromium 数据留在系统默认目录，互不混用。

| 位置 | 内容 |
|---|---|
| `~/.pi-desktop/settings.json` | 应用偏好：主题、通知、输入预测、默认分区、worktree 位置… |
| `~/.pi-desktop/sessions.json`、`projects.json`、`coworkFolders.json` | 会话元数据、Code 项目列表、Cowork 文件夹列表 |
| `~/.pi-desktop/cache/models-dev.json` | models.dev 目录缓存（按天刷新，可随时删除） |
| `~/.pi-desktop/demo/` | 首次启动复制的演示项目和 Cowork 演示文件夹 |
| `~/.pi-desktop/cowork/` | 没有选择文件夹时 Cowork 任务的临时工作区 |
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

| 目录 / 文件 | 作用 |
|---|---|
| `src/shared/protocol.ts` | 三个进程之间的契约：渲染进程能调用的每个通道（`Api`）、哪些转发给 agent host（`HOST_CHANNELS`）、host 推回的事件流（`HostEvent`）、交互请求（`UiRequest`） |
| `src/agent/app-paths.ts` | 应用自己的数据目录（`~/.pi-desktop`、`PI_DESKTOP_HOME`）、worktree 根目录、扩展目录；pi 的配置目录只读解析，不搬家 |
| `src/agent/hub.ts` | 会话元数据、worktree、`createAgentSessionRuntime` 创建 / 恢复会话、事件转发、交互请求（权限 / 计划 / 扩展对话框）、子 agent、会话命名、CLI 会话导入 |
| `src/agent/desktop-kit.ts` | 每个会话一个实例的 pi 扩展：权限模式、output style、`todo_write`、`exit_plan_mode`、`task`（子 agent） |
| `src/agent/model-admin.ts` | 模型管理：provider / 登录方式枚举、OAuth 与 API key 登录事件桥接、登出、自定义端点保存与热加载 |
| `src/agent/endpoints.ts` | `models.json` 读写（保留手写字段）、`/models` 发现、本地端点占位密钥 |
| `src/agent/models-dev.ts` | models.dev 目录（按天缓存）：按模型 ID / canonical ID 匹配上下文、输出上限和价格 |
| `src/agent/naming.ts` / `src/agent/suggest.ts` | 后台小请求：会话命名与下一句输入预测（`completeSimple`，不进会话上下文） |
| `src/agent/side-model.ts` | 给后台请求挑同 provider 里最便宜的小模型 |
| `src/agent/demo-model.ts` | 离线演示模型：pi-ai 的 faux provider 注册到共享的 `ModelRuntime`，按脚本调用 pi 的**真实工具** |
| `src/agent/index.ts` | utilityProcess 入口：按 id 关联调用与结果，事件单向推送 |
| `src/main/agent-client.ts` | 启动 / 重启 agent host，`call(method, ...args)` |
| `src/renderer/src/store/transcript.ts` | pi 事件流 → transcript 条目的纯函数（流式文本 / 思考、工具组、权限卡片、计划、todo） |
| `src/renderer/src/store/actions.ts` | 发送、插话 / 排队、停止、模式 / 模型 / 思考强度、面板、PR 轮询等界面逻辑 |
| `src/renderer/src/components/` | 侧边栏、对话、输入框（附件、`/` 命令、`@` 文件）、右侧工作区（Diff / 预览 / 文件 / 终端 / 计划 / 子 agent / 文件查看器 / Cowork 进度） |

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

`Output style` 在同一菜单里，和权限模式一样即时生效（直接改 desktop-kit 的会话状态）；它改变的是 Claude 的回答方式，不是界面，也不是权限。Normal 模式是默认值，选择保存在 localStorage；`Output style` 同时写入当前会话元数据，恢复会话后继续生效。

> 提示：Claude desktop 里 `Thinking` 只在会话已经产生过思考后出现；这里也做了同样的处理。`Ctrl+O` 只在可用的模式之间循环。

### 历史消息操作

历史用户消息下方提供复制、回退和创建分支。回退移除当前上下文中的该消息和后续对话，并把文字与可恢复的附件放回输入框；新分支创建独立会话、保留原对话，从所选消息之前开始并恢复原文。消息使用 pi 的稳定 entry ID 定位，重复文字不会定位错；回退位置会立即持久化。任务运行时暂时禁用历史操作；这些操作只改变对话，已经产生的文件改动会保留。

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

### 文件工具预览与附件

- **Read / Edit / Write**：展开工具行可查看带行号的读取片段、本次编辑的红绿 diff，或实际写入的内容快照。点击文件名会在现有右侧文件查看器打开**当前正文**并定位；历史快照不会被当前正文或累计 Git diff 替代。需要累计改动时使用独立的 **Diff** 入口。
- **选区与评论**：在 Diff 或文件正文预览中选择代码，可以附加为上下文或添加评论；也可点击行号旁的 `+`，用 Shift 点击选择多行。评论编辑器显示在选区下方，引用和评论以可移除卡片加入当前会话草稿，随下一条消息发送；模型收到文件路径、行号、旧侧 / 新侧和选中代码的快照。最多 20 项引用，总内容最多 100,000 个字符。
- **树列表右键菜单**：Diff 和 Files 中的文件、文件夹支持附加为上下文，复制绝对路径 / 相对路径 / 名称，用 VS Code / Cursor / Terminal / 默认应用打开，以及在 Finder（其他平台为文件管理器）中显示。Terminal 打开所选文件的所在目录；已删除的文件可从 Diff 快照引用。
- **添加附件**：Code 和 Cowork 的输入框都支持粘贴截图、复制的本地文件、拖入文件，以及点击 **+** 多选文件；`@` 仍用于引用项目文件。发送前可以预览和移除，也可以只发附件。多行文字保留换行、制表符和缩进，富文本只提取纯文本，不加载其中的远程内容。
- **发送与恢复**：附件单独排列在文字气泡上方，图片可点击放大。图片使用 pi 原生 image blocks 传给支持图片的模型并随会话保存；普通文件是供 agent 读取的**本地路径引用**，不会自动解析 PDF / Office，也不会另存一份。移动或删除原文件后，该引用可能失效。
- **草稿与取消**：会话间草稿互相隔离；导入失败或发送失败不会清空附件。停止运行时，已取消的排队消息可恢复为草稿；有新草稿时显示 Restore / Discard，避免覆盖。未发送草稿仅在本次应用运行期间保留。
- **默认限制**：每条消息最多 10 个附件，单个源文件最多 20 MiB、源文件合计最多 50 MiB。图片会缩放至最长边 2000 px，单张输出 base64 最多 4.5 MiB、图片 base64 合计最多 20 MiB。不支持图片的模型会明确报错；带附件的 slash command 不会被静默执行并丢弃附件。

历史恢复沿用 pi 会话里的 `session.messages`：可恢复当前会话上下文中的附件，不额外提供压缩前完整 transcript 或历史分支浏览器。文件正文预览限于当前会话工作目录内、最多 1 MiB 的文本文件；历史内联工具片段不受文件后来移动或删除影响。

### Cowork 与 Code 的区别

| | Code | Cowork |
|---|---|---|
| 工作目录 | 项目的独立 worktree（`claude/<名字>` 分支，默认在 `~/.pi-desktop/.worktree`，可在设置里改根目录） | 选定的文件夹，直接修改；或新建的临时工作区（`~/.pi-desktop/cowork`） |
| 会话配置 | desktop-kit profile `code` | desktop-kit profile `cowork`，追加系统提示 `src/agent/cowork-prompt.md` |
| 右侧面板 | Diff、计划、子 agent、终端、预览 | 进度、生成的文件（可预览、打开、在文件夹中显示）、上下文 |
| 底部 | PR 条 + CI 状态 | — |
| 额外需要确认的命令 | — | 删除 / 移动文件（`rm` `mv` `del`…）、往外发数据（`scp` `rsync`、带 POST/上传参数的 `curl`/`wget`、`mail`） |

### 权限模式（desktop-kit）

pi 本身不做权限确认。desktop-kit 在 `tool_call` 钩子里按模式决定放行、拦截，还是询问用户；询问通过 `KitHost.ask()` 变成一条带 `toolCallId` 的 `UiRequest`（`kind: "permission"` / `"plan"`），由界面渲染成权限卡片或计划审批。其他 pi 扩展调用的 `ctx.ui.select / confirm / input / editor` 也会变成 transcript 里的卡片。

| 模式 | 编辑项目内文件 | 只读命令 | 其他命令 | 高风险命令（push、发 PR、rm -r…） |
|---|---|---|---|---|
| Auto（默认） | 放行 | 放行 | 放行 | 询问（Cowork 中删除 / 移动文件也算高风险） |
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
npm run test:desktop # 构建后用项目自带的 Electron 运行 Playwright 窗口交互测试
```

- `test/hub.e2e.test.ts`：Auto 模式在隔离 worktree 里修 bug（修复前测试真的失败，修复后真的通过，主工作区不被改动）、worktree 默认根目录与设置里的自定义根目录、Ask 模式拒绝、Plan 模式审批后自动切到 Accept edits、运行中切换模式、进程内子 agent、高风险命令仍需询问、带图片附件的会话关闭后从会话文件恢复、`/clear`、首条提示词命名与手动重命名；Cowork 整理收件箱时只有移动文件需要确认、拒绝后文件保持原样、生成简报文件、临时工作区。
- `test/desktop/interactions.spec.ts`：临时配置目录（`PI_DESKTOP_HOME`）中的真实 Electron 窗口，覆盖模型元数据编辑、价格 0、token 限制校验、文件菜单、预览引用、Diff 评论、随消息发送及历史回退 / 分支；`test/context-reference.test.ts` 覆盖引用格式、草稿隔离与恢复、容量限制。
- `test/attachment-message.test.ts` / `test/attachments-backend.test.ts`：附件消息往返、校验限制、剪贴板格式（macOS / Windows / Linux）和图片规范化。
- `test/tool-previews.test.ts` / `test/files.test.ts`：原生工具输出、行号 / 分页，以及文件边界、符号链接（需要系统允许创建符号链接）、二进制和大小限制。
- `test/naming.test.ts`、`test/suggest.test.ts`、`test/side-model.test.ts`、`test/git-pr.test.ts`：命名规则、输入预测的上下文裁剪与回复清洗、小模型挑选、`gh pr view` 结果映射。

## 打包与发布（macOS）

只维护 macOS。构建走 `Makefile`（CI 调的是同一批 npm 脚本），需要 macOS + Xcode 命令行工具（`xcode-select --install`，`codesign` / `iconutil` / `sips` / `hdiutil` 都在里面）和 Node 22.19+。

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
make release VERSION=0.2.0     # npm version + 打 tag + push
```

推上去的 `v0.2.0` tag 触发 `.github/workflows/release.yml`：arm64 和 x64 两个 dmg 在 `macos-14` 上交叉构建（没有按架构编译的原生模块，只有 Electron 的 zip 不同），然后 `gh release create/upload` 挂到同名 Release，附 `SHA256SUMS.txt`。签名靠仓库 secret：`MAC_CERT_P12`、`MAC_CERT_PASSWORD`、`APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID`；不填也能跑通，只是产物未签名。

不想走 tag 的话，本地直接 `GH_TOKEN=… make publish` 也能上传。

`.github/workflows/build.yml` 是 PR 上的打包冒烟测试：跑 `--dir` 打包，然后断言 `Resources/app/node_modules/@earendil-works/pi-coding-agent` 和两个扩展真的进了包。

### 未签名产物怎么打开

首次打开会被拦（「无法打开，因为 Apple 无法验证」）：右键 → 打开，或者

```bash
xattr -cr /Applications/Pi\ Desktop.app   # 只在你自己确认过来源的情况下
```

### 两处刻意的选择

- **`asar: false`**：agent host 里的 pi SDK 要从文件系统读自己的资源、用 jiti 加载用户的 TS 扩展、加载预编译 `.node` 并启动工具二进制；全部保持普通文件最省心。代价是 app 目录里有一万多文件。
- **不做 universal 单包**：`@earendil-works/pi-tui` 自带 `darwin-arm64` / `darwin-x64` 两份预编译 `.node`，合并成 universal 要额外配 `@electron/universal` 的 `x64ArchFiles`，体积还翻倍。arm64 / x64 各一个 dmg 更省事。

图标是 `scripts/make-icon.mjs` 用纯 Node（SDF 画形状 + 手写 PNG 编码，无依赖）生成的，改完跑 `make icon` 会一起更新 `.png` 和 `.icns`。

## 已知限制 / 下一步

- Cowork 的 **Projects / Artifacts / Scheduled** 入口还是占位。简报类任务现在需要手动触发，定时任务还没做。
- Cowork 还没接日历、邮箱这类连接器；可以通过 pi 的 MCP（`~/.pi/agent/mcp.json`）或扩展接入。
- **Cloud 环境**还没实现，菜单里是禁用状态。
- pi 的 `find` 工具依赖 `fd`，pi 会自动下载；在离线环境下这一项会失败（`grep` 用系统里的 `rg`）。
- **PR / CI 状态**依赖 `gh` CLI 已登录。
- **预览**面板只允许 `localhost` 地址。
- React 重写版已在 Windows 11 上用真实窗口跑通离线 demo（Code 修 bug + Diff 面板、Cowork 整理收件箱 + 权限确认），并加载了用户自己的 pi 扩展；macOS 打包版尚未在重写后重新验证。旧版的 Playwright 界面测试（`test/ui-*.js`）随旧界面一起移除，界面自动化测试待补。
- 没有自动更新：升级靠重新下载 dmg。要接 `electron-updater` 得再产一个 `zip` target（dmg 不能做增量更新），并加一个设置项。
