// The Customize page: Skills, Connectors and Plugins, mapped onto pi's skills,
// MCP servers and packages, plus the subagent identities Pi Desktop adds. It replaces the
// conversation area while open; project-level entries follow the project picked in the sidebar.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { BotIcon, PackageIcon, PlugZapIcon, PlusIcon, ScrollTextIcon, SparklesIcon, StarIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { CustomizeCatalog, PromptDraft, PromptInfo } from '@shared/protocol';
import { call, errText } from '@/lib/api';
import { fname } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { dialogs } from '@/store/dialogs';
import { useApp } from '@/store/app';
import { AgentsSection } from './AgentsSection';
import { ConnectorsSection } from './ConnectorsSection';
import { PluginsSection } from './PluginsSection';
import { RecommendedSection } from './RecommendedSection';
import { SkillsSection } from './SkillsSection';
import { BackButton, Empty, Field, Heading, Panel, Segmented, stripFrontmatter } from './ui';

type Tab = 'recommended' | 'skills' | 'connectors' | 'plugins' | 'prompts' | 'agents';

function PromptForm({ project, initial, onDone, onCatalog }: { project: string | null; initial?: PromptInfo; onDone: () => void; onCatalog: (c: CustomizeCatalog) => void }) {
  const t = useT();
  const [draft, setDraft] = useState<PromptDraft>({ name: initial?.name ?? '', description: initial?.description ?? '', body: '', scope: initial?.scope === 'project' ? 'project' : 'user', file: initial?.file });
  const [loaded, setLoaded] = useState(!initial);
  useEffect(() => {
    if (!initial) return;
    void call('customize:readFile', initial.file)
      .then((text) => setDraft((d) => ({ ...d, body: stripFrontmatter(text) })))
      .catch((e) => toast.error(errText(e)))
      .finally(() => setLoaded(true));
  }, [initial]);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<PromptDraft>) => setDraft({ ...draft, ...patch });
  const save = async () => {
    setBusy(true);
    try {
      onCatalog(await call('customize:promptCreate', draft, project));
      toast.success(t(initial ? 'prompts.saved' : 'prompts.created'));
      onDone();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!initial || !(await dialogs.confirm(t('prompts.deleteTitle', { name: initial.name }), t('prompts.deleteBody'), t('prompts.delete'), true))) return;
    try {
      onCatalog(await call('customize:promptDelete', initial.file, project));
      onDone();
    } catch (err) {
      toast.error(errText(err));
    }
  };
  return (
    <>
      <BackButton onClick={onDone}>{t('prompts.back')}</BackButton>
      <Heading title={initial ? t('prompts.edit', { name: initial.name }) : t('prompts.new')} sub={t('prompts.new.sub')} tip={t('prompts.new.tip')} />
      <div className="space-y-4 rounded-xl border bg-card p-4">
        {!initial && (
          <Field label={t('skills.saveTo')} hint={draft.scope === 'user' ? t('skills.allProjects') : t('skills.onlyIn', { name: project ? fname(project) : t('skills.thisProject') })}>
            <Segmented value={draft.scope} onChange={(scope) => set({ scope })} options={[{ id: 'user', label: t('skills.personal') }, { id: 'project', label: t('skills.projectOpt'), disabled: !project }]} />
          </Field>
        )}
        <Field label={t('skills.name')} hint={t('prompts.name.hint')}>
          <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="review" spellCheck={false} />
        </Field>
        <Field label={t('connectors.descOptional')}>
          <Input value={draft.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <Field label={t('prompts.content')}>
          <Textarea value={draft.body} onChange={(e) => set({ body: e.target.value })} rows={10} className="min-h-48 text-sm" />
        </Field>
        <div className="flex gap-2">
          <Button onClick={() => void save()} disabled={busy || !loaded}>{t(initial ? 'prompts.save' : 'skills.create')}</Button>
          <Button variant="ghost" onClick={onDone}>{t('skills.cancel')}</Button>
          {initial && <Button variant="ghost" className="ml-auto text-destructive hover:text-destructive" onClick={() => void remove()}>{t('prompts.delete')}</Button>}
        </div>
      </div>
    </>
  );
}

