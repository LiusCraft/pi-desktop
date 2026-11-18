# 会话目标：行为对照

对比的是「本轮回复结束但目标尚未达到」时谁来决定下一步，而不是是否能写待办清单。

| 工具 | 目标如何停止、恢复 |
| --- | --- |
| [Codex CLI](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex) | 原生线程目标。以线程中的证据判断完成；可暂停、恢复、清除，亦可因预算耗尽而停止。 |
| [Claude Code](https://code.claude.com/docs/en/goal) | 原生完成条件。每轮结束后由独立模型检查对话证据，判断「未达成 / 达成 / 不可能」。恢复会话可带回活跃目标；目标不改变工具权限。 |
| [OpenCode v2.2.1](https://opencode.ai/changelog/v2.2.1) | TUI 和 Desktop 原生命令，由 reviewer 确认目标。支持 `pause`、`resume`、`clear`。发布说明未描述重启行为。 |
| [Pi 扩展示例：pi-codex-goal](https://pi.dev/packages/pi-codex-goal) | 扩展提供命令，不是本项目所用 SDK 自带的命令。目标随会话保存，可暂停、等待外部结果、恢复，并可设 token 预算。 |

Pi Desktop 采用会话级目标和显式暂停/恢复。首版由执行模型通过工具提交证据或阻碍，不额外调用裁判模型；因此它是带证据的自报，不是独立验证。每次开始或恢复最多额外续跑 10 次。重开时保留目标，不自动消费额度。CI 属于事件驱动任务：PR watcher 等待外部变化，目标循环不代替 CI 轮询，也不授予合并权限。
