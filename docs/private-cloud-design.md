# Pi Desktop 私有云：接口、数据结构与流程（草案）

状态：**Draft，供桌面端与服务端共同评审，接口尚未定稿。** 本文不代表产品已支持云端运行。

目标场景：用户在电脑 A 选中一个 Work 或 Code 会话，确认交给私有云。A 关机后，用户在电脑 B 登录，能打开同一会话，看到原文件并继续工作。首版只做桌面端。

三个动作不能混用：**同步**只复制数据；**交接**改变执行方；**接续**是另一台桌面打开已交接的云会话。现有[远程协议](../src/shared/remote.ts)控制的是一台机器，不是账号；不能把整机令牌当成云账号令牌。

以下路径统一以 `/cloud/v1` 为前缀。除启动策略、登录和令牌刷新外，服务端从访问令牌确定账号，并校验资源归属。`rev` 是资源版本，`cursor` 是读增量的位置。编辑已有资源带 `baseRev`；版本过期返回 `409`。产生副作用的重试（提交快照、激活交接、发送消息）携带 `Idempotency-Key`，相同账号和操作的同一请求只产生一次结果。

## 1. 部署策略与邮箱登录

### 接口

| 接口 | 请求 → 响应 |
|---|---|
| `GET /deployment` | 无需登录 → `{deploymentId, loginRequired, authMethod: "email_otp", rev}` |
| `PATCH /admin/deployment` | 管理员提交 `{loginRequired, baseRev}` → 新策略 |
| `POST /auth/email/challenges` | `{email}` → `{challengeId, expiresAt, resendAfter}`；不披露账号是否存在 |
| `POST /auth/email/verify` | `{challengeId, code, deviceId}` → `{user, accessToken, refreshToken, expiresAt}` |
| `POST /auth/refresh` | `{refreshToken}` → 新令牌对；旧刷新令牌失效 |
| `POST /auth/logout` | 当前设备会话 → `204`；不退出其他设备 |

### 数据结构

- `User {id, email}`，同一邮箱对应一个账号。
- `EmailChallenge {id, email, codeDigest, expiresAt, attemptsLeft, usedAt?}`。
- `DeviceSession {id, userId, deviceId, refreshTokenDigest, expiresAt, revokedAt?}`。

### 流程

桌面读取受管部署策略。强制登录时，验证成功才开放本地 agent、调度器和远程入口；无法验证不能自动退回免登录模式。非强制部署允许离线使用本地功能。两种部署都须登录才能访问云工作区、同步和内置模型。

邮箱登录：申请验证码 → 发送邮件 → 校验并一次性消费 → 签发设备会话。发送和验证分别限流；桌面退出撤销本设备会话。

## 2. 账号配置同步

### 接口

| 接口 | 请求 → 响应 |
|---|---|
| `GET /me/sync-policy`、`PATCH /me/sync-policy` | 读取，或提交 `{baseRev, models?, customize?}` → `{rev, models, customize}` |
| `GET /me/config/changes?cursor=…` | 首次不传游标读快照；后续读增量 → `{items, nextCursor, hasMore}` |
| `POST /me/config/changes` | `{policyRev, changes:[{key, scope, baseRev, op, value?}]}` → 各项新版本或冲突 |
| `DELETE /me/config/groups/:group/copy` | 带策略版本，须先关闭该类 → 清除云端同步副本并推进版本；不删本机原件 |

### 数据结构

`ConfigItem {key, scope: account 或 workspaceId, group, rev, value, deleted}`。服务端按键和资源类型确定分组，不能接受客户端把任意文件标成通用设置。应覆盖桌面 JSON、SDK 用户或项目配置，以及渲染进程 `localStorage` 的用户偏好，而不是复制配置目录。

