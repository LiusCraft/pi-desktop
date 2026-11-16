# 桌面插件（Pi Desktop plugins）

让一个包同时扩展 **agent 能力** 和 **桌面能力**：给侧边栏加页面，并拿到一组受权限约束的桌面 API（会话、通知、私有存储、自己的后台方法）。

载体复用 pi package：安装、更新、依赖、资源过滤全部沿用 Customize → Plugins 现有链路，新增的只有一个 `package.json` 里的 `piDesktop` 段。

> 状态：P1（清单与开关）与 P2（`pages` 贡献点 + host RPC）已实现，示例包见 `plugin/pi-plugin-example/`。
> 未做：卡片 / 输入框动作 / 设置字段、`fs` 与网络权限、卸载清理、开发热重载。

## 1. 目标与非目标

**目标**

- 一个包，两种贡献：agent 侧（`pi.extensions`：工具 / 命令 / 钩子）、桌面侧（`piDesktop`：页面 + host 入口）。
- 插件 UI 崩了、抛错、卡死都不影响主窗口和其他插件。
- 卸载干净：删包即删干净，窗口里不留插件的 JS 与样式。
- 与现有规范一致：host 拥有数据 + `changed` 信号、文案走 i18n、渲染进程保持 `sandbox: true`。

**非目标**

- 不把插件 JS 注入主窗口 DOM（样式、事件、React 生命周期都收不回来）。
- 不在 Electron 主进程里执行插件代码（main 只做静态资源、协议和「这个插件准备好了吗」的校验）。
- 不做插件之间的依赖共享（每个包自己的 `node_modules`，同 pi 的规则）。
- 不做静默自动升级：权限集变多时必须重新确认。

## 2. 包格式

```jsonc
// package.json
{
  "name": "pi-plugin-github-inbox",
  "keywords": ["pi-package", "pi-desktop-plugin"],
  "pi": { "extensions": ["./agent.js"] },          // 可选：agent 侧能力，pi 每个会话照常加载
  "piDesktop": {
    "apiVersion": 1,
    "id": "github-inbox",
    "permissions": ["session:read", "session:prompt", "notify", "storage", "host:call"],
    "host": "./host.js",                            // 可选：桌面侧后台代码，进程内只加载一次
    "contributions": {
      "pages": [{ "id": "inbox", "title": "GitHub 收件箱", "entry": "ui/index.html", "views": ["code"] }]
    }
  }
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `apiVersion` | 是 | 目前只有 `1`；更高的主版本拒绝加载并说明原因 |
| `id` | 是 | `^[a-z][a-z0-9-]{1,31}$`，唯一；同时是 `pidesk-plugin://<id>/` 的 host 段 |
| `permissions` | 否 | 见 §5；没声明的能力一律拒绝 |
| `host` | 否 | 包内 JS 模块，默认导出 `activate(desktop)`；只写页面的插件可以不写。`./host.js` 与 `host.js` 等价 |
| `contributions.pages` | 否 | 侧边栏页面：`id`、`title`、`entry`（包内 HTML）、`views`（`code` / `work`，默认两者） |

`pi.extensions` 与 `piDesktop.host` 是两回事，签名也不同：前者拿到 pi 的 `ExtensionAPI`（注册工具、命令、钩子），后者只拿到桌面 API、没有会话概念。

## 3. 三类贡献跑在哪

| 贡献 | 运行位置 | 信任级别 | 隔离 |
|---|---|---|---|
| `pi.extensions` 入口 | agent utilityProcess（Node） | 安装即信任（同 pi 扩展） | 无沙箱；首次启用要明确确认 |
| `piDesktop.host` | agent utilityProcess（Node），每进程只 import 一次 | 同上 | 无沙箱；启动一次，禁用到重启为止 |
| `pages`（`entry`） | 主窗口里的 iframe | 逐项授权 | `sandbox="allow-scripts allow-same-origin"`，独立 origin，拿不到 `window.piDesktop` |

iframe 的资源由 main 的自定义协议提供：`pidesk-plugin://<id>/ui/index.html`。main 只服务包目录内的文件（`path.relative` 校验，编码过的 `..` 也会被拒），响应头带 CSP：

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
font-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'
```

`connect-src 'none'` 意味着页面自己发不了网络请求：要联网必须走 `pidesk`（P3 的 `net` 权限）。
`allow-same-origin` 是必要的：没有它文档是 opaque origin，`'self'` 匹配不到任何东西，相对资源全被 CSP 挡掉。这与 artifact 预览的 sandbox 设置一致。

## 4. 两套 API

**host 侧**（`host.js`，agent 进程）：

```js
export default function activate(desktop) {
  desktop.handle('issues', async (filter) => issuesFor(filter));  // 页面用 pidesk.host.call 调
  desktop.emit('count', 3);                                       // 推给打开着的页面
  desktop.notify('有 3 个待评审的 PR', 'warning');
  desktop.storage.get('lastSeen');                                // 插件私有 KV
  desktop.dataDir;                                                // 插件可写目录（已创建）
}
```

方法名不能以 `#` 开头（`#storage.*` 是运行时保留的）。同一个方法重复注册以最后一次为准。

