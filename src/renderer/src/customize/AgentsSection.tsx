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
import { call, errText, isRemote } from '@/lib/api';
import { useT } from '@/lib/i18n';
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
  originalName: a.name,
  name: a.name,
  description: a.description,
  model: a.model ?? '',
  tools: a.tools ?? [],
  body: a.body,
  builtin: a.source === 'builtin',
});

export function AgentsSection() {
  const t = useT();
  const [catalog, setCatalog] = useState<AgentCatalog | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void call('agents:list')
      .then(setCatalog)
      .catch((e) => toast.error(errText(e)));
  }, []);
  useEffect(load, [load]);

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const draft: AgentDraft = {
        originalName: form.originalName,
        name: form.name,
        description: form.description,
        body: form.body,
        model: form.model || null,
        tools: form.tools,
      };
      setCatalog(await call('agents:save', draft));
      setForm(null);
      toast.success(t('agents.saved'));
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
        <Heading
          title={form.originalName ? t('agents.edit', { name: form.originalName }) : t('agents.new')}
          sub={t('agents.form.sub')}
          tip={t('agents.form.tip')}
        />
        <div className="space-y-4 rounded-xl border bg-card p-4">
          <Field label={t('skills.name')} hint={t('agents.name.hint')}>
            <Input
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="reviewer"
              disabled={form.builtin}
              spellCheck={false}
            />
          </Field>
          <Field label={t('skills.description')} hint={t('agents.description.hint')}>
            <Input
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
              placeholder="Reviews a diff for bugs and risky changes"
            />
          </Field>
          <Field label={t('agents.model')}>
            <ModelPicker
              value={form.model || null}
              onChange={(model) => set({ model: model ?? '' })}
              emptyLabel={t('agents.followMain')}
              label={t('agents.modelLabel')}
            />
          </Field>
          <Field label={t('agents.tools')} hint={t('agents.tools.hint')} tip={t('agents.tools.tip')}>
            <ToolsInput value={form.tools} onChange={(tools) => set({ tools })} placeholder={t('agents.toolsPh')} />
          </Field>
          <Field label={t('agents.prompt')}>
            <Textarea
              value={form.body}
              onChange={(e) => set({ body: e.target.value })}
              rows={10}
              placeholder="You are a meticulous code reviewer…"
              className="min-h-48 font-mono text-xs"
            />
          </Field>
          <div className="flex items-center gap-2 pt-1">
            <Button onClick={() => void save()} disabled={busy}>
              {t(form.builtin ? 'agents.saveCustom' : 'agents.save')}
            </Button>
            <Button variant="ghost" onClick={() => setForm(null)}>
              {t('agents.cancel')}
            </Button>
            <span className="flex-1" />
            {existing?.source === 'user' && (
              <Button variant="ghost" className="text-destructive" onClick={() => void remove(existing.name)}>
                {existing.overrides ? (
                  <>
                    <RotateCcwIcon className="size-4" />
                    {t('agents.restore')}
                  </>
                ) : (
                  <>
                    <Trash2Icon className="size-4" />
                    {t('agents.delete')}
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Heading title={t('agents.title')} sub={t('agents.sub')} tip={t('agents.tip')} />
      <div className="mb-3 flex items-center gap-2">
        <Button size="sm" onClick={() => setForm({ ...blank })}>
          <PlusIcon className="size-4" />
          {t('agents.new')}
        </Button>
        {!isRemote && (
          <Button
            size="sm"
            variant="outline"
            disabled={!catalog}
            onClick={() => catalog && call('app:revealPath', catalog.dir).catch((e) => toast.error(errText(e)))}
          >
            <FolderOpenIcon className="size-4" />
            {t('agents.openFolder')}
          </Button>
        )}
        <span className="flex-1" />
        <span className="text-xs text-muted-foreground">{t('agents.newOnly')}</span>
      </div>
      <Panel>
        {catalog?.agents.map((a) => (
          <div key={a.name} className="flex items-start gap-3 px-4 py-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
              <BotIcon className="size-4 text-muted-foreground" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-sm font-medium">{a.name}</span>
                <Badge variant="secondary">
                  {t(a.source === 'builtin' ? 'agents.builtin' : a.overrides ? 'agents.overridden' : 'agents.custom')}
                </Badge>
                {a.model && <span className="text-xs text-muted-foreground">{a.model}</span>}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{a.description}</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => setForm(toForm(a))}>
              <PencilIcon className="size-3.5" />
              {t('agents.editBtn')}
            </Button>
          </div>
        ))}
        {!catalog && <div className="px-4 py-3 text-sm text-muted-foreground">{t('customize.loading')}</div>}
      </Panel>
    </>
  );
}
