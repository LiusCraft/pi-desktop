// Customize → Skills: the pi skills that load for the selected project. Personal and project
// skills can be switched off (kept on disk, not loaded) or created here; skills that come
// with a plugin are read-only because the plugin owns them.
import { useEffect, useState } from 'react';
import { ChevronRightIcon, FolderOpenIcon, PlusIcon, SparklesIcon } from 'lucide-react';
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
import { call, errText } from '@/lib/api';
import { fname } from '@/lib/format';
import { BackButton, Empty, Field, Heading, Panel, Segmented, stripFrontmatter } from './ui';

interface Props {
  catalog: CustomizeCatalog;
  project: string | null;
  onCatalog: (c: CustomizeCatalog) => void;
}

const SCOPE_TITLE: Record<CustomizeScope, string> = { user: '个人技能', project: '项目技能', package: '来自插件' };

function SkillRow({ skill, onOpen, onToggle }: { skill: SkillInfo; onOpen: () => void; onToggle?: (on: boolean) => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <button className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={onOpen}>
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40"><SparklesIcon className="size-4 text-muted-foreground" /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-sm font-medium">{skill.name}</span>
            {skill.manualOnly && <Badge variant="secondary" title="只能用 /skill:名称 手动调用，模型不会自己选它">仅手动</Badge>}
          </span>
          <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{skill.description || '（没有描述）'}</span>
        </span>
      </button>
      {onToggle && <Switch checked={!skill.disabled} onCheckedChange={onToggle} aria-label={`${skill.disabled ? '启用' : '停用'} ${skill.name}`} />}
    </div>
  );
}

function SkillDetail({ skill, onBack }: { skill: SkillInfo; onBack: () => void }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(null);
    void call('customize:readFile', skill.file).then(setText).catch((e) => setText(`无法读取：${errText(e)}`));
  }, [skill.file]);
  return (
    <>
      <BackButton onClick={onBack}>返回技能列表</BackButton>
      <Heading
        title={skill.name}
        sub={skill.description || '（没有描述）'}
        action={
          <Button size="sm" variant="outline" onClick={() => call('app:revealPath', skill.file, true).catch((e) => toast.error(errText(e)))}>
            <FolderOpenIcon className="size-4" />显示文件
          </Button>
        }
      />
      <div className="mb-3 truncate font-mono text-xs text-muted-foreground" title={skill.file}>{skill.file}</div>
      <div className="rounded-xl border bg-card p-5">
        {text === null ? <span className="text-sm text-muted-foreground">加载中…</span> : <Markdown text={stripFrontmatter(text)} className="text-sm" />}
      </div>
    </>
  );
}

function SkillForm({ project, onDone, onCatalog }: Omit<Props, 'catalog'> & { onDone: () => void }) {
  const [draft, setDraft] = useState<SkillDraft>({ name: '', description: '', body: '', scope: 'user', home: 'pi' });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<SkillDraft>) => setDraft({ ...draft, ...patch });
  const save = async () => {
    setBusy(true);
    try {
      onCatalog(await call('customize:skillCreate', draft, project));
      toast.success('技能已创建，新建的会话会用上它');
      onDone();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <BackButton onClick={onDone}>返回技能列表</BackButton>
      <Heading title="新建技能" sub="技能是一份写给模型看的说明书：描述决定它什么时候被用到，正文告诉它怎么做。" />
      <div className="space-y-4 rounded-xl border bg-card p-4">
        <Field label="保存位置" hint={draft.scope === 'user' ? '所有项目都能用。' : `只在 ${project ? fname(project) : '当前项目'} 里生效。`}>
          <Segmented value={draft.scope} onChange={(scope) => set({ scope })} options={[{ id: 'user', label: '个人' }, { id: 'project', label: '项目', disabled: !project }]} />
        </Field>
        <Field label="存放在" hint={draft.home === 'agents' ? `保存在 ${draft.scope === 'user' ? '~' : ''}/.agents/skills，Codex、opencode 等工具也会读取。` : `只给 pi 用，保存在 ${draft.scope === 'user' ? 'pi 的 skills 文件夹' : '项目的 .pi/skills'}。`}>
          <Segmented value={draft.home ?? 'pi'} onChange={(home) => set({ home })} options={[{ id: 'pi', label: 'pi' }, { id: 'agents', label: '.agents（通用）' }]} />
        </Field>
        <Field label="名称" hint="字母、数字、- 和 _；用 /skill:名称 手动调用。">
          <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="release-notes" spellCheck={false} />
        </Field>
        <Field label="描述" hint="一句话说明什么情况下该用它，会展示给模型。">
          <Input value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="Write release notes from merged PRs. Use when asked to prepare a release." />
        </Field>
        <Field label="内容（Markdown）">
          <Textarea value={draft.body} onChange={(e) => set({ body: e.target.value })} rows={12} className="min-h-56 font-mono text-xs" placeholder={'# Release notes\n\n1. List merged PRs since the last tag…'} />
        </Field>
        <div className="flex gap-2">
          <Button onClick={() => void save()} disabled={busy}>创建</Button>
          <Button variant="ghost" onClick={onDone}>取消</Button>
        </div>
      </div>
    </>
  );
}