**UI 侧**（iframe 内，`window.pidesk`，由 main 提供 `pidesk-plugin://<id>/sdk/pidesk.js`，插件不用打包）：

```js
await pidesk.ready();                       // 收到第一份 session/theme 之后
pidesk.session.current();                   // { id, kind, title, cwd } | null（需要 session:read）
pidesk.session.onChange(cb);
pidesk.session.prompt('…');                 // 需要 session:prompt
pidesk.host.call('issues', 'open');         // 需要 host:call，转到本插件的 desktop.handle
pidesk.host.on('count', cb);                // desktop.emit 的数据
pidesk.storage.get(key) / .set(key, value); // 需要 storage
pidesk.notify('…');                         // 需要 notify
pidesk.theme() / pidesk.onTheme(cb);        // 当前主题的 CSS 变量值
```

RPC 信封（postMessage；主窗口侧校验 `event.source === iframe.contentWindow`）：

```ts
type UiToHost = { id: number; kind: 'call'; method: string; args: unknown[] };
type HostToUi =
  | { id: number; ok: true; value: JsonValue }
  | { id: number; ok: false; error: string }
  | { kind: 'event'; event: { type: 'session' | 'theme' | 'data'; payload?: JsonValue; name?: string } };
```

页面永远拿不到调用方身份：`pluginId` 由嵌入它的 `PluginFrame` 补上，页面伪造不了别的插件。

## 5. 权限

只列**已经实现**的能力，避免「申请了却永远拿不到」：

| 权限 | 放开什么 |
|---|---|
| `session:read` | 当前会话的 id / kind / title / cwd |
| `session:prompt` | 往当前会话发一条消息 |
| `notify` | toast / 通知 |
| `storage` | 插件私有 KV（`~/.pi-desktop/plugin-data/<id>/storage.json`） |
| `host:call` | 调用本插件 host 入口注册的方法 |

没有的能力：任意 fs、shell、网络、直接 IPC、其他插件的数据、设置页写入、终端。

**谁检查**：

- 嵌入页面的 `PluginFrame`：`session.*`、`notify`（渲染进程是可信侧，页面只能通过它）。
- agent host 的 `PluginHosts`：`storage`、`host:call`，每次都重新读注册表，所以开关立刻生效。
- main：只校验「这个 id 已登记且 `ready`」，不认权限。

**授权时机**：安装后插件是「未启用」，启用时弹一次权限清单；`~/.pi-desktop/plugins.json` 记 `{ source, enabled, granted }`。升级后权限集变大 → `needsGrant`，回到待确认，`ready` 变 false，页面与 host 入口都不加载。

**project 作用域的插件**：沿用 `ProjectTrustStore`，未信任的项目里的桌面插件不出现在列表里。

## 6. 数据归属与刷新

遵守 ui-spec 的两条通道，不造第三条。

| 数据 | 拥有方 | 写入点 → 发布 | 谁重读 |
|---|---|---|---|
| 插件清单（包、manifest、贡献点） | agent | 安装/删除包（`customize:*`）→ `changed('customize')`；`plugins:setEnabled` → `changed('plugins')` | Customize 页、侧边栏（`subscribeResource('plugins')`） |
| 启用状态与已授权限 | agent（`plugins.json`） | 同上 | 同上 |
| 插件运行时数据（`desktop.emit`） | agent | 插件自己调用 → `HostEvent { type: 'plugin', event: { kind: 'data' } }` | 该插件的 iframe（经 `plugin/events.ts` 总线） |

main 不持有第二份真相：它只把转发过的 `plugins:list` / `plugins:setEnabled` 结果记进 `PluginServer` 的缓存（`id → 包目录 + ready`），用来服务文件与转发调用。远端窗口里不更新这份缓存（那边的主机有自己的插件）。

## 7. 协议与通道

```ts
// shared/protocol.ts
HOST_RESOURCES += 'plugins';
Api['plugins:list'](project: string | null): DesktopPluginInfo[];
Api['plugins:setEnabled'](id, enabled, granted: PluginPermission[] | null, project): DesktopPluginInfo[];
/** 页面的调用：main 校验 ready 后交给 agent host。 */
Api['plugin:call'](pluginId: string, method: string, args: unknown[]): JsonValue;   // MAIN_CHANNELS

HostEvent |= { type: 'plugin'; pluginId: string; event: PluginEvent };
HostInternal['host:pluginCall'](plugin: DesktopPluginInfo, method: string, args: unknown[]): Promise<JsonValue>;
```

用一条固定通道而不是 `plugin:<id>:<method>`：`ipcMain.handle` 只能按精确通道注册，动态通道要随插件启停增删处理器，方法名又只有 host 运行时才知道；一条 `plugin:call` 既留在「通道集合封闭」的约定里，也让 preload 白名单不用开前缀。

