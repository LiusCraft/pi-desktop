import { useState } from 'react';
import {
  ArchiveIcon, BoxIcon, ChevronDownIcon, ClockIcon, CodeXmlIcon, FlameIcon, GitMergeIcon, GitPullRequestClosedIcon, GitPullRequestDraftIcon, GitPullRequestIcon, BrainIcon,
  ListChecksIcon, MonitorSmartphoneIcon, MoonIcon, MoreHorizontalIcon, PanelLeftIcon, PencilIcon, PlusIcon, SearchIcon, SettingsIcon, ShapesIcon, SunIcon,
  Trash2Icon, TriangleAlertIcon,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { call, isMac, modKey } from '@/lib/api';
import { ago, fname } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  archiveSession, deleteSession, openSession, removeProject, renameSession, selectProject, setView, showActivity, showArchived, showCustomize, showScheduled, showWelcome, toggleSidebar,
} from '@/store/actions';
import { setApp, useApp } from '@/store/app';
import type { SessionKind } from '@shared/protocol';
import type { SessionView } from '@/store/types';

export function SidebarToggle({ className }: { className?: string }) {
  const collapsed = useApp((s) => s.sidebarCollapsed);
  return (
    <button
      onClick={() => toggleSidebar()}
      title={`${collapsed ? 'Show' : 'Hide'} sidebar  ${modKey}B`}
      aria-expanded={!collapsed}
      className={cn('flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground', className)}
    >
      <PanelLeftIcon className="size-4" />
    </button>
  );
}

/** Session state, in priority order: needs you > working > unread > PR state > idle (empty circle). */
function StatusIcon({ s }: { s: SessionView }) {
  const icon = (() => {
    if (s.waiting) return <TriangleAlertIcon className="size-3.5 text-warning" />;
    if (s.running) return <span className="size-3 animate-spin rounded-full border-[1.5px] border-primary border-t-transparent" />;
    if (s.unread) return <span className="size-2 rounded-full bg-primary" />;
    if (s.pr) {
      if (s.pr.state === 'merged') return <GitMergeIcon className="size-3.5 text-[#8957e5]" />;
      if (s.pr.state === 'closed') return <GitPullRequestClosedIcon className="size-3.5 text-destructive" />;
      if (s.pr.draft) return <GitPullRequestDraftIcon className="size-3.5 text-muted-foreground" />;
      return <GitPullRequestIcon className="size-3.5 text-success" />;
    }
    return <span className="size-2.5 rounded-full border-[1.5px] border-muted-foreground/50" />;
  })();
  return <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>;
}

/** Sessions spun off from another one sit right under it; a session whose parent is gone is a root again. */
function nest(list: SessionView[]) {
  const ids = new Set(list.map((s) => s.meta.id));
  const out: { s: SessionView; child: boolean }[] = [];
  for (const s of list) {
    if (s.meta.parentId && ids.has(s.meta.parentId)) continue;
    out.push({ s, child: false });
    for (const c of list.filter((x) => x.meta.parentId === s.meta.id)) out.push({ s: c, child: true });
  }
  return out;
}

function SessionRow({ s, active, child }: { s: SessionView; active: boolean; child?: boolean }) {
  const prNote = s.pr ? ` · PR #${s.pr.num} ${s.pr.state === 'open' && s.pr.draft ? 'draft' : s.pr.state}` : '';
  const title = s.waiting ? 'Waiting for your approval' : s.running ? 'Working…' : `${s.meta.title} · ${ago(s.meta.updatedAt || Date.now(), true)}${prNote}`;
  return (
    <div className={cn('group flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm', child && 'ml-4', active ? 'bg-sidebar-accent text-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent/70')}>
      <button className="flex min-w-0 flex-1 items-center gap-2 text-left" title={title} onClick={() => void openSession(s.meta.id)}>
        <StatusIcon s={s} />
        <span className={cn('truncate', s.unread && 'font-semibold')}>{s.meta.title}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="hidden shrink-0 text-muted-foreground group-hover:block hover:text-foreground data-[state=open]:block" title="More" aria-label="Session actions">
            <MoreHorizontalIcon className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuItem onSelect={() => void renameSession(s.meta.id)}><PencilIcon />Rename</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void archiveSession(s.meta.id)}><ArchiveIcon />Archive</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => void deleteSession(s.meta.id)}><Trash2Icon />Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function NavItem({ icon, children, onClick, hint, soon, active }: { icon: React.ReactNode; children: React.ReactNode; onClick?: () => void; hint?: string; soon?: boolean; active?: boolean }) {
  return (
    <button
      onClick={soon ? undefined : onClick}
      aria-disabled={soon || undefined}
      aria-current={active ? 'page' : undefined}
      title={hint}
      className={cn('flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm', soon ? 'cursor-default text-muted-foreground' : active ? 'bg-sidebar-accent text-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent')}
    >
      <span className="flex size-4 items-center justify-center text-muted-foreground">{icon}</span>
      {children}
    </button>
  );
}

