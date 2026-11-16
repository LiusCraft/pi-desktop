---
name: plugin-author
description: 写 Pi Desktop 桌面插件时使用：给侧边栏加页面、给桌面加一个后台入口、申请桌面权限。用户说「做一个插件」「给桌面加个页面」「扩展 Pi Desktop」时先读这个。
---

# 写一个桌面插件

一个插件就是一个 pi package，`package.json` 的 `piDesktop` 段声明桌面能力。**先搭骨架，再改两个文件**，不要从零手写 manifest。

## 1. 搭骨架

调用工具 `pidesk_plugin_create`：

| 参数          |                                                             |
| ------------- | ----------------------------------------------------------- |
| `id`          | 小写字母、数字、`-`，2–32 字符，全局唯一（如 `todo-board`） |
| `title`       | 侧边栏显示的名字，短                                        |
| `description` | 一句话说明这个插件做什么                                    |
| `permissions` | 只申请真正用到的，见 §5                                     |

它会把包写到 `~/.pi-desktop/plugins/<id>/` 并装成本地 pi 包，返回路径。**不要自己替用户启用**：装完是「未启用」，让用户去 Customize → Plugins 点开关并确认权限。

## 2. 文件结构

```
~/.pi-desktop/plugins/<id>/
├── package.json      piDesktop 段：id、permissions、host、contributions.pages
├── host.js           可选：在 agent 进程里跑的代码，默认导出 activate(desktop)
└── ui/
    ├── index.html    页面（包内 HTML，被放进沙箱 iframe）
    ├── page.js       页面脚本，用 window.pidesk
    └── page.css      样式（可选，也可以用内联 <style>）
```

`package.json` 里 `piDesktop` 的完整形状：

```jsonc
"piDesktop": {
  "apiVersion": 1,
  "id": "todo-board",
  "permissions": ["session:read", "storage", "host:call"],
  "host": "./host.js",
  "contributions": { "pages": [{ "id": "board", "title": "Todo", "entry": "ui/index.html", "views": ["code", "work"] }] }
}
```

`views` 省略表示两种模式都显示。`host` 省略表示只有页面、没有后台代码。

## 3. 页面 API（iframe 里，`window.pidesk`）

页面拿不到应用的 bridge、文件系统或网络，只能调这些：

```js
await pidesk.ready(); // 收到第一份 session / theme 之后
pidesk.session.current(); // { id, kind, title, cwd } | null
pidesk.session.onChange((session) => {}); // 订阅：会立刻回放当前值
await pidesk.session.prompt('帮我看下这个报错');
await pidesk.host.call('load', 'arg1', 'arg2'); // 转到 host.js 里注册的方法
pidesk.host.on('items', (items) => {}); // host 用 desktop.emit 推来的数据
await pidesk.storage.get('key'); // 插件私有 KV
await pidesk.storage.set('key', value);
pidesk.notify('做完了'); // toast
pidesk.theme(); // 应用主题的 CSS 变量值
pidesk.onTheme((theme) => {}); // 主题变了
```

SDK 由应用提供：`<script src="/sdk/pidesk.js"></script>`（绝对路径，同源）。

页面有 CSP：`script-src 'self'`，**不能写内联 `<script>`**，脚本必须是单独的 `.js` 文件；样式可以用内联 `<style>`。

## 4. host API（`host.js`，agent 进程）

```js
export default function activate(desktop) {
  desktop.handle('load', async (filter) => items(filter)); // 页面用 host.call 调
  desktop.emit('items', items); // 推给打开着的页面
  desktop.notify('有 3 条待办', 'warning'); // info | warning | error
  desktop.storage.get('lastSeen'); // 和页面的 pidesk.storage 是同一个
  desktop.storage.set('lastSeen', Date.now());
  desktop.dataDir; // 可写目录，已创建
}
```

- 方法名只能是字母开头 + 字母/数字/`_ . -`；`#` 开头是运行时保留的。
- 返回值必须是 JSON（字符串、数字、布尔、null、数组、普通对象），不能是函数、类实例或循环引用。
- `activate` 每个进程只跑一次，**没有会话概念**：不要在里面依赖当前会话；需要会话就在页面侧读，再用 `host.call` 把参数带过来。
- 同一个方法重复注册，最后一次生效。

agent 侧能力（工具、命令、钩子）不写在这里：那属于 `pi.extensions`，是另一个入口、另一套 API，本次不用管。

## 5. 权限

| 权限             | 放开什么                           |
| ---------------- | ---------------------------------- |
| `session:read`   | 当前会话的 id / kind / title / cwd |
| `session:prompt` | 往当前会话发一条消息               |
| `notify`         | toast                              |
| `storage`        | 插件私有 KV                        |
| `host:call`      | 页面调用 `host.js` 里注册的方法    |

没有 fs、没有 shell、没有网络、没有直接 IPC。**不要申请用不到的能力**：用户看到权限清单会犹豫。

## 6. 改完怎么验证

1. 改 `ui/index.html`、`ui/page.js`、`host.js`。
2. 告诉用户去 Customize → Plugins 展开这个包 → 桌面能力 → 启用，然后侧边栏就有页面。
3. 改页面要重新加载：停用再启用，或点页面上的「重新加载」。
4. 改 `host.js` 需要重启应用（模块已加载，ESM 不能卸载）。

## 7. 常见错误

| 现象                                      | 原因                                                      |
| ----------------------------------------- | --------------------------------------------------------- |
| Customize 里那一行标红                    | manifest 字段不合法，或 `entry` / `host` 指向的文件不存在 |
| 侧边栏没有页面                            | 没启用、没授权、或 `views` 不包含当前模式                 |
| 页面白屏 / 「没有响应」                   | 用了内联 `<script>`（被 CSP 挡），或脚本路径写错          |
| `host.call` 报「没有方法」                | `host.js` 没注册这个方法，或 `host` 字段没写              |
| `host.call` 报「没有获得 host:call 权限」 | manifest 里没申请，或用户没同意                           |
| 返回值报「无法传递的值」                  | 返回了非 JSON 的东西                                      |
