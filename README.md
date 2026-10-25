# Pi Desktop

基于 [pi coding agent](https://github.com/badlogic/pi-mono) 的桌面端，界面仿照 Claude desktop，有 **Cowork** 和 **Code** 两种模式。每个会话 / 任务对应一个 `pi --mode rpc` 子进程；Claude 风格界面里 pi 没有的能力（权限模式、计划审批、待办、子 agent）由内置的 pi 扩展补上。

- **Code**：在项目的独立 git worktree 里写代码，配有 diff、PR / CI 状态、终端和预览。
- **Cowork**：在你选的文件夹里做知识类工作，比如整理文件、写文档、做简报；不选文件夹时会新建一个临时工作区。右侧面板显示进度、Claude 生成的文件和任务上下文。

## 快速开始

```bash
npm install
npm start          # 正常启动
npm run demo       # 打开内置演示项目，默认使用离线演示模型
```

- 需要 Node 22.19+（只用于安装依赖；运行时 pi 跑在 Electron 自带的 Node 24 上）。
- 首次启动会把 `demo/todo-app`（Code 演示项目）和 `demo/cowork-workspace`（Cowork 演示文件夹：收件箱、日程、待办）复制到用户数据目录。不配置任何 API Key 也能用 **Demo (offline)** 模型体验完整流程。
- 接真实模型：右下角模型菜单 → **Add API key…**，或打开设置（`Ctrl/⌘+,`）在 **API 密钥** 里管理。也可以直接用 pi 自己的配置：环境变量、`~/.pi/agent/auth.json`、`models.json`。
- 设置窗口（`Ctrl/⌘+,`，用户菜单 → 设置）是独立窗口：外观（浅色 / 深色 / 跟随系统、侧边栏）、通用（通知、默认分区）、API 密钥、项目与文件夹、关于。偏好保存在用户数据目录的 `settings.json`，修改后主窗口立即跟随；窗口以 `settings.json` 之外的同步 IPC（`app:boot`）拿到首屏需要的值，不会先闪一下再变色。

## 架构

```
Renderer (renderer/)                         Main (electron/)                         pi 子进程
┌──────────────────────────┐  IPC  ┌─────────────────────────────┐  JSONL   ┌─────────────────────────────┐
│ code.js  pi 事件 → 界面   │◀────▶│ sessions.js  每会话一个进程  │◀───────▶│ pi --mode rpc               │
│  (Code 与 Cowork 共用)    │       │ pi-rpc.js    JSONL + id 关联 │  stdio   │  -e desktop-kit/index.ts    │
│ app.js   Markdown/主题等  │       │                             │          │  [Cowork] --desktop-profile │
│                          │       │                             │          │   cowork --append-system-   │
│                          │       │                             │          │   prompt cowork-prompt.md   │
│ shell.js 窗口外壳         │       │ git.js       worktree / diff │          │  -e demo-model.ts           │
└──────────────────────────┘       │ main.js      窗口 / IPC / 密钥│          │  --tools +grep,+find,+ls    │
         preload.js（白名单）       └─────────────────────────────┘          └─────────────────────────────┘
```

| 文件 | 作用 |
|---|---|
| `electron/pi-rpc.js` | 启动 pi，严格按 LF 切分 JSONL（不用 `readline`，它会在 U+2028 处切断），用 `id` 关联请求和响应，转发事件与 `extension_ui_request` |
| `electron/sessions.js` | 会话元数据；新会话默认在 `claude/<名字>` 分支的独立 worktree 中运行；用 `--session <文件>` 恢复历史；导入 pi CLI 会话；一个常驻的 probe 进程用来列出模型 |
| `electron/git.js` | 相对会话起点 commit 的改动（含未跟踪文件）、`gh pr view` 的 PR/CI 状态、在 VS Code / Cursor / 终端中打开 |
| `extensions/desktop-kit/index.ts` | 权限模式、output style、`todo_write`、`exit_plan_mode`、`task`（子 agent） |
| `extensions/demo-model.ts` | 离线演示模型：基于 pi-ai 的 faux provider，按脚本调用 pi 的**真实工具**（Code 和 Cowork 各有一组场景） |
| `extensions/cowork-prompt.md` | Cowork 追加的系统提示：面向非程序员、把结果写成文件、用待办清单汇报进度 |
| `renderer/code.js` | 把 pi 事件流渲染成会话界面：流式文本 / 思考、按 transcript 模式折叠的工具组、权限卡片、计划、diff、PR 条 |
| `renderer/settings.html` | 独立设置窗口：外观、通用、API 密钥、项目与文件夹、关于；所有值都来自主进程，主窗口与设置窗口不会不一致 |

### pi 事件与界面的对应

| 界面 | pi |
|---|---|
| 发送 / 运行中 ↵ 插话 / Ctrl·⌘+↵ 排队 / Esc | `prompt` / `prompt` + `streamingBehavior:"steer"` / `follow_up` / `clear_queue` + `abort` |
| 流式回复、思考 | `message_update`（`text_delta`、`thinking_delta`），以 `message_end` 为准 |
| 工具组 “Ran…, read…, edited…” | `tool_execution_start` / `_end` |
| 待办卡片 | `todo_write` 工具结果里的 `details.todos` |
| 运行结束 | `agent_settled`（`agent_end` 之后 pi 可能还会重试或压缩，不能当作结束） |
| 模型 / 思考强度 / 上下文圆环 | `get_available_models`、`set_model`、`set_thinking_level`、`get_session_stats` |
| `/compact` `/context` `/clear` `/export` | `compact`、`get_session_stats`、`new_session`、`export_html` |
| 终端面板里输入的命令 | `bash`（输出会进入下一轮上下文） |
| Transcript view（Normal / Thinking / Verbose） | 纯前端：思考折进工具组，按模式决定摘要、思考或全部步骤 |
| Output style（Default / Proactive / Concise / Explanatory / Learning） | `/desktop-output-style <style>`；desktop-kit 在 `before_agent_start` 追加对应系统提示 |

### Transcript view 与 Output style

会话标题旁的下拉菜单（或 `Ctrl/⌘+O`）控制 transcript 的详细程度，对应 Claude desktop Code tab 的三个视图：

| 模式 | 显示内容 |
|---|---|
| **Normal**（默认） | 隐藏思考；同一段回复里的工具调用合并成一行摘要，例如 `Ran 2 commands, read 3 files, edited a file +14 −1` |
| **Thinking** | 工具调用仍折叠成摘要，额外显示 `Thought for 12s`（可展开） |
| **Verbose** | 展开工具组，显示每次命令、读文件和思考内容 |

`Output style` 在同一菜单里，和权限模式一样通过扩展命令即时切换；它改变的是 Claude 的回答方式，不是界面，也不是权限。Normal 模式是默认值，选择保存在 localStorage；`Output style` 同时写入当前会话元数据，恢复会话后继续生效。

> 提示：Claude desktop 里 `Thinking` 只在会话已经产生过思考后出现；这里也做了同样的处理。`Ctrl+O` 只在可用的模式之间循环。

### Cowork 与 Code 的区别

| | Code | Cowork |
|---|---|---|
| 工作目录 | 项目的独立 worktree（`claude/<名字>` 分支） | 选定的文件夹，直接修改；或新建的临时工作区 |
| pi 参数 | `--desktop-mode` | 另加 `--desktop-profile cowork`、`--append-system-prompt cowork-prompt.md` |
| 右侧面板 | Diff、计划、子 agent、终端、预览 | 进度、生成的文件（可预览、打开、在文件夹中显示）、上下文 |
| 底部 | PR 条 + CI 状态 | — |
| 额外需要确认的命令 | — | 删除 / 移动文件（`rm` `mv` `del`…）、往外发数据（`scp` `rsync`、带 POST/上传参数的 `curl`/`wget`、`mail`） |

### 权限模式（desktop-kit）

pi 本身不做权限确认。desktop-kit 在 `tool_call` 钩子里按模式决定放行、拦截，还是通过 `ctx.ui.select` 询问用户；RPC 模式下这个询问会变成一条 `extension_ui_request`，由界面渲染成权限卡片。

| 模式 | 编辑项目内文件 | 只读命令 | 其他命令 | 高风险命令（push、发 PR、rm -r…） |
|---|---|---|---|---|
| Auto（默认） | 放行 | 放行 | 放行 | 询问（Cowork 中删除 / 移动文件也算高风险） |
| Ask permissions | 询问 | 放行 | 询问 | 询问 |
| Accept edits | 放行 | 放行 | 询问 | 询问 |
| Plan | 拦截 | 放行 | 拦截 | 拦截 |
| Bypass | 放行 | 放行 | 放行 | 放行 |

- 编辑项目目录**之外**的文件，除 Bypass 外一律询问。
- 选择“始终允许”时：命令按前两个词记入本会话白名单；编辑则把本会话切换到 Accept edits。
- 界面通过 `/desktop-mode <mode>` 切换模式。pi 会立刻执行扩展命令，即使 agent 正在运行。
- 和界面之间的约定：权限询问的标题以 `[[pi-desktop:perm:<toolCallId>]]` 开头，计划审批以 `[[pi-desktop:plan:<toolCallId>]]` 开头，模式变化通过 `setStatus("pi-desktop-mode", …)` 通知界面。

## 测试

```bash
npm test                                   # 真实 pi 进程 + 扩展 + 演示模型，无需 API Key
npm i -D playwright && xvfb-run -a npm run test:ui   # 启动真实 Electron 窗口，跑 Code 和 Cowork 的主要流程并截图
```

- `test/rpc-e2e.test.js`：Auto 模式修 bug（修复前测试真的失败，修复后真的通过）、Ask 模式拒绝、Plan 模式审批、子 agent、Auto 模式下高风险命令仍需询问。
- `test/rpc-e2e.test.js`（Cowork）：整理收件箱时只有移动文件需要确认；拒绝后文件保持原样；根据文件夹内容生成简报文件；确认追加的系统提示已生效。
- `test/hub.test.js`：worktree 隔离（主工作区不被改动）、git diff、重启后从会话文件恢复；Cowork 的临时工作区、直接在选定文件夹中工作、权限确认经由 hub 转发。
- 两个测试文件都同时在 Node 22 和 Electron 自带的 Node 24 上跑通过。

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

- **`asar: false`**：pi 是独立的 Node 子进程，要直接从文件系统读自己的 `dist/` 和 TS 扩展；`app.asar` 会把它们藏起来。代价是 app 目录里有一万多文件（约 390 MB）。
- **不做 universal 单包**：`@earendil-works/pi-tui` 自带 `darwin-arm64` / `darwin-x64` 两份预编译 `.node`，合并成 universal 要额外配 `@electron/universal` 的 `x64ArchFiles`，体积还翻倍。arm64 / x64 各一个 dmg 更省事。

图标是 `scripts/make-icon.mjs` 用纯 Node（SDF 画形状 + 手写 PNG 编码，无依赖）生成的，改完跑 `make icon` 会一起更新 `.png` 和 `.icns`。

## 已知限制 / 下一步

- Cowork 的 **Projects / Artifacts / Scheduled** 入口还是占位。简报类任务现在需要手动触发，定时任务还没做。
- Cowork 还没接日历、邮箱这类连接器；可以通过 pi 的 MCP（`~/.pi/agent/mcp.json`）或扩展接入。
- **Cloud 环境**还没实现，菜单里是禁用状态。
- pi 的 `find` 工具依赖 `fd`，pi 会自动下载；在离线环境下这一项会失败（`grep` 用系统里的 `rg`）。
- **PR / CI 状态**依赖 `gh` CLI 已登录。
- **预览**面板只允许 `localhost` 地址。
- 目前只在 macOS（打包版，Apple Silicon）和 Linux（xvfb）上实际跑过窗口。macOS 用 `hiddenInset` 红绿灯，Windows 用 `titleBarOverlay` 原生窗口按钮，Windows 那套还需要在真机上确认。
- 没有自动更新：升级靠重新下载 dmg。要接 `electron-updater` 得再产一个 `zip` target（dmg 不能做增量更新），并加一个设置项。
