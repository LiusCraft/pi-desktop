import { useState } from 'react';
import {
  ArchiveIcon, BoxIcon, ChevronDownIcon, ChevronRightIcon, ClockIcon, EllipsisIcon, CodeXmlIcon, FlameIcon, GitMergeIcon, GitPullRequestClosedIcon, GitPullRequestDraftIcon, GitPullRequestIcon, BrainIcon,
  ListChecksIcon, MonitorSmartphoneIcon, MoonIcon, MoreHorizontalIcon, PanelLeftIcon, PencilIcon, PinIcon, PinOffIcon, PlusIcon, SearchIcon, SettingsIcon, ShapesIcon, SunIcon,
  Trash2Icon, TriangleAlertIcon,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { call, isMac, modKey } from '@/lib/api';
import { ago, fname } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  archiveSession, deleteSession, openSession, removeProject, renameSession, selectProject, setView, showActivity, showArchived, showArtifacts, showCustomize, showProjects, showScheduled, showWelcome, toggleSidebar,
} from '@/store/actions';
import { setApp, useApp } from '@/store/app';
import type { MessageKey } from '@shared/i18n';
import type { SessionKind } from '@shared/protocol';
import type { SessionView } from '@/store/types';

export function SidebarToggle({ className }: { className?: string }) {
  const t = useT();
  const collapsed = useApp((s) => s.sidebarCollapsed);
  return (
    <button
      onClick={() => toggleSidebar()}
      title={`${t(collapsed ? 'sidebar.show' : 'sidebar.hide')}  ${modKey}B`}
      aria-expanded={!collapsed}
      className={cn('flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground', className)}
    >
      <PanelLeftIcon className="size-4" />
    </button>
  );
}