/** Which full-page view (if any) replaces the conversation. */
const usePage = () => useApp((s) => (s.scheduled ? 'scheduled' : s.customize ? 'customize' : s.archived ? 'archived' : s.activity ? 'activity' : null));

function CodeNav() {
  const page = usePage();
  const projects = useApp((s) => s.projects);
  const sessions = useApp((s) => s.sessions);
  const current = useApp((s) => s.current);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const groups = new Map<string, SessionView[]>();
  for (const p of projects) groups.set(p.path, []);
  for (const s of Object.values(sessions).filter((x) => !x.meta.archived && x.meta.kind === 'code').sort((a, b) => (b.meta.updatedAt || 0) - (a.meta.updatedAt || 0))) {
    if (!groups.has(s.meta.projectPath)) groups.set(s.meta.projectPath, []);
    groups.get(s.meta.projectPath)!.push(s);
  }
  return (
    <>
      <nav className="space-y-0.5 px-2">
        <NavItem icon={<PlusIcon className="size-4" />} onClick={showWelcome}>New</NavItem>
        <NavItem icon={<ClockIcon className="size-4" />} active={page === 'scheduled'} onClick={showScheduled} hint="Scheduled：按计划自动运行的任务">Scheduled</NavItem>
        <NavItem icon={<ShapesIcon className="size-4" />} active={page === 'customize'} onClick={showCustomize} hint="Customize：技能、连接器与插件">Customize</NavItem>
        <NavItem icon={<ArchiveIcon className="size-4" />} active={page === 'archived'} onClick={showArchived} hint="已归档的会话">Archived</NavItem>
      </nav>
      <div className="mt-4 space-y-4 px-2">
        {[...groups].map(([path, list]) => {
          const LIMIT = 5;
          const rows = nest(list);
          const collapsed = rows.length > LIMIT && !expanded.has(path) && !rows.slice(LIMIT).some((r) => r.s.meta.id === current);
          return (
            <div key={path}>
              <div className="group flex h-7 items-center gap-0.5 px-2.5 text-xs font-medium text-muted-foreground" title={path}>
                <span className="flex-1 truncate">{fname(path)}</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="hidden rounded p-0.5 group-hover:block hover:bg-sidebar-accent hover:text-foreground data-[state=open]:block" title="Project actions" aria-label="Project actions">
                      <MoreHorizontalIcon className="size-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    <DropdownMenuItem onSelect={() => void call('app:revealPath', path).catch(() => {})}>{isMac ? 'Reveal in Finder' : 'Show in File Explorer'}</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => void removeProject(path)}>Remove from Pi Desktop</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <button className="hidden rounded p-0.5 group-hover:block hover:bg-sidebar-accent hover:text-foreground" title={`New session in ${fname(path)}`} onClick={() => { selectProject(path); showWelcome(); }}>
                  <PlusIcon className="size-3.5" />
                </button>
              </div>
              {(collapsed ? rows.slice(0, LIMIT) : rows).map(({ s, child }) => <SessionRow key={s.meta.id} s={s} child={child} active={!page && s.meta.id === current} />)}
              {collapsed && (
                <button className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => setExpanded((e) => new Set(e).add(path))}>Show more</button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function WorkNav() {
  const page = usePage();
  const sessions = useApp((s) => s.sessions);
  const current = useApp((s) => s.current);
  const tasks = Object.values(sessions).filter((s) => s.meta.kind === 'work' && !s.meta.archived).sort((a, b) => (b.meta.updatedAt || 0) - (a.meta.updatedAt || 0));
  return (
    <>
      <nav className="space-y-0.5 px-2">
        <NavItem icon={<PlusIcon className="size-4" />} onClick={showWelcome}>New</NavItem>
        <NavItem icon={<BoxIcon className="size-4" />} soon hint="Projects 即将推出">Projects</NavItem>
        <NavItem icon={<ShapesIcon className="size-4" />} soon hint="Artifacts 即将推出">Artifacts</NavItem>
        <NavItem icon={<ClockIcon className="size-4" />} active={page === 'scheduled'} onClick={showScheduled} hint="Scheduled：按计划自动运行的任务">Scheduled</NavItem>
        <NavItem icon={<ShapesIcon className="size-4" />} active={page === 'customize'} onClick={showCustomize} hint="Customize：技能、连接器与插件">Customize</NavItem>
        <NavItem icon={<ArchiveIcon className="size-4" />} active={page === 'archived'} onClick={showArchived} hint="已归档的会话">Archived</NavItem>
      </nav>
      <div className="mt-4 flex h-7 items-center px-4 text-xs font-medium text-muted-foreground">
        <span className="flex-1">Tasks</span>
        <button className="rounded p-0.5 hover:bg-sidebar-accent hover:text-foreground" title="Search" onClick={() => setApp((s) => void (s.paletteOpen = true))}>
          <SearchIcon className="size-3.5" />
        </button>
      </div>
      <div className="px-2">
        {tasks.length ? nest(tasks).map(({ s, child }) => <SessionRow key={s.meta.id} s={s} child={child} active={!page && s.meta.id === current} />) : (
          <div className="px-2.5 py-2 text-sm text-muted-foreground">No tasks yet</div>
        )}
      </div>
    </>
  );
}

function UserMenu() {
  const info = useApp((s) => s.info);
  const theme = useApp((s) => s.settings.resolvedTheme);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-sm hover:bg-sidebar-accent">
        <span className="spark shrink-0" />
        <span className="truncate font-medium">Pi Desktop</span>
        {info?.demo && <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">DEMO</span>}
        <ChevronDownIcon className="ml-auto size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-60">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">pi coding agent{info ? ` · v${info.version}` : ''}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => call('settings:set', { theme: theme === 'dark' ? 'light' : 'dark' })}>
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}切换深色 / 浅色
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={showActivity}><FlameIcon />活动</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => call('settings:open', 'models')}><BrainIcon />模型管理…</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => call('settings:open', 'remote')}><MonitorSmartphoneIcon />远程…</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => call('settings:open')}><SettingsIcon />设置<span className="ml-auto text-xs text-muted-foreground">{modKey},</span></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const LINK_LABEL = { connecting: '连接中…', connected: '已连接', reconnecting: '连接断开，正在重连…' } as const;

/** Shown while the app drives another machine's sessions: whose they are, whether the link is up, and the way back. */
function RemoteBar() {
  const remote = useApp((s) => s.remote);
  if (!remote) return null;
  const up = remote.state === 'connected';
  return (
    <div className="mx-2 mb-2 flex items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/60 px-2.5 py-2 text-xs">
      <MonitorSmartphoneIcon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium" title={remote.host}>{remote.name}</div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <span className={cn('size-1.5 rounded-full', up ? 'bg-success' : 'animate-pulse bg-warning')} />
          {LINK_LABEL[remote.state]}
        </div>
      </div>
      <button className="shrink-0 rounded-md px-2 py-1 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground" onClick={() => void call('remote:disconnect')}>断开</button>
    </div>
  );
}

export function Sidebar() {
  const view = useApp((s) => s.view);
  return (
    <aside className="flex h-full flex-col bg-sidebar">
      <div className={cn('app-drag flex h-11 shrink-0 items-center gap-1 px-2', isMac && 'pl-[84px]')}>
        <SidebarToggle />
        <button className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground" title={`Search  ${modKey}K`} onClick={() => setApp((s) => void (s.paletteOpen = true))}>
          <SearchIcon className="size-4" />
        </button>
      </div>
      <Tabs value={view} onValueChange={(v) => setView(v as SessionKind)} className="mx-3 mb-3">
        <TabsList className="relative grid h-8 w-full grid-cols-2 bg-sidebar-accent p-0.5">
          {/* The highlight slides between the two halves. */}
          <span
            aria-hidden
            className={cn('pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-md bg-background shadow-sm transition-transform duration-200 ease-out', view === 'code' && 'translate-x-full')}
          />
          {(['work', 'code'] as const).map((v) => (
            <TabsTrigger key={v} value={v} className="relative z-10 h-full data-[state=active]:bg-transparent data-[state=active]:shadow-none hover:bg-background/40 data-[state=active]:hover:bg-transparent">
              {v === 'work' ? <ListChecksIcon className="size-3.5" /> : <CodeXmlIcon className="size-3.5" />}
              {v === 'work' ? 'Work' : 'Code'}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {/* Re-keyed so the list fades in when the tab changes. */}
      <div key={view} className="min-h-0 flex-1 animate-in overflow-y-auto pb-3 duration-200 fade-in-0">{view === 'work' ? <WorkNav /> : <CodeNav />}</div>
      <RemoteBar />
      <div className="flex items-center gap-1 border-t border-sidebar-border p-2">
        <UserMenu />
        {view === 'code' && (
          <button className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent" title={`Search  ${modKey}K`} onClick={() => setApp((s) => void (s.paletteOpen = true))}>
            <SearchIcon className="size-4" />
          </button>
        )}
      </div>
    </aside>
  );
}