## 8. 生命周期与失败

| 场景 | 行为 |
|---|---|
| manifest 不合法 / `apiVersion` 太高 / 入口文件缺失 | 该行标红并说明原因，不加载任何入口 |
| host 入口抛错 | 调用方（页面）收到错误；下次调用会重试加载 |
| 页面 8 秒没加载完 | 页面区域显示「插件页面没有响应 + 重新加载」 |
| 禁用插件 | 下一次调用立刻被拒；页面从侧边栏消失；已加载的模块留在内存里直到重启（ESM 不能卸载） |
| 卸载包 | 条目与私有数据仍在 `~/.pi-desktop`（P3 清理） |
| 远端窗口 | 插件页面不加载，显示一行说明 |

## 9. P1：载体与清单

| 文件 | 作用 |
|---|---|
| `src/shared/plugin-manifest.ts` | `parseDesktopManifest(pkg)`：纯函数校验（无 fs），`isInsidePackage(entry)` 防止入口跑到包外 |
| `src/agent/plugins.ts` | `DesktopPlugins`：发现包、校验入口/冲突、读写 `plugins.json`、算 `ready` / `needsGrant` / `error`、`decision(id)` |
| `src/shared/protocol.ts` | 插件类型、两个 `plugins:*` 通道、`HOST_RESOURCES += 'plugins'` |
| `src/agent/handlers.ts` · `src/agent/hub.ts` | 处理器与 `hub.plugins`（懒建） |
| `src/renderer/src/customize/PluginsSection.tsx` | 包下面的「桌面能力」：页面、权限、开关、授权弹窗、错误 |

## 10. P2：`pages` 与 host RPC

| 文件 | 作用 |
|---|---|
| `src/agent/plugin-host.ts` | `PluginHosts`：加载 `piDesktop.host`、`desktop.*` API、`#storage.*`、权限校验、结果转成 JSON |
| `src/main/plugins.ts` | `pidesk-plugin://` 文件服务（包内路径 + CSP + SDK）、`PluginServer.call` 的 ready 校验、`remember` 缓存 |
| `src/shared/plugin-sdk.ts` | iframe 侧的 `pidesk`（由 main 原样提供） |
| `src/renderer/src/plugin/PluginFrame.tsx` | iframe 宿主：`event.source` 校验、权限检查、session/theme 推送、超时重载 |
| `src/renderer/src/plugin/PluginPage.tsx` · `events.ts` | 页面容器；插件事件的渲染进程总线 |
| `src/renderer/src/store/actions.ts` | `loadPlugins()`、`showPluginPage()`、`plugin` 事件转 toast |
| `src/renderer/src/components/layout/Sidebar.tsx` · `Main.tsx` | 导航项与页面标题 |
| `plugin/pi-plugin-example/` | 示例包：页面 + host 入口 + 私有存储 |

## 11. 验收

装上 `plugin/pi-plugin-example` 并启用后：侧边栏出现 Example 页面 → 页面显示当前会话 → 点 Greet 走 `host.call` 拿到计数（并收到 `desktop.emit` 的推送）→ 点按钮往会话发一条消息 → 停用后页面消失、调用被拒 → 重启后计数仍在。

## 12. 用 AI 写插件

模型不需要读这份文档：应用自带一个 `plugin-author` 技能（`src/agent/skills/plugin-author/SKILL.md`，启动时写进 `~/.pi-desktop/skills/plugin-author/`，经 `additionalSkillPaths` 交给每个会话，升级应用时刷新）。

| 环节 | 是什么 |
|---|---|
| 技能 | 清单字段、页面 API、host API、权限、常见错误。描述里带触发词（「做一个插件」「给桌面加个页面」），模型自己会读 |
| `pidesk_plugin_create` | 写一份能跑的骨架到 `~/.pi-desktop/plugins/<id>/` 并装成本地 pi 包；放在应用自己的目录，`settings.json` 里的路径不会指向一个临时文件夹 |
| Customize → Plugins → 「用 AI 创建」 | 开一个新会话并把提示写好一半 |

一条硬规则：脚手架只负责写文件和安装，**启用与授权仍然由用户点**（`pidesk_plugin_create` 的返回值里就写着这句话）。

## 13. 还没做

- **卡片 / 输入框动作 / 设置字段**：`contributions` 里只有 `pages`。
- **`fs:cwd` 与 `net:<host>` 权限**：SDK 还没有对应方法，所以权限表里也不出现。
- **卸载清理**：删包后 `plugins.json` 与 `plugin-data/<id>` 还在。
- **开发热重载**：改 host 入口要重启应用（ESM 已加载）。
- **远端窗口的插件页面**：需要服务端把包内静态资源也传过去。
- **插件页的快捷键**：iframe 内的按键不进主窗口。
- **内置技能不能在 Customize 里关掉**：它是应用自带的（同 desktop-kit），不进 Customize 的技能列表。