/** Session state, in priority order: needs you > working or compacting > unread > PR state > idle (empty circle). */
function StatusIcon({ s }: { s: SessionView }) {
  const icon = (() => {
    if (s.waiting) return <TriangleAlertIcon className="size-3.5 text-warning" />;
    if (s.running || s.compacting) return <span className="size-3 animate-spin rounded-full border-[1.5px] border-primary border-t-transparent" />;
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

/** One set of actions, rendered by both the "…" dropdown and the right-click menu. */
type MenuParts = { Item: typeof DropdownMenuItem | typeof ContextMenuItem; Separator: typeof DropdownMenuSeparator | typeof ContextMenuSeparator };
const DROPDOWN_PARTS: MenuParts = { Item: DropdownMenuItem, Separator: DropdownMenuSeparator };
const CONTEXT_PARTS: MenuParts = { Item: ContextMenuItem, Separator: ContextMenuSeparator };

function SessionActions({ id, parts: { Item, Separator } }: { id: string; parts: MenuParts }) {
  const t = useT();
  return (
    <>
      <Item onSelect={() => void renameSession(id)}><PencilIcon />{t('sidebar.rename')}</Item>
      <Item onSelect={() => void archiveSession(id)}><ArchiveIcon />{t('sidebar.archive')}</Item>
      <Separator />
      <Item variant="destructive" onSelect={() => void deleteSession(id)}><Trash2Icon />{t('sidebar.delete')}</Item>
    </>
  );
}

function ProjectActions({ path, parts: { Item, Separator } }: { path: string; parts: MenuParts }) {
  const t = useT();
  return (
    <>
      <Item onSelect={() => { selectProject(path); showWelcome(); }}><PlusIcon />{t('sidebar.newSession')}</Item>
      <Item onSelect={() => void call('app:revealPath', path).catch(() => {})}>{t(isMac ? 'sidebar.revealMac' : 'sidebar.revealOther')}</Item>
      <Separator />
      <Item variant="destructive" onSelect={() => void removeProject(path)}>{t('sidebar.removeProject')}</Item>
    </>
  );
}

const PR_STATE_KEY = { open: 'sidebar.prOpen', merged: 'sidebar.prMerged', closed: 'sidebar.prClosed' } as const;

function SessionRow({ s, active, child }: { s: SessionView; active: boolean; child?: boolean }) {
  const t = useT();
  const prNote = s.pr ? ` · PR #${s.pr.num} ${s.pr.state === 'open' && s.pr.draft ? t('sidebar.prDraft') : PR_STATE_KEY[s.pr.state as keyof typeof PR_STATE_KEY] ? t(PR_STATE_KEY[s.pr.state as keyof typeof PR_STATE_KEY]) : s.pr.state}` : '';
  const title = s.waiting ? t('sidebar.waiting') : s.compacting ? t('status.compacting') : s.running ? t('sidebar.working') : `${s.meta.title} · ${ago(s.meta.updatedAt || Date.now(), true)}${prNote}`;
  return (
    <ContextMenu>
    <ContextMenuTrigger asChild>
    <div className={cn('group flex h-7 items-center gap-2 rounded-lg px-2.5 text-sm', child && 'ml-4', active ? 'bg-sidebar-accent text-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent/70')}>
      <button className="flex min-w-0 flex-1 items-center gap-2 text-left" title={title} onClick={() => void openSession(s.meta.id)}>
        <StatusIcon s={s} />
        <span className={cn('truncate', s.unread && 'font-semibold')}>{s.meta.title}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="hidden shrink-0 text-muted-foreground group-hover:block hover:text-foreground data-[state=open]:block" title={t('sidebar.more')} aria-label={t('sidebar.sessionActions')}>
            <MoreHorizontalIcon className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <SessionActions id={s.meta.id} parts={DROPDOWN_PARTS} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    </ContextMenuTrigger>
    <ContextMenuContent className="w-44"><SessionActions id={s.meta.id} parts={CONTEXT_PARTS} /></ContextMenuContent>
    </ContextMenu>
  );
}

function NavItem({ icon, children, onClick, hint, active }: { icon: React.ReactNode; children: React.ReactNode; onClick?: () => void; hint?: string; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      title={hint}
      className={cn('flex h-7 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm', active ? 'bg-sidebar-accent text-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent')}
    >
      <span className="flex size-4 items-center justify-center text-muted-foreground">{icon}</span>
      {children}
    </button>
  );
}

type NavId = 'projects' | 'artifacts' | 'scheduled' | 'customize' | 'archived';

/** The configurable nav entries, in display order. "New" is not one of them: it is always on top. */
const NAV_ITEMS: { id: NavId; label: MessageKey; hint: MessageKey; icon: React.ReactNode; views: SessionKind[]; open: () => void }[] = [
  { id: 'projects', label: 'sidebar.projects', hint: 'sidebar.projectsHint', icon: <BoxIcon className="size-4" />, views: ['work'], open: () => showProjects() },
  { id: 'artifacts', label: 'sidebar.artifacts', hint: 'sidebar.artifactsHint', icon: <ShapesIcon className="size-4" />, views: ['work'], open: showArtifacts },
  { id: 'scheduled', label: 'sidebar.scheduled', hint: 'sidebar.scheduledHint', icon: <ClockIcon className="size-4" />, views: ['work', 'code'], open: showScheduled },
  { id: 'customize', label: 'sidebar.customize', hint: 'sidebar.customizeHint', icon: <ShapesIcon className="size-4" />, views: ['work', 'code'], open: showCustomize },
  { id: 'archived', label: 'sidebar.archived', hint: 'sidebar.archivedHint', icon: <ArchiveIcon className="size-4" />, views: ['work', 'code'], open: showArchived },
];

const NAV_PINNED_KEY = 'pi.sidebar.pinned';
const NAV_MORE_KEY = 'pi.sidebar.navMore';
const DEFAULT_PINNED: Record<SessionKind, NavId[]> = { work: ['projects', 'scheduled'], code: ['scheduled'] };

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}
function writeStored(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

/** Top nav: "New" plus the entries the user pinned; the rest sit behind "More" (which opens by itself when the current page is in it). */
function TopNav({ view }: { view: SessionKind }) {
  const t = useT();
  const page = usePage();
  const [pinned, setPinned] = useState<Record<SessionKind, NavId[]>>(() => ({ ...DEFAULT_PINNED, ...readStored<Partial<Record<SessionKind, NavId[]>>>(NAV_PINNED_KEY, {}) }));
  const [open, setOpen] = useState(() => readStored(NAV_MORE_KEY, false));
  const items = NAV_ITEMS.filter((i) => i.views.includes(view));
  const isPinned = (id: NavId) => pinned[view].includes(id);
  const togglePin = (id: NavId) => {
    const next = { ...pinned, [view]: isPinned(id) ? pinned[view].filter((x) => x !== id) : [...pinned[view], id] };
    setPinned(next);
    writeStored(NAV_PINNED_KEY, next);
  };
  const held = items.filter((i) => !isPinned(i.id));
  const holdsPage = held.some((i) => i.id === page);
  const shown = open || holdsPage;
  const row = (i: (typeof items)[number]) => (
    <ContextMenu key={i.id}>
      <ContextMenuTrigger asChild>
        <div>
          <NavItem icon={i.icon} active={page === i.id} onClick={i.open} hint={t(i.hint)}>{t(i.label)}</NavItem>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={() => togglePin(i.id)}>{isPinned(i.id) ? <><PinOffIcon />{t('sidebar.moveToMore')}</> : <><PinIcon />{t('sidebar.pin')}</>}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
  return (
    <nav className="space-y-0.5 px-2">
      <NavItem icon={<PlusIcon className="size-4" />} onClick={showWelcome}>{t('sidebar.new')}</NavItem>
      {items.filter((i) => isPinned(i.id)).map(row)}
      {held.length > 0 && (
        <Collapsible open={shown} onOpenChange={(v) => { setOpen(v); writeStored(NAV_MORE_KEY, v); }}>
          <CollapsibleTrigger
            title={t('sidebar.moreHint')}
            className="group/more flex h-7 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent"
          >
            <span className="flex size-4 items-center justify-center text-muted-foreground"><EllipsisIcon className="size-4" /></span>
            {t('sidebar.more')}
            <ChevronRightIcon className="ml-auto size-3.5 text-muted-foreground transition-transform group-data-[state=open]/more:rotate-90" />
          </CollapsibleTrigger>
          <CollapsibleContent className="mx-3.5 mt-0.5 space-y-0.5 border-l border-sidebar-border pl-2 overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
            {held.map(row)}
          </CollapsibleContent>
        </Collapsible>
      )}
    </nav>
  );
}

/** Which full-page view (if any) replaces the conversation. */
const usePage = () => useApp((s) => (s.scheduled ? 'scheduled' : s.customize ? 'customize' : s.archived ? 'archived' : s.activity ? 'activity' : s.artifacts ? 'artifacts' : s.workProjects ? 'projects' : null));

function CodeNav() {
  const t = useT();
  const page = usePage();
  const projects = useApp((s) => s.projects);
  const sessions = useApp((s) => s.sessions);
  const current = useApp((s) => s.current);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const toggleFolded = (path: string) => setFolded((f) => { const n = new Set(f); if (!n.delete(path)) n.add(path); return n; });
  const groups = new Map<string, SessionView[]>();
  for (const p of projects) groups.set(p.path, []);
  for (const s of Object.values(sessions).filter((x) => !x.meta.archived && x.meta.kind === 'code').sort((a, b) => (b.meta.updatedAt || 0) - (a.meta.updatedAt || 0))) {
    if (!groups.has(s.meta.projectPath)) groups.set(s.meta.projectPath, []);
    groups.get(s.meta.projectPath)!.push(s);
  }
  return (
    <>
      <TopNav view="code" />
      <div className="mt-3 space-y-1 px-2">
        {[...groups].map(([path, list]) => {
          const LIMIT = 5;
          const rows = nest(list);
          const isFolded = folded.has(path);
          const collapsed = rows.length > LIMIT && !expanded.has(path) && !rows.slice(LIMIT).some((r) => r.s.meta.id === current);
          return (
            <Collapsible key={path} open={!isFolded}>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div className="group flex h-7 items-center gap-0.5 px-2.5 text-xs font-medium text-muted-foreground" title={path}>
                    <button className="flex min-w-0 flex-1 items-center gap-1 text-left hover:text-foreground" aria-expanded={!isFolded} onClick={() => toggleFolded(path)}>
                      <ChevronDownIcon className={cn('size-3.5 shrink-0 transition-transform duration-200', isFolded && '-rotate-90')} />
                      <span className="truncate">{fname(path)}</span>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="hidden rounded p-0.5 group-hover:block hover:bg-sidebar-accent hover:text-foreground data-[state=open]:block" title={t('sidebar.projectActions')} aria-label={t('sidebar.projectActions')}>
                          <MoreHorizontalIcon className="size-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-56"><ProjectActions path={path} parts={DROPDOWN_PARTS} /></DropdownMenuContent>
                    </DropdownMenu>
                    <button className="hidden rounded p-0.5 group-hover:block hover:bg-sidebar-accent hover:text-foreground" title={t('sidebar.newSessionIn', { name: fname(path) })} onClick={() => { selectProject(path); showWelcome(); }}>
                      <PlusIcon className="size-3.5" />
                    </button>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-56"><ProjectActions path={path} parts={CONTEXT_PARTS} /></ContextMenuContent>
              </ContextMenu>
              <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
                {(collapsed ? rows.slice(0, LIMIT) : rows).map(({ s, child }) => <SessionRow key={s.meta.id} s={s} child={child} active={!page && s.meta.id === current} />)}
                {collapsed && (
                  <button className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => setExpanded((e) => new Set(e).add(path))}>{t('sidebar.showMore')}</button>
                )}
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
    </>
  );
}

function WorkNav() {
  const t = useT();
  const page = usePage();
  const sessions = useApp((s) => s.sessions);
  const current = useApp((s) => s.current);
  const tasks = Object.values(sessions).filter((s) => s.meta.kind === 'work' && !s.meta.archived).sort((a, b) => (b.meta.updatedAt || 0) - (a.meta.updatedAt || 0));
  return (
    <>
      <TopNav view="work" />
      <div className="mt-4 flex h-7 items-center px-4 text-xs font-medium text-muted-foreground">
        <span className="flex-1">{t('sidebar.tasks')}</span>
        <button className="rounded p-0.5 hover:bg-sidebar-accent hover:text-foreground" title={t('sidebar.search')} onClick={() => setApp((s) => void (s.paletteOpen = true))}>
          <SearchIcon className="size-3.5" />
        </button>
      </div>
      <div className="px-2">
        {tasks.length ? nest(tasks).map(({ s, child }) => <SessionRow key={s.meta.id} s={s} child={child} active={!page && s.meta.id === current} />) : (
          <div className="px-2.5 py-2 text-sm text-muted-foreground">{t('sidebar.noTasks')}</div>
        )}
      </div>
    </>
  );
}

function UserMenu() {
  const t = useT();
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
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}{t('sidebar.toggleTheme')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={showActivity}><FlameIcon />{t('sidebar.activity')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => call('settings:open', 'models')}><BrainIcon />{t('sidebar.models')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => call('settings:open', 'remote')}><MonitorSmartphoneIcon />{t('sidebar.remote')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => call('settings:open')}><SettingsIcon />{t('sidebar.settings')}<span className="ml-auto text-xs text-muted-foreground">{modKey},</span></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const LINK_LABEL = { connecting: 'sidebar.linkConnecting', connected: 'sidebar.linkConnected', reconnecting: 'sidebar.linkReconnecting' } as const;

/** Shown while the app drives another machine's sessions: whose they are, whether the link is up, and the way back. */
function RemoteBar() {
  const t = useT();
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
          {t(LINK_LABEL[remote.state])}
        </div>
      </div>
      <button className="shrink-0 rounded-md px-2 py-1 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground" onClick={() => void call('remote:disconnect')}>{t('sidebar.disconnect')}</button>
    </div>
  );
}

export function Sidebar() {
  const t = useT();
  const view = useApp((s) => s.view);
  return (
    <aside className="flex h-full flex-col bg-sidebar">
      <div className={cn('app-drag flex h-11 shrink-0 items-center gap-1 px-2', isMac && 'pl-[84px]')}>
        <SidebarToggle />
        <button className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground" title={`${t('sidebar.search')}  ${modKey}K`} onClick={() => setApp((s) => void (s.paletteOpen = true))}>
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
          <button className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent" title={`${t('sidebar.search')}  ${modKey}K`} onClick={() => setApp((s) => void (s.paletteOpen = true))}>
            <SearchIcon className="size-4" />
          </button>
        )}
      </div>
    </aside>
  );
}

