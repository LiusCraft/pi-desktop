// The Work Projects page: each Work folder as a project that carries standing context (description,
// instructions, links, memory), and the tasks and scheduled runs that belong to it. The agent reads the
// context at the start of every turn of a session in the folder (see src/agent/work-project.ts).
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BoxIcon,
  BrainIcon,
  ClockIcon,
  CodeIcon,
  FolderOpenIcon,
  LinkIcon,
  PlusIcon,
  ScrollTextIcon,
  Trash2Icon,
} from 'lucide-react';
import { toast } from 'sonner';
import { PROJECT_LIMITS, type ProjectLink, type WorkProject } from '@shared/protocol';
import { describeSchedule } from '@shared/schedule';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { BackButton, Empty, Heading, Panel } from '@/customize/ui';
import { call, isMac, isRemote } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { ago, fname } from '@/lib/format';
import {
  addWorkFolder,
  newProjectTask,
  openSession,
  showProjects,
  showScheduled,
  updateWorkProject,
} from '@/store/actions';
import { setApp, useApp } from '@/store/app';

/** Work sessions and scheduled tasks that run in one folder. */
function useProjectActivity(path: string) {
  const sessions = useApp((s) => s.sessions);
  const tasks = useApp((s) => s.tasks);
  return useMemo(
    () => ({
      sessions: Object.values(sessions)
        .filter((x) => x.meta.kind === 'work' && !x.meta.archived && x.meta.projectPath === path)
        .sort((a, b) => (b.meta.updatedAt || 0) - (a.meta.updatedAt || 0)),
      tasks: tasks.filter((t) => t.kind === 'work' && t.projectPath === path),
    }),
    [sessions, tasks, path],
  );
}

function ProjectCard({ p }: { p: WorkProject }) {
  const t = useT();
  const { sessions, tasks } = useProjectActivity(p.path);
  const facts = [
    p.instructions?.trim() && t('projects.hasInstructions'),
    p.memory?.trim() && t('projects.hasMemory'),
    p.links?.length && t('projects.nLinks', { n: p.links.length }),
  ].filter(Boolean);
  return (
    <button
      className="flex flex-col gap-2 rounded-xl border bg-card px-4 py-3.5 text-left transition-shadow hover:shadow-md"
      onClick={() => showProjects(p.path)}
    >
      <div className="flex items-center gap-2">
        <BoxIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={p.name}>
          {p.name}
        </span>
      </div>
      <p className="line-clamp-2 min-h-8 text-xs text-muted-foreground">
        {p.description?.trim() || t('projects.noDescription')}
      </p>
      <code className="truncate font-mono text-[11px] text-muted-foreground/80" title={p.path}>
        {p.path}
      </code>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{t('projects.nTasks', { n: sessions.length })}</span>
        {tasks.length > 0 && <span>{t('projects.nScheduled', { n: tasks.length })}</span>}
        {facts.map((f) => (
          <span key={String(f)}>{f}</span>
        ))}
      </div>
    </button>
  );
}

function ProjectList({ folders }: { folders: WorkProject[] }) {
  const t = useT();
  return (
    <>
      <Heading
        title={t('projects.title')}
        sub={t('projects.sub')}
        action={
          <Button size="sm" onClick={() => void addWorkFolder()}>
            <PlusIcon className="size-4" />
            {t('projects.add')}
          </Button>
        }
      />
      {folders.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {folders.map((p) => (
            <ProjectCard key={p.path} p={p} />
          ))}
        </div>
      ) : (
        <Panel>
          <Empty>{t('projects.empty')}</Empty>
        </Panel>
      )}
    </>
  );
}

const SECTION = 'space-y-3';
const SectionTitle = ({ icon, children, sub }: { icon: React.ReactNode; children: React.ReactNode; sub: string }) => (
  <div>
    <h3 className="flex items-center gap-2 text-sm font-medium">
      <span className="text-muted-foreground">{icon}</span>
      {children}
    </h3>
    <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
  </div>
);