| 分组 | 包含 | 边界 |
|---|---|---|
| `core`，必须同步 | 通用和外观设置、隐私规则、可移植的会话偏好、宠物选择及自制皮肤、定时任务定义、搜索与对象存储的非秘密配置 | 例如“启用输入预测”属于通用项，“使用哪个个人模型预测”不属于 |
| `models`，可关闭 | 个人供应商、端点、模型参数、默认模型和按模型设置的偏好 | 不含 Key、OAuth 凭证或取密钥命令 |
| `customize`，可关闭 | 用户和项目级 skills、提示模板、MCP 定义、插件来源和自制插件、子 agent | 不复制 MCP 密钥、插件私有数据和执行授权；新环境重新授权 |
| 不进入普通同步 | 设备令牌、监听状态、窗口坐标、缓存、请求日志、本机绝对路径 | 设备绑定在本机建立；个人凭证在云端单独录入 |

### 流程

先取策略，再拉取和提交。A 关闭个人模型同步后，所有设备停止该类上传和下载；B 离线积压的旧变更会被服务端拒绝。B 重新取策略后仍可同步宠物和定时任务。关闭不删除云端副本；单独清除不传播为本机删除。重新开启先比对差异，不自动用旧队列重建已清除的数据。

## 3. 工作区与文件同步

### 接口

| 接口 | 请求 → 响应 |
|---|---|
| `POST /workspaces`、`GET /workspaces` | `{kind, name}` → `{workspaceId, rev}`；列表仅返回当前账号工作区 |
| `POST /workspaces/:id/transfers` | `{baseRev, policyRev, manifest}` → `{transferId, missingHashes}` 或排除原因 |
| `PUT /transfers/:id/blobs/:hash` | 上传清单中缺失的内容 → 校验结果；可重传 |
| `POST /transfers/:id/commit`、`GET /transfers/:id` | 提交 → `{snapshotId, rev}`；查询 → 状态或最终结果 |
| `GET /workspaces/:id/manifest?sinceRev=…`、`GET /workspaces/:id/blobs/:hash` | 下载差异及其引用的内容；仅凭哈希不能跨账号读取 |

### 数据结构

```text
Workspace     { id, ownerId, kind: work 或 code, name, rev }
DeviceBinding { workspaceId, localRoot, lastSyncedRev }  // 仅本机
FileChange    { relativePath, op: put 或 delete, hash?, size?, mode? }
WorkSnapshot  { files, instructions, links, memory, attachmentRefs, artifactRefs }
CodeSnapshot  { gitBundle, branch, baseCommit, headCommit,
                stagedPatch, unstagedPatch, untrackedFiles }
```

### 流程

1. 用户选定已有工作，本机预览目录、附件、大小和排除项；确认前不上传。Work 包含项目记忆和真实文件，普通附件可能在项目目录外。Code 分别保存提交、暂存区、未暂存修改及选中的未跟踪文件。
2. 仅上传缺失内容；提交时再次检查账号、同步策略、相对路径、哈希及工作区版本。全部通过才发布快照；传输失败不损坏本机原件或上个快照。
3. 后续 Work 上传或下载增量。不同文件可合并；同一文件两端都变更时保留两份，由用户处理。项目内 `.pi/` 和 `.agents/skills/` 同样遵守自定义开关。若 Git 历史含明确排除的数据且不能安全分离，本机预检阻止上传该包。

## 4. 会话交接与云端执行

### 接口

| 接口 | 请求 → 响应 |
|---|---|
| `POST /workspaces/:id/handoffs` | `{sourceSessionId, snapshotId, checkpoint}` → `{handoffId, state: "prepared"}`；不立即执行 |
| `POST /handoffs/:id/activate`、`GET /handoffs/:id` | 原设备确认已停止本地执行 → `{state: "active", sessionId}`；查询可恢复丢失的响应 |
| `GET /workspaces/:id/sessions`、`GET /sessions/:id` | 会话列表；详情含历史、状态和待审批请求 |
| `POST /sessions/:id/prompts` | `{messageId, text, attachments?}` → `{turnId, status}` |
| `POST /sessions/:id/decisions`、`POST /sessions/:id/abort` | `{requestId, decision}` 或 `{turnId}` → 状态 |
| `GET /sessions/:id/events` | SSE，支持 `Last-Event-ID`；事件过期则重读会话详情 |

### 数据结构

