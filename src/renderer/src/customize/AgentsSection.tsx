// Customize → Subagents: the identities Pi Desktop can pick for the `pidesk_task` tool. Built-in
// ones can be overridden; custom ones live as markdown files in <app data>/agents.
import { useCallback, useEffect, useState } from 'react';
import { BotIcon, FolderOpenIcon, PencilIcon, PlusIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import type { AgentCatalog, AgentConfig, AgentDraft } from '@shared/protocol';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { call, errText } from '@/lib/api';
import { ModelPicker } from '@/settings/ModelPicker';
import { ToolsInput } from '@/settings/ToolsInput';
import { Field, Heading, Panel } from './ui';

interface Form {
  originalName?: string;
  name: string;
  description: string;
  model: string;
  tools: string[];
  body: string;
  builtin: boolean;
}
const blank: Form = { name: '', description: '', model: '', tools: [], body: '', builtin: false };
const toForm = (a: AgentConfig): Form => ({
  originalName: a.name, name: a.name, description: a.description, model: a.model ?? '', tools: a.tools ?? [], body: a.body, builtin: a.source === 'builtin',
});

export function AgentsSection() {
  const [catalog, setCatalog] = useState<AgentCatalog | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void call('agents:list').then(setCatalog).catch((e) => toast.error(errText(e)));
  }, []);
  useEffect(load, [load]);

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const draft: AgentDraft = {
        originalName: form.originalName, name: form.name, description: form.description, body: form.body,
        model: form.model || null, tools: form.tools,
      };
      setCatalog(await call('agents:save', draft));
      setForm(null);
      toast.success('已保存，新建的会话会用上它');
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (name: string) => {
    try {
      setCatalog(await call('agents:remove', name));
      setForm(null);
    } catch (err) {
      toast.error(errText(err));
    }
  };

  if (form) {
    const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
    const existing = catalog?.agents.find((a) => a.name === form.originalName);
    return (
      <>
        <Heading title={form.originalName ? `编辑 ${form.originalName}` : '新建子代理'} sub="描述决定模型什么时候选它，系统提示决定它怎么做事。子代理始终只读，不会修改文件。" />
        <div className="space-y-4 rounded-xl border bg-card p-4">
          <Field label="名称" hint="字母、数字、- 和 _；模型调用时用这个名字。">
            <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="reviewer" disabled={form.builtin} spellCheck={false} />
          </Field>
          <Field label="描述" hint="一句话说明它擅长什么，会展示给模型。">
            <Input value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="Reviews a diff for bugs and risky changes" />
          </Field>
          <Field label="模型">
            <ModelPicker value={form.model || null} onChange={(model) => set({ model: model ?? '' })} emptyLabel="跟随主会话的模型" label="子代理使用的模型" />
          </Field>
          <Field label="工具白名单" hint="可以直接输入名称或模式（如 mcp__*）后回车，也可以从下拉里选。留空则使用默认的只读工具并保留 MCP 工具；填写后只启用这里列出的工具。">
            <ToolsInput value={form.tools} onChange={(tools) => set({ tools })} placeholder="留空 = 默认" />
          </Field>
          <Field label="系统提示">
            <Textarea value={form.body} onChange={(e) => set({ body: e.target.value })} rows={10} placeholder="You are a meticulous code reviewer…" className="min-h-48 font-mono text-xs" />
          </Field>
          <div className="flex items-center gap-2 pt-1">
            <Button onClick={() => void save()} disabled={busy}>{form.builtin ? '保存为自定义版本' : '保存'}</Button>
            <Button variant="ghost" onClick={() => setForm(null)}>取消</Button>
            <span className="flex-1" />
            {existing?.source === 'user' && (
              <Button variant="ghost" className="text-destructive" onClick={() => void remove(existing.name)}>
                {existing.overrides ? <><RotateCcwIcon className="size-4" />恢复内置</> : <><Trash2Icon className="size-4" />删除</>}
              </Button>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Heading title="子代理" sub="Pi Desktop 把调研类工作交给子代理时可以选的身份。内置的可以改写，自定义的保存在下面的文件夹里。" />
      <div className="mb-3 flex items-center gap-2">
        <Button size="sm" onClick={() => setForm({ ...blank })}><PlusIcon className="size-4" />新建子代理</Button>
        <Button size="sm" variant="outline" disabled={!catalog} onClick={() => catalog && call('app:revealPath', catalog.dir).catch((e) => toast.error(errText(e)))}>
          <FolderOpenIcon className="size-4" />打开文件夹
        </Button>
        <span className="flex-1" />
        <span className="text-xs text-muted-foreground">新建的会话才会用到修改</span>
      </div>
      <Panel>
        {catalog?.agents.map((a) => (
          <div key={a.name} className="flex items-start gap-3 px-4 py-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40"><BotIcon className="size-4 text-muted-foreground" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-sm font-medium">{a.name}</span>
                <Badge variant="secondary">{a.source === 'builtin' ? '内置' : a.overrides ? '已改写内置' : '自定义'}</Badge>
                {a.model && <span className="text-xs text-muted-foreground">{a.model}</span>}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{a.description}</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => setForm(toForm(a))}><PencilIcon className="size-3.5" />编辑</Button>
          </div>
        ))}
        {!catalog && <div className="px-4 py-3 text-sm text-muted-foreground">加载中…</div>}
      </Panel>
    </>
  );
}