export function SkillsSection({ catalog, project, onCatalog }: Props) {
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
      if (action === 'customize:claudeImport') toast.success('已引入 Claude Code 的技能，新建的会话会用上它们');
    } catch (err) {
      toast.error(errText(err));
    }
  };
  const reveal = (dir: string) => call('app:revealPath', dir).catch((e) => toast.error(errText(e)));
  const scopes: CustomizeScope[] = ['user', 'project', 'package'];
  return (
    <>
      <Heading
        title="Skills"
        sub="教模型按你的方式做事的说明书。停用的技能留在磁盘上，只是不再加载。"
        action={
          <div className="flex shrink-0 gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="sm" variant="outline"><FolderOpenIcon className="size-4" />打开文件夹</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void reveal(catalog.dirs.skills)}>pi 的 skills</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void reveal(catalog.dirs.agentsSkills)}>~/.agents/skills（通用）</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" onClick={() => setCreating(true)}><PlusIcon className="size-4" />新建技能</Button>
          </div>
        }
      />
      {catalog.claudeSkills && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border bg-muted/30 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">发现 {catalog.claudeSkills.count} 个 Claude Code 的技能，要引入吗？</div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground" title={catalog.claudeSkills.dir}>引入后直接读取 {catalog.claudeSkills.dir}，不会复制；在这里随时可以逐个停用。</div>
          </div>
          <Button size="sm" onClick={() => void claude('customize:claudeImport')}>引入</Button>
          <Button size="sm" variant="ghost" onClick={() => void claude('customize:claudeDismiss')}>不用了</Button>
        </div>
      )}
      {!catalog.skills.length && <Panel><Empty>还没有技能。点「新建技能」写一个，或在 Plugins 里装带技能的包。</Empty></Panel>}
      <div className="space-y-6">
        {scopes.map((scope) => {
          const list = catalog.skills.filter((s) => s.scope === scope);
          if (!list.length) return null;
          if (scope === 'package') {
            const byPackage = Map.groupBy(list, (s) => s.origin);
            return (
              <section key={scope}>
                <h3 className="mb-2 text-sm font-medium text-muted-foreground">{SCOPE_TITLE[scope]}</h3>
                <div className="space-y-2">
                  {[...byPackage].map(([origin, skills]) => (
                    <Collapsible key={origin} open={expanded.has(origin)} onOpenChange={() => toggleGroup(origin)} className="group/pkg rounded-xl border bg-card">
                      <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm">
                        <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]/pkg:rotate-90" />
                        <span className="min-w-0 flex-1 truncate font-medium">{origin}</span>
                        <span className="text-xs text-muted-foreground">{skills.length} 个技能</span>
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
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">{SCOPE_TITLE[scope]}{scope === 'project' && project ? ` · ${fname(project)}` : ''}</h3>
              <Panel>{list.map((s) => <SkillRow key={s.file} skill={s} onOpen={() => setOpen(s.file)} onToggle={(on) => void toggle(s, on)} />)}</Panel>
            </section>
          );
        })}
      </div>
      {!catalog.projectTrusted && catalog.project && (
        <p className="mt-4 text-xs text-muted-foreground">这个项目还没有被信任，它自己的技能和连接器要等第一次在项目里开会话并确认信任后才会加载。</p>
      )}
    </>
  );
}