- `Checkpoint {transcriptRef, workdirRelative, modelRef?, permissionMode, attachmentMap}`。
- `Handoff {id, sourceSessionId, snapshotId, state: prepared 或 active 或 failed, cloudSessionId?}`。
- `Session {id, workspaceId, status: idle 或 running 或 waitingApproval}`。

### 流程

A 等当前工具调用结束并暂停新输入 → 生成文件快照与会话检查点 → 云端恢复并验证，进入 `prepared` → A 持久化“本会话本地已停执行” → 激活云端。激活超时查询同一 `handoffId`，不盲目在本地重启。B 直接打开返回的 `sessionId` 并订阅事件，无须重新导入。断开桌面不终止云任务；待审批操作不会因断线自动获批。首版不迁移正在运行的终端进程。

## 5. 内置模型与凭证

### 接口

| 接口 | 请求 → 响应 |
|---|---|
| `PUT/DELETE /admin/providers/:id` | 管理员配置 `{protocol, baseUrl, models, secretRef, enabled}` → 供应商状态 |
| `PUT/DELETE /admin/credentials/:ref` | 管理员在云端录入或删除部署凭证 → `{configured}` |
| `PUT/DELETE /me/credentials/:ref` | 用户在云端单独录入或删除个人凭证 → `{configured}`；不提供明文读取接口 |
| `GET /models` | 当前账号可用的 `[{id, name, source, availability}]` |
| `POST /inference` | `{modelId, messages, tools?, stream}` → 文本、工具调用及用量 |

### 数据结构

`Provider {id, scope: deployment 或 account, protocol, baseUrl, secretRef, enabled}`；`Model {id, providerId, upstreamId, capabilities}`。账号配置和工作区文件均不保存上游密钥。

### 流程

管理员配置一次供应商 → 用户登录 → 桌面选择内置模型 → 模型代理鉴权并代调上游。上游密钥不下发给桌面或工作区进程。关闭个人模型同步不影响内置模型。交接的会话若缺个人凭证则返回 `MODEL_NOT_CONFIGURED`，由用户补配或改选，不自动换用其他收费模型。

## 6. 定时任务与执行归属

### 接口

| 接口 | 请求 → 响应 |
|---|---|
| `GET/PUT /schedules/:id` | 读取或保存 `{baseRev, name, prompt, workspaceId, rule, timeZone, modelRef?, enabled}` → `{id, rev, executor, nextRunAt}` |
| `POST /schedules/:id/claim-cloud` | 当前执行设备持久化停调度后提交 `{baseRev}` → `{executor: "cloud", rev}` |
| `GET /schedules/:id/runs` | → `[{scheduledFor, status, sessionId?}]` |

### 数据结构

`Schedule {id, ownerId, workspaceId, rule, timeZone, executor: deviceId 或 cloud, rev}`；`ScheduleRun {scheduleId, scheduledFor, status, sessionId?}`，后者以 `(scheduleId, scheduledFor)` 去重。任务定义通过模块 2 的 `core` 变更流分发，不另存一套任务。

### 流程

B 同步到 A 创建的任务，只显示和编辑定义，不启动第二个计时器。A 确认移交并停止调度 → 云端核对执行方和版本 → 从约定的触发时间起按原时区执行。原设备离线且未确认停调度时，云端不抢接。缺项目或模型时显示“待配置”，不擅自运行。

## 留给下一轮评审

| 模块 | 尚需决定的问题 |
|---|---|
| 登录 | 受管客户端怎样验证部署策略？强制登录时，已登录设备断网后是否有宽限期？ |
| 配置 | 暂停期间的两侧修改怎样展示和合并？清除操作如何处理备份中的历史副本？ |
| 文件 | 大文件分块、配额和未完成传输回收怎么定？含被排除内容的 Git 历史是否提供替代导入方式？ |
| 执行 | 云工作区的账号隔离、网络和资源配额如何落地？`prepared` 后长期未激活怎样取消和恢复？ |
| 调度 | 移交时刚好到期的任务归哪一方？原设备丢失时，如何安全地人工接管？ |
