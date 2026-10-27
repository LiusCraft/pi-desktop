import type { OutputStyle, PermissionMode, ThinkingLevel } from '@shared/protocol';

export const MODES: { id: PermissionMode; name: string; desc: string }[] = [
  { id: 'auto', name: 'Auto', desc: '自动执行安全操作；推送、发 PR、删除等有风险的命令才询问' },
  { id: 'default', name: 'Ask permissions', desc: '编辑文件和运行命令前都先征求同意' },
  { id: 'acceptEdits', name: 'Accept edits', desc: '直接修改项目内文件，运行命令前询问' },
  { id: 'plan', name: 'Plan', desc: '只读探索，先给出计划，批准后再动手' },
  { id: 'bypass', name: 'Bypass permissions', desc: '完全不询问，仅建议在隔离环境中使用' },
];
export const modeName = (id: PermissionMode | undefined) => MODES.find((m) => m.id === id)?.name ?? 'Auto';

export const LEVEL_LABEL: Record<ThinkingLevel, string> = { off: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra', max: 'Max' };

export type ViewMode = 'normal' | 'thinking' | 'verbose';
export const VIEW_MODES: { id: ViewMode; name: string; desc: string }[] = [
  { id: 'normal', name: 'Normal', desc: 'Tool calls collapsed into summaries' },
  { id: 'thinking', name: 'Thinking', desc: 'Summaries plus the model’s thinking' },
  { id: 'verbose', name: 'Verbose', desc: 'Every tool call, read, and step' },
];

export const OUTPUT_STYLE_INFO: { id: OutputStyle; name: string; desc: string }[] = [
  { id: 'default', name: 'Default', desc: 'Standard software-engineering behavior' },
  { id: 'proactive', name: 'Proactive', desc: 'Act on reasonable assumptions' },
  { id: 'concise', name: 'Concise', desc: 'Lead with the result, skip narration' },
  { id: 'explanatory', name: 'Explanatory', desc: 'Add short insights while working' },
  { id: 'learning', name: 'Learning', desc: 'Learn by completing small pieces yourself' },
];

/** Slash commands the desktop handles itself (the session adds pi's own). */
export const DESKTOP_COMMANDS: [string, string][] = [
  ['/clear', '开始新的上下文（保留会话）'],
  ['/compact', '压缩对话历史'],
  ['/btw', '旁路提问：基于当前会话聊一句，不进入上下文'],
  ['/context', '查看上下文用量'],
  ['/model', '切换模型'],
  ['/permissions', '切换权限模式'],
  ['/export', '导出会话为 HTML'],
  ['/help', '查看命令与快捷键'],
];

export const WORK_IDEAS = [
  { label: 'Send me a daily briefing', prompt: '每个工作日早上 8 点给我发一份简报：日程、待办和重要邮件' },
  { label: 'Organize my inbox', prompt: '帮我整理收件箱：归类、标记需要回复的邮件，并起草回复' },
  { label: 'Customize Work for me', prompt: '根据我的工作方式，帮我定制 Work：推荐合适的技能和连接器' },
];
