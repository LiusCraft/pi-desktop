// Customize → Skills: the pi skills that load for the selected project. Personal and project
// skills can be switched off (kept on disk, not loaded) or created here; skills that come
// with a plugin are read-only because the plugin owns them.
import { useEffect, useState } from 'react';
import { ChevronRightIcon, FolderOpenIcon, PlusIcon, SparklesIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import type { CustomizeCatalog, CustomizeScope, SkillDraft, SkillInfo } from '@shared/protocol';
import { Markdown } from '@/components/common/Markdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { call, errText, isRemote } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { fname } from '@/lib/format';
import { dialogs } from '@/store/dialogs';
import { BackButton, Empty, Field, Heading, Panel, Segmented, stripFrontmatter } from './ui';

interface Props {
  catalog: CustomizeCatalog;
  project: string | null;
  onCatalog: (c: CustomizeCatalog) => void;
}

const SCOPE_TITLE = { user: 'skills.scope.user', project: 'skills.scope.project', package: 'skills.scope.package' } as const;

function SkillRow({ skill, onOpen, onToggle, onDelete }: { skill: SkillInfo; onOpen: () => void; onToggle?: (on: boolean) => void; onDelete?: () => void }) {
  const t = useT();
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <button className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={onOpen}>
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40"><SparklesIcon className="size-4 text-muted-foreground" /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-sm font-medium">{skill.name}</span>
            {skill.manualOnly && <Badge variant="secondary" title={t('skills.manualOnlyHint')}>{t('skills.manualOnly')}</Badge>}
          </span>
          <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{skill.description || t('customize.noDescription')}</span>
        </span>
      </button>
      {onDelete && <Button size="icon" variant="ghost" className="size-8 text-destructive" title={t('skills.delete')} onClick={onDelete}><Trash2Icon className="size-4" /></Button>}
      {onToggle && <Switch checked={!skill.disabled} onCheckedChange={onToggle} aria-label={t(skill.disabled ? 'skills.enable' : 'skills.disable', { name: skill.name })} />}
    </div>
  );
}

function SkillDetail({ skill, onBack }: { skill: SkillInfo; onBack: () => void }) {
  const t = useT();
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(null);
    void call('customize:readFile', skill.file).then(setText).catch((e) => setText(t('skills.cantRead', { error: errText(e) })));
  }, [skill.file]);
  return (
    <>
      <BackButton onClick={onBack}>{t('skills.back')}</BackButton>
      <Heading
        title={skill.name}
        sub={skill.description || t('customize.noDescription')}
        action={!isRemote && (
          <Button size="sm" variant="outline" onClick={() => call('app:revealPath', skill.file, true).catch((e) => toast.error(errText(e)))}>
            <FolderOpenIcon className="size-4" />{t('skills.showFile')}
          </Button>
        )}
      />
      <div className="mb-3 truncate font-mono text-xs text-muted-foreground" title={skill.file}>{skill.file}</div>
      <div className="rounded-xl border bg-card p-5">
        {text === null ? <span className="text-sm text-muted-foreground">{t('customize.loading')}</span> : <Markdown text={stripFrontmatter(text)} className="text-sm" />}
      </div>
    </>
  );
}