/** Prompt templates are plain Markdown files: a list, plus a form to write one. */
function PromptsSection({ catalog, project, onCatalog }: { catalog: CustomizeCatalog; project: string | null; onCatalog: (c: CustomizeCatalog) => void }) {
  const t = useT();
  const [form, setForm] = useState<PromptInfo | 'new' | null>(null);
  if (form) return <PromptForm project={project} initial={form === 'new' ? undefined : form} onCatalog={onCatalog} onDone={() => setForm(null)} />;
  return (
    <>
      <Heading
        title={t('customize.tab.prompts')}
        sub={t('prompts.sub')}
        tip={t('prompts.tip')}
        action={<Button size="sm" className="shrink-0" onClick={() => setForm('new')}><PlusIcon className="size-4" />{t('prompts.new')}</Button>}
      />
      <Panel>
        {catalog.prompts.map((p) => (
          <button key={p.file} disabled={p.scope === 'package'} className="flex w-full items-start gap-3 px-4 py-3 text-left enabled:hover:bg-accent/40" onClick={() => setForm(p)}>
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40"><ScrollTextIcon className="size-4 text-muted-foreground" /></span>
            <div className="min-w-0 flex-1">
              <div className="font-mono text-sm font-medium">/{p.name}</div>
              <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{p.description || t('customize.noDescription')}</div>
            </div>
            <span className="text-xs text-muted-foreground">{t(`customize.scope.${p.scope}`)}</span>
          </button>
        ))}
        {!catalog.prompts.length && <Empty>{t('prompts.empty', { dir: catalog.dirs.prompts })}</Empty>}
      </Panel>
    </>
  );
}

export function CustomizePage() {
  const t = useT();
  const view = useApp((s) => s.view);
  // Work folders are usually plain document folders, so project-level entries (a `.pi` folder) belong to Code only.
  const project = useApp((s) => (s.view === 'work' ? null : s.prefs.project));
  const [tab, setTab] = useState<Tab>('skills');
  const [catalog, setCatalog] = useState<CustomizeCatalog | null>(null);

  const load = useCallback(() => {
    void call('customize:list', project).then(setCatalog).catch((e) => toast.error(errText(e)));
  }, [project]);
  useEffect(load, [load, view]);

  const tabs: { id: Tab; label: string; icon: ReactNode; count?: number }[] = [
    { id: 'recommended', label: t('customize.tab.recommended'), icon: <StarIcon className="size-4" /> },
    { id: 'skills', label: t('customize.tab.skills'), icon: <SparklesIcon className="size-4" />, count: catalog?.skills.length },
    { id: 'connectors', label: t('customize.tab.connectors'), icon: <PlugZapIcon className="size-4" />, count: catalog?.connectors.length },
    { id: 'plugins', label: t('customize.tab.plugins'), icon: <PackageIcon className="size-4" />, count: catalog?.plugins.length },
    { id: 'prompts', label: t('customize.tab.prompts'), icon: <ScrollTextIcon className="size-4" />, count: catalog?.prompts.length },
    { id: 'agents', label: t('customize.tab.agents'), icon: <BotIcon className="size-4" /> },
  ];
  const props = catalog && { catalog, project, onCatalog: setCatalog };

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} orientation="vertical" className="min-h-0 flex-1 flex-row gap-0">
      <nav className="w-52 shrink-0 space-y-0.5 border-r px-2 py-3">
        <div className="flex h-8 items-center px-2.5 text-sm font-semibold">{t('customize.title')}</div>
        <TabsList className="h-auto w-full flex-col items-stretch gap-0.5 bg-transparent p-0">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="h-8 flex-none justify-start gap-2.5 rounded-lg px-2.5 shadow-none hover:bg-accent/60 data-[state=active]:bg-accent data-[state=active]:shadow-none"
            >
              {tab.icon}
              <span className="flex-1 text-left">{tab.label}</span>
              {!!tab.count && <span className="text-xs tabular-nums">{tab.count}</span>}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="px-2.5 pt-4 text-xs text-muted-foreground">
          {project ? <>{t('customize.project')}<span className="font-medium text-foreground" title={project}>{fname(project)}</span></> : t(view === 'work' ? 'customize.workOnlyPersonal' : 'customize.noProject')}
        </div>
      </nav>
      <div className="relative min-w-0 flex-1 overflow-y-auto">
        <div key={tab} className="mx-auto max-w-3xl animate-in px-8 py-8 duration-200 fade-in-0 slide-in-from-bottom-1">
          {tab === 'agents' ? (
            <AgentsSection />
          ) : !props ? (
            <div className="text-sm text-muted-foreground">{t('customize.loading')}</div>
          ) : tab === 'recommended' ? (
            <RecommendedSection {...props} />
          ) : tab === 'skills' ? (
            <SkillsSection {...props} />
          ) : tab === 'connectors' ? (
            <ConnectorsSection {...props} />
          ) : tab === 'plugins' ? (
            <PluginsSection {...props} />
          ) : (
            <PromptsSection {...props} />
          )}
        </div>
      </div>
    </Tabs>
  );
}
