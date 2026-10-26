import { useState } from 'react';
import {
  ArchiveIcon, BoxIcon, ChevronDownIcon, ClockIcon, CodeXmlIcon, GitMergeIcon, GitPullRequestClosedIcon, GitPullRequestDraftIcon, GitPullRequestIcon, BrainIcon,
  ListChecksIcon, MoonIcon, MoreHorizontalIcon, PanelLeftIcon, PlusIcon, SearchIcon, SettingsIcon, ShapesIcon, SunIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { call, isMac, modKey } from '@/lib/api';
import { ago, fname } from '@/lib/format';
import { cn } from '@/lib/utils';
import { archiveSession, openSession, selectProject, setView, showCustomize, showScheduled, showWelcome, toggleSidebar } from '@/store/actions';
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

function SessionRow({ s, active, onArchive }: { s: SessionView; active: boolean; onArchive?: () => void }) {
  const prNote = s.pr ? ` · PR #${s.pr.num} ${s.pr.state === 'open' && s.pr.draft ? 'draft' : s.pr.state}` : '';
  const title = s.waiting ? 'Waiting for your approval' : s.running ? 'Working…' : `${s.meta.title} · ${ago(s.meta.updatedAt || Date.now(), true)}${prNote}`;
  return (
    <div className={cn('group flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm', active ? 'bg-sidebar-accent text-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent/70')}>
      <button className="flex min-w-0 flex-1 items-center gap-2 text-left" title={title} onClick={() => void openSession(s.meta.id)}>
        <StatusIcon s={s} />
        <span className={cn('truncate', s.unread && 'font-semibold')}>{s.meta.title}</span>
      </button>
      {onArchive && (
        <button className="hidden shrink-0 text-muted-foreground group-hover:block hover:text-foreground" title="Archive" onClick={onArchive}>
          <MoreHorizontalIcon className="size-4" />
        </button>
      )}
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
const usePage = () => useApp((s) => (s.scheduled ? 'scheduled' : s.customize ? 'customize' : null));

function CodeNav() {
  const page = usePage();
  const projects = useApp((s) => s.projects);
  const sessions = useApp((s) => s.sessions);
  const current = useApp((s) => s.current);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [more, setMore] = useState(false);
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
        <NavItem icon={<MoreHorizontalIcon className="size-4" />} onClick={() => setMore((m) => !m)}>More</NavItem>
        {more && (
          <div className="pl-7">
            {['Archived sessions', 'Usage', 'MCP servers'].map((x) => (
              <button key={x} title={`${x}：即将推出`} aria-disabled className="flex h-7 w-full cursor-default items-center rounded-lg px-2.5 text-sm text-muted-foreground">{x}</button>
            ))}
          </div>
        )}
      </nav>
      <div className="mt-4 space-y-4 px-2">
        {[...groups].map(([path, list]) => {
          const LIMIT = 5;
          const collapsed = list.length > LIMIT && !expanded.has(path) && !list.slice(LIMIT).some((s) => s.meta.id === current);
          return (
            <div key={path}>
              <div className="group flex h-7 items-center px-2.5 text-xs font-medium text-muted-foreground" title={path}>
                <span className="flex-1 truncate">{fname(path)}</span>
                <button className="hidden rounded p-0.5 group-hover:block hover:bg-sidebar-accent hover:text-foreground" title={`New session in ${fname(path)}`} onClick={() => { selectProject(path); showWelcome(); }}>
                  <PlusIcon className="size-3.5" />
                </button>
              </div>
              {(collapsed ? list.slice(0, LIMIT) : list).map((s) => <SessionRow key={s.meta.id} s={s} active={!page && s.meta.id === current} />)}
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
        <NavItem icon={<ArchiveIcon className="size-4" />} active={page === 'customize'} onClick={showCustomize} hint="Customize：技能、连接器与插件">Customize</NavItem>
      </nav>
      <div className="mt-4 flex h-7 items-center px-4 text-xs font-medium text-muted-foreground">
        <span className="flex-1">Tasks</span>
        <button className="rounded p-0.5 hover:bg-sidebar-accent hover:text-foreground" title="Search" onClick={() => setApp((s) => void (s.paletteOpen = true))}>
          <SearchIcon className="size-3.5" />
        </button>
      </div>
      <div className="px-2">
        {tasks.length ? tasks.map((s) => <SessionRow key={s.meta.id} s={s} active={!page && s.meta.id === current} onArchive={() => void archiveSession(s.meta.id, true)} />) : (
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
        <DropdownMenuItem onSelect={() => call('settings:open', 'models')}><BrainIcon />模型管理…</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => call('settings:open')}><SettingsIcon />设置<span className="ml-auto text-xs text-muted-foreground">{modKey},</span></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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