function SkillForm({ project, onDone, onCatalog }: Omit<Props, 'catalog'> & { onDone: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState<SkillDraft>({ name: '', description: '', body: '', scope: 'user', home: 'pi' });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<SkillDraft>) => setDraft({ ...draft, ...patch });
  const save = async () => {
    setBusy(true);
    try {
      onCatalog(await call('customize:skillCreate', draft, project));
      toast.success(t('skills.created'));
      onDone();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <BackButton onClick={onDone}>{t('skills.back')}</BackButton>
      <Heading title={t('skills.new')} sub={t('skills.new.sub')} tip={t('skills.new.tip')} />
      <div className="space-y-4 rounded-xl border bg-card p-4">
        <Field label={t('skills.saveTo')} hint={draft.scope === 'user' ? t('skills.allProjects') : t('skills.onlyIn', { name: project ? fname(project) : t('skills.thisProject') })}>
          <Segmented value={draft.scope} onChange={(scope) => set({ scope })} options={[{ id: 'user', label: t('skills.personal') }, { id: 'project', label: t('skills.projectOpt'), disabled: !project }]} />
        </Field>
        <Field label={t('skills.store')} hint={draft.home === 'agents' ? t('skills.homeAgents', { home: draft.scope === 'user' ? '~' : '' }) : t('skills.homePi', { where: t(draft.scope === 'user' ? 'skills.homePiUser' : 'skills.homePiProject') })}>
          <Segmented value={draft.home ?? 'pi'} onChange={(home) => set({ home })} options={[{ id: 'pi', label: 'pi' }, { id: 'agents', label: t('skills.homeShared') }]} />
        </Field>
        <Field label={t('skills.name')} hint={t('skills.name.hint')}>
          <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="release-notes" spellCheck={false} />
        </Field>
        <Field label={t('skills.description')} hint={t('skills.description.hint')}>
          <Input value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="Write release notes from merged PRs. Use when asked to prepare a release." />
        </Field>
        <Field label={t('skills.content')}>
          <Textarea value={draft.body} onChange={(e) => set({ body: e.target.value })} rows={12} className="min-h-56 font-mono text-xs" placeholder={'# Release notes\n\n1. List merged PRs since the last tag…'} />
        </Field>
        <div className="flex gap-2">
          <Button onClick={() => void save()} disabled={busy}>{t('skills.create')}</Button>
          <Button variant="ghost" onClick={onDone}>{t('skills.cancel')}</Button>
        </div>
      </div>
    </>
  );
}

export function SkillsSection({ catalog, project, onCatalog }: Props) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (creating) return <SkillForm project={project} onCatalog={onCatalog} onDone={() => setCreating(false)} />;
  const detail = catalog.skills.find((s) => s.file === open);
  if (detail) return <SkillDetail skill={detail} onBack={() => setOpen(null)} />;

  const toggle = async (s: SkillInfo, on: boolean) => {
    try {
      onCatalog(await call('customize:skillSetDisabled', s.file, !on, project));
    } catch (err) {
      toast.error(errText(err));
    }
  };
  const remove = async (s: SkillInfo) => {
    if (!(await dialogs.confirm(t('skills.deleteTitle', { name: s.name }), t('skills.deleteBody'), t('skills.delete'), true))) return;
    try {
      onCatalog(await call('customize:skillDelete', s.file, project));
      toast.success(t('skills.deleted'));
    } catch (err) {
      toast.error(errText(err));
    }
  };
  const toggleGroup = (origin: string) =>
    setExpanded((e) => {
      const next = new Set(e);
      if (next.has(origin)) next.delete(origin);
      else next.add(origin);
      return next;
    });
  const claude = async (action: 'customize:claudeImport' | 'customize:claudeDismiss') => {
    try {
      onCatalog(await call(action, project));
      if (action === 'customize:claudeImport') toast.success(t('skills.imported'));
    } catch (err) {
      toast.error(errText(err));
    }
  };
  const reveal = (dir: string) => call('app:revealPath', dir).catch((e) => toast.error(errText(e)));
  const scopes: CustomizeScope[] = ['user', 'project', 'package'];
  return (
    <>
      <Heading
        title={t('customize.tab.skills')}
        sub={t('skills.sub')}
        tip={t('skills.tip')}
        action={
          <div className="flex shrink-0 gap-2">
            {!isRemote && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button size="sm" variant="outline"><FolderOpenIcon className="size-4" />{t('skills.openFolder')}</Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => void reveal(catalog.dirs.skills)}>{t('skills.piSkills')}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void reveal(catalog.dirs.agentsSkills)}>{t('skills.sharedSkills')}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button size="sm" onClick={() => setCreating(true)}><PlusIcon className="size-4" />{t('skills.new')}</Button>
          </div>
        }
      />
      {catalog.claudeSkills && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border bg-muted/30 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{t('skills.claudeFound', { n: catalog.claudeSkills.count })}</div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground" title={catalog.claudeSkills.dir}>{t('skills.claudeHint', { dir: catalog.claudeSkills.dir })}</div>
          </div>
          <Button size="sm" onClick={() => void claude('customize:claudeImport')}>{t('skills.import')}</Button>
          <Button size="sm" variant="ghost" onClick={() => void claude('customize:claudeDismiss')}>{t('skills.dismiss')}</Button>
        </div>
      )}
      {!catalog.skills.length && <Panel><Empty>{t('skills.empty')}</Empty></Panel>}
      <div className="space-y-6">
        {scopes.map((scope) => {
          const list = catalog.skills.filter((s) => s.scope === scope);
          if (!list.length) return null;
          if (scope === 'package') {
            const byPackage = Map.groupBy(list, (s) => s.origin);
            return (
              <section key={scope}>
                <h3 className="mb-2 text-sm font-medium text-muted-foreground">{t(SCOPE_TITLE[scope])}</h3>
                <div className="space-y-2">
                  {[...byPackage].map(([origin, skills]) => (
                    <Collapsible key={origin} open={expanded.has(origin)} onOpenChange={() => toggleGroup(origin)} className="group/pkg rounded-xl border bg-card">
                      <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm">
                        <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]/pkg:rotate-90" />
                        <span className="min-w-0 flex-1 truncate font-medium">{origin}</span>
                        <span className="text-xs text-muted-foreground">{t('skills.nSkills', { n: skills.length })}</span>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="divide-y border-t">{skills.map((s) => <SkillRow key={s.file} skill={s} onOpen={() => setOpen(s.file)} />)}</CollapsibleContent>
                    </Collapsible>
                  ))}
                </div>
              </section>
            );
          }
          return (
            <section key={scope}>
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">{t(SCOPE_TITLE[scope])}{scope === 'project' && project ? ` · ${fname(project)}` : ''}</h3>
              <Panel>{list.map((s) => <SkillRow key={s.file} skill={s} onOpen={() => setOpen(s.file)} onToggle={(on) => void toggle(s, on)} onDelete={() => void remove(s)} />)}</Panel>
            </section>
          );
        })}
      </div>
      {!catalog.projectTrusted && catalog.project && (
        <p className="mt-4 text-xs text-muted-foreground">{t('skills.untrusted')}</p>
      )}
    </>
  );
}
