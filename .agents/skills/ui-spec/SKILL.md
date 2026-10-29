---
name: "ui-spec"
description: "Pi Desktop 的界面规范：改渲染进程、加页面/面板或加一类要显示的数据前先读。含 host↔界面的数据刷新订阅模型（HOST_RESOURCES / changed / subscribeResource、各资源发布点、六类失效模式）与界面文案国际化规则。"
---

# 界面规范

Pi Desktop 的界面约定。改渲染进程、加页面或面板、加一类要显示的数据之前先读这里；不合规的写法会留下「要重载窗口才看到新值」的缺陷。

## 1. 数据刷新：host 与界面的订阅模型

界面上显示的 host 拥有数据（agent 进程或 main 进程写的），**不在视图里保存副本当真相**。数据变了由拥有方发一个信号，所有**挂载中**的视图各自重读。

- `src/shared/protocol.ts` — `HOST_RESOURCES` 与 `HostEvent = { type: 'changed'; resource }`
- `src/renderer/src/store/resources.ts` — `subscribeResource(resource, load)` / `notifyResource(resource)`
- `src/renderer/src/store/actions.ts` — `handleHostEvent` 把 `changed` 转给总线；全局 slice（`models`、`projects`、`workFolders`、`tasks`）在模块级注册重读
- `src/renderer/src/settings/SettingsApp.tsx` — 设置窗口（第二个 BrowserWindow）把 `changed` 转给同一条总线

各个资源的拥有方与发布点：

| 资源 | 拥有方 | 发布自 |
|---|---|---|
| `models` | agent | `ModelAdmin.changed()`：登录、登出、端点保存/删除、刷新 |
| `tasks` | agent | `src/agent/index.ts` 里的 `Scheduler` 回调 |
| `customize` | agent | `hub` 的 `CustomizeHost` 包装，走 `afterChange('customize', …)` |
| `artifacts` | agent | `hub` 的 `ArtifactHost` 包装，以及 `artifacts:fromFile` handler |
| `activity` | agent | `sessions:prompt` handler，`recordPrompt` 之后 |
| `workFolders` | main（列表）+ agent（模型写的笔记/编辑） | `src/main/index.ts` 的 `listsChanged('workFolders')`；`pidesk_remember` / `pidesk_project_manage` 后 `hub.resourceChanged('workFolders')` |
| `projects` | main | `src/main/index.ts` 的 `listsChanged('projects')` |

### 加一类新的 host 数据（三步，缺一不可）

1. 在 `HOST_RESOURCES` 里加名字。
2. 在**写入点**、且**写成功之后**发布一次：agent 里 `hub.resourceChanged('x')`；main 里 `broadcast('host:event', { type: 'changed', resource: 'x' })`。
3. 在显示它的地方重读：全局列表 → 在 `actions.ts` 注册重读函数；页面局部状态 → 在已有的挂载加载旁边加 `subscribeResource('x', load)`（一个 effect，两个触发：挂载 + 变更）。

**事件不带数据。** 视图自己决定查询参数（项目作用域、分页、过滤），带 payload 会和 host 真正持有的状态打架。

### 两条通道，两个拥有方，不要造第三条

- agent 拥有的数据 → `changed`（信号，视图重读）
- main 进程的设置 → `settings:changed`（带完整 payload 的推送，`App` / `SettingsApp` 直接应用）

### 已经修过的失效模式（加视图前逐条自查）

1. **视图只在挂载时读一次。** 也要订阅：组合器思考等级、Customize、Artifacts、RecentArtifacts、Activity、设置页 `ModelsSection` / `ModelPicker`。
2. **全局 slice 刷新了，但打开的视图持有同一数据的快照。** 视图那份也要刷 —— `reloadSessionLevels()` 处理 `s.levels` 与 `st.levels`。
3. **`openSession` 对已加载会话直接 return**，重进什么都不读。用 `sessions:state` + `revalidateSession()` 重读 model / levels / thinking / stats / commands，不重发 transcript。
4. **host 改了 meta 却没 `emitMeta`。** prompt / settle / rewind 后的 `m.updatedAt` 必须发布，否则侧边栏排序与「x 分钟前」冻结到重载。
5. **同一份列表存在两个窗口。** 谁写谁广播，两个窗口都订阅 —— 设置页的 Projects 分区曾自己存一份，连切走再切回都是旧的。
6. **用 focus 或轮询顶替事件。** 只有真正的外部变化（比如在另一窗口配好存储桶）才留轮询/焦点；应用自己做的改动一律订阅。

### 其它约定

- 未挂载的视图收不到通知：页面在导航时卸载，所以「离开再回来」仍是第二道防线，但**不能是唯一一道**。
- `changed` 走普通 `HostEvent` 流，远端客户端自动受益；旧 host 不发时降级为「挂载时重读」。
- 不要再造按功能命名的事件（`models_changed`、`work_folders`、带 payload 的 `tasks` 都已删除）。
- 相关测试：`test/resources.test.ts`（总线）、`test/hub.e2e.test.ts`（`hub.sessionState()`、Work 项目记忆）、`test/work-project.test.ts`（写成功后才通知）。渲染进程的 store 逻辑可在 node 环境测（没有 DOM 测试环境，总线逻辑不要碰 DOM）。

## 2. 文案

- **走国际化。** 用户看得到的文字（按钮、提示、错误、发给模型的预设指令）不要写死在代码里：在 `src/shared/i18n/messages/` 里加一条同时带 `en` 和 `zh` 的消息；组件内用 `useT()`，组件外用 `t()`（渲染进程）或 `tr()`（`@shared/i18n/runtime`，主进程 / agent 进程 / 共享代码）。
- **新增语言**：在 `locales.ts` 的 `LOCALES` 加一项，类型检查会指出缺的译文。
- **简洁高效。** 界面里的文案（标题、按钮、提示、说明）短而直接，不口语化、不长篇解释；必须详细说明时，旁边放一个 tips 图标悬浮查看，不要把长说明直接铺在界面上。