function LinksEditor({ p }: { p: WorkProject }) {
  const t = useT();
  const links = p.links ?? [];
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const save = (next: ProjectLink[]) => updateWorkProject(p.path, { links: next });
  const add = async () => {
    const link = { title: title.trim(), url: url.trim() };
    if (!/^https?:\/\//i.test(link.url)) return void toast.warning(t('projects.linkScheme'));
    if (links.length >= PROJECT_LIMITS.links)
      return void toast.warning(t('projects.linkLimit', { n: PROJECT_LIMITS.links }));
    await save([...links, link]);
    setTitle('');
    setUrl('');
  };
  return (
    <div className={SECTION}>
      <SectionTitle icon={<LinkIcon className="size-4" />} sub={t('projects.links.sub')}>
        {t('projects.links')}
      </SectionTitle>
      {links.length > 0 && (
        <Panel>
          {links.map((l, i) => (
            <div key={`${l.url}-${i}`} className="flex items-center gap-2 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate">{l.title || l.url}</div>
                {l.title && <div className="truncate font-mono text-xs text-muted-foreground">{l.url}</div>}
              </div>
              <Button size="sm" variant="ghost" onClick={() => void call('app:openExternal', l.url)}>
                {t('projects.open')}
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive"
                title={t('projects.remove')}
                onClick={() => void save(links.filter((_, j) => j !== i))}
              >
                <Trash2Icon className="size-4" />
              </Button>
            </div>
          ))}
        </Panel>
      )}
      <div className="flex gap-2">
        <Input
          className="w-40"
          placeholder={t('projects.linkNamePh')}
          value={title}
          maxLength={PROJECT_LIMITS.name}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Input
          className="flex-1"
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
        <Button variant="outline" disabled={!url.trim()} onClick={() => void add()}>
          {t('projects.addLink')}
        </Button>
      </div>
    </div>
  );
}

function CodeFoldersEditor({ p }: { p: WorkProject }) {
  const t = useT();
  const codeProjects = useApp((s) => s.projects);
  const linked = p.codeFolders ?? [];
  const available = codeProjects.filter((c) => !linked.includes(c.path));
  const save = (next: string[]) => updateWorkProject(p.path, { codeFolders: next });
  return (
    <div className={SECTION}>
      <SectionTitle icon={<CodeIcon className="size-4" />} sub={t('projects.codeFolders.sub')}>
        {t('projects.codeFolders')}
      </SectionTitle>
      {linked.length > 0 && (
        <Panel>
          {linked.map((dir) => (
            <div key={dir} className="flex items-center gap-2 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate">{fname(dir)}</div>
                <div className="truncate font-mono text-xs text-muted-foreground" title={dir}>
                  {dir}
                </div>
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive"
                title={t('projects.remove')}
                onClick={() => void save(linked.filter((d) => d !== dir))}
              >
                <Trash2Icon className="size-4" />
              </Button>
            </div>
          ))}
        </Panel>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={!available.length || linked.length >= PROJECT_LIMITS.codeFolders}
          >
            <PlusIcon className="size-4" />
            {t('projects.addCodeFolder')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {available.map((c) => (
            <DropdownMenuItem key={c.path} onSelect={() => void save([...linked, c.path])}>
              <span className="truncate">{c.name}</span>
              <span className="truncate font-mono text-xs text-muted-foreground">{c.path}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {!codeProjects.length && <p className="text-xs text-muted-foreground">{t('projects.noCodeProjects')}</p>}
    </div>
  );
}

function ProjectDetail({ p }: { p: WorkProject }) {
  const t = useT();
  const { sessions, tasks } = useProjectActivity(p.path);
  const [draft, setDraft] = useState({
    name: p.name,
    description: p.description ?? '',
    instructions: p.instructions ?? '',
    memory: p.memory ?? '',
  });
  // The model writes to memory while the page is open: take its notes in, unless the user has edited the text.
  const savedMemory = useRef(p.memory ?? '');
  useEffect(() => {
    const before = savedMemory.current;
    savedMemory.current = p.memory ?? '';
    setDraft((d) => (d.memory === before ? { ...d, memory: p.memory ?? '' } : d));
  }, [p.memory]);
  const dirty =
    draft.name !== p.name ||
    draft.description !== (p.description ?? '') ||
    draft.instructions !== (p.instructions ?? '') ||
    draft.memory !== (p.memory ?? '');
  const set = (key: keyof typeof draft) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [key]: e.target.value }));
  const remove = async () => {
    if (!window.confirm(t('projects.confirmRemove', { name: p.name }))) return;
    try {
      const folders = await call('work:removeFolder', p.path);
      setApp((st) => {
        st.workFolders = folders;
        if (st.prefs.workFolder === p.path) st.prefs.workFolder = folders[0]?.path ?? null;
      });
      showProjects(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <>
      <BackButton onClick={() => showProjects(null)}>{t('projects.all')}</BackButton>
      <div className="mb-6 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Input
            className="h-9 border-transparent bg-transparent px-1 text-xl font-semibold shadow-none hover:border-input focus-visible:border-input"
            value={draft.name}
            maxLength={PROJECT_LIMITS.name}
            aria-label={t('projects.nameLabel')}
            onChange={set('name')}
          />
          <div className="mt-1 flex items-center gap-1 px-1 text-xs text-muted-foreground">
            <code className="truncate font-mono" title={p.path}>
              {p.path}
            </code>
            {!isRemote && (
              <Button
                size="icon-xs"
                variant="ghost"
                title={t(isMac ? 'projects.revealMac' : 'projects.revealOther')}
                onClick={() => void call('app:revealPath', p.path).catch(() => {})}
              >
                <FolderOpenIcon className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
        <Button size="sm" onClick={() => newProjectTask(p.path)}>
          <PlusIcon className="size-4" />
          {t('projects.newTask')}
        </Button>
      </div>

      <div className="space-y-8">
        <div className={SECTION}>
          <SectionTitle icon={<BoxIcon className="size-4" />} sub={t('projects.description.sub')}>
            {t('projects.description')}
          </SectionTitle>
          <Textarea
            rows={2}
            value={draft.description}
            maxLength={PROJECT_LIMITS.description}
            placeholder={t('projects.descriptionPh')}
            onChange={set('description')}
          />
        </div>

        <div className={SECTION}>
          <SectionTitle icon={<ScrollTextIcon className="size-4" />} sub={t('projects.instructions.sub')}>
            {t('projects.instructions')}
          </SectionTitle>
          <Textarea
            rows={6}
            value={draft.instructions}
            maxLength={PROJECT_LIMITS.instructions}
            placeholder={t('projects.instructionsPh')}
            onChange={set('instructions')}
          />
        </div>

        <div className={SECTION}>
          <SectionTitle icon={<BrainIcon className="size-4" />} sub={t('projects.memory.sub')}>
            {t('projects.memory')}
          </SectionTitle>
          <Textarea
            rows={6}
            value={draft.memory}
            maxLength={PROJECT_LIMITS.memory}
            placeholder={t('projects.memoryPh')}
            onChange={set('memory')}
          />
        </div>

        <div className="flex items-center gap-2">
          <Button disabled={!dirty} onClick={() => void updateWorkProject(p.path, draft)}>
            {t('projects.save')}
          </Button>
          {dirty && (
            <Button
              variant="ghost"
              onClick={() =>
                setDraft({
                  name: p.name,
                  description: p.description ?? '',
                  instructions: p.instructions ?? '',
                  memory: p.memory ?? '',
                })
              }
            >
              {t('projects.discard')}
            </Button>
          )}
        </div>

        <LinksEditor p={p} />

        <CodeFoldersEditor p={p} />

        <div className={SECTION}>
          <SectionTitle icon={<ClockIcon className="size-4" />} sub={t('projects.scheduled.sub')}>
            {t('projects.scheduled')}
          </SectionTitle>
          <Panel>
            {tasks.length ? (
              tasks.map((task) => (
                <div key={task.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">{task.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {task.enabled ? describeSchedule(task.schedule) : t('projects.disabled')}
                  </span>
                </div>
              ))
            ) : (
              <Empty>{t('projects.noScheduled')}</Empty>
            )}
          </Panel>
          <Button size="sm" variant="outline" onClick={showScheduled}>
            {t('projects.goScheduled')}
          </Button>
        </div>

        <div className={SECTION}>
          <SectionTitle icon={<BoxIcon className="size-4" />} sub={t('projects.tasks.sub')}>
            {t('projects.tasks')}
          </SectionTitle>
          <Panel>
            {sessions.length ? (
              sessions.map((s) => (
                <button
                  key={s.meta.id}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-accent/50"
                  onClick={() => void openSession(s.meta.id)}
                >
                  <span className="min-w-0 flex-1 truncate">{s.meta.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {ago(s.meta.updatedAt || Date.now(), true)}
                  </span>
                </button>
              ))
            ) : (
              <Empty>{t('projects.noTasks')}</Empty>
            )}
          </Panel>
        </div>

        <div className="border-t pt-4">
          <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void remove()}>
            {t('projects.removeProject')}
          </Button>
        </div>
      </div>
    </>
  );
}

export function ProjectsPage() {
  const folders = useApp((s) => s.workFolders);
  const open = useApp((s) => s.openProject);
  const project = open ? folders.find((p) => p.path === open) : undefined;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl animate-in px-8 py-8 duration-200 fade-in-0 slide-in-from-bottom-1">
        {project ? <ProjectDetail key={project.path} p={project} /> : <ProjectList folders={folders} />}
      </div>
    </div>
  );
}
