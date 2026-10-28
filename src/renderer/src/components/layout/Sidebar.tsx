import { useState, useSyncExternalStore } from 'react';
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
import { call, isMac, isRemote, modKey } from '@/lib/api';
import { ago, fname } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  archiveSessions, collapseSidebarIfCompact, deleteSessions, openSession, pinSessions, removeProject, selectProject, setSessionTitle, setView, showActivity, showArchived, showArtifacts, showCustomize, showProjects, showScheduled, showWelcome, toggleSidebar,
} from '@/store/actions';
import { setApp, useApp } from '@/store/app';
import { InlineEdit } from '@/components/common/InlineEdit';
import type { MessageKey } from '@shared/i18n';
import { MAX_SESSION_TITLE, type SessionKind } from '@shared/protocol';
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

/** Manual order of sessions and folders, kept per machine. Ids the list has not seen yet stay on top, in their own (recency) order. */
const ORDER_KEY = 'pi.sidebar.order';
type Order = { sessions: string[]; folders: string[] };
let order: Order = { sessions: [], folders: [], ...readStored<Partial<Order>>(ORDER_KEY, {}) };
const orderListeners = new Set<() => void>();
const subscribeOrder = (fn: () => void) => { orderListeners.add(fn); return () => void orderListeners.delete(fn); };
const useOrder = () => useSyncExternalStore(subscribeOrder, () => order);

function arrange<T>(items: T[], idOf: (x: T) => string, saved: string[]): T[] {
  const at = (x: T) => saved.indexOf(idOf(x));
  const rank = (x: T) => (at(x) < 0 ? -1 : at(x));
  return items
    .map((x, i) => ({ x, i }))
    .sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i)
    .map((e) => e.x);
}

type DragKind = 'session' | 'folder';
type Edge = 'before' | 'after';
/** What is being dragged. `group` limits drops to siblings: the same folder and pin state, or the folder list. */
const PINNED_GROUP = 'pinned';
let dragging: { kind: DragKind; id: string; group: string } | null = null;

/** Moves `id` next to `target` among `ids` (the group as shown) and remembers the whole arrangement. */
function reorder(kind: 'sessions' | 'folders', ids: string[], id: string, target: string, edge: Edge) {
  if (id === target) return;
  const rest = ids.filter((x) => x !== id);
  rest.splice(rest.indexOf(target) + (edge === 'after' ? 1 : 0), 0, id);
  order = { ...order, [kind]: [...rest, ...order[kind].filter((x) => !rest.includes(x))] };
  writeStored(ORDER_KEY, order);
  orderListeners.forEach((fn) => fn());
}

/** Makes an element draggable within its group and a drop target for its siblings; `edge` is where the drop line shows. */
function useSortable(kind: DragKind, id: string, group: string, ids: string[], list: 'sessions' | 'folders', enabled = true) {
  const [edge, setEdge] = useState<Edge | null>(null);
  const sibling = () => dragging?.kind === kind && dragging.group === group && dragging.id !== id;
  const side = (e: React.DragEvent): Edge => { const r = e.currentTarget.getBoundingClientRect(); return e.clientY < r.top + r.height / 2 ? 'before' : 'after'; };
  const props = enabled ? {
    draggable: true,
    onDragStart: (e: React.DragEvent) => { dragging = { kind, id, group }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); e.stopPropagation(); },
    onDragEnd: (e: React.DragEvent) => {
      // A pinned session let go outside the pinned group (not cancelled with Esc, which reports 0,0) is unpinned.
      const box = document.querySelector('[data-pinned-group]')?.getBoundingClientRect();
      const outside = !box || e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom;
      if (dragging && kind === 'session' && group === PINNED_GROUP && outside && (e.clientX || e.clientY)) void pinSessions([id], false);
      dragging = null;
      setEdge(null);
    },
    onDragOver: (e: React.DragEvent) => { if (!sibling()) return; e.preventDefault(); e.stopPropagation(); setEdge(side(e)); },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEdge(null); },
    onDrop: (e: React.DragEvent) => {
      if (!sibling()) return;
      e.preventDefault(); e.stopPropagation();
      reorder(list, ids, dragging!.id, id, side(e));
      dragging = null; setEdge(null);
    },
  } : {};
  const line = edge && cn('relative after:pointer-events-none after:absolute after:inset-x-1 after:h-0.5 after:rounded after:bg-primary', edge === 'before' ? 'after:top-0' : 'after:bottom-0');
  return { props, line };
}

/** Rows picked with Ctrl/Cmd (toggle) or Shift (range from the last pick). */
let selected: ReadonlySet<string> = new Set();
let anchor: string | null = null;
const selectListeners = new Set<() => void>();
const subscribeSelection = (fn: () => void) => { selectListeners.add(fn); return () => void selectListeners.delete(fn); };
const useSelection = () => useSyncExternalStore(subscribeSelection, () => selected);
function select(next: Iterable<string>, from: string | null = anchor) {
  selected = new Set(next);
  anchor = from;
  selectListeners.forEach((fn) => fn());
}
/** Applies a modified click; returns false for a plain click, which opens the session instead. */
function pick(e: React.MouseEvent, id: string, visible: string[]) {
  if (e.shiftKey && anchor && visible.includes(anchor)) {
    const [a, b] = [visible.indexOf(anchor), visible.indexOf(id)].sort((x, y) => x - y);
    select(visible.slice(a, b + 1));
    return true;
  }
  if (e.ctrlKey || e.metaKey || e.shiftKey) {
    const next = new Set(selected);
    if (!next.delete(id)) next.add(id);
    select(next, id);
    return true;
  }
  if (selected.size) select([], null);
  return false;
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

function SessionActions({ id, pinned, parts: { Item, Separator }, onRename }: { id: string; pinned?: boolean; parts: MenuParts; onRename: () => void }) {
  const t = useT();
  const picked = useSelection();
  if (picked.has(id) && picked.size > 1) {
    const ids = [...picked];
    const done = (fn: (ids: string[]) => unknown) => () => { void fn(ids); select([]); };
    return (
      <>
        <Item onSelect={done((x) => pinSessions(x, true))}><PinIcon />{t('sidebar.pinSession')}</Item>
        <Item onSelect={done((x) => pinSessions(x, false))}><PinOffIcon />{t('sidebar.unpinSession')}</Item>
        <Item onSelect={done(archiveSessions)}><ArchiveIcon />{t('sidebar.archive')}</Item>
        <Separator />
        <Item variant="destructive" onSelect={done(deleteSessions)}><Trash2Icon />{t('sidebar.delete')}</Item>
      </>
    );
  }
  return (
    <>
      <Item onSelect={() => void pinSessions([id], !pinned)}>{pinned ? <><PinOffIcon />{t('sidebar.unpinSession')}</> : <><PinIcon />{t('sidebar.pinSession')}</>}</Item>
      <Item onSelect={onRename}><PencilIcon />{t('sidebar.rename')}</Item>
      <Item onSelect={() => void archiveSessions([id])}><ArchiveIcon />{t('sidebar.archive')}</Item>
      <Separator />
      <Item variant="destructive" onSelect={() => void deleteSessions([id])}><Trash2Icon />{t('sidebar.delete')}</Item>
    </>
  );
}

function ProjectActions({ path, parts: { Item, Separator } }: { path: string; parts: MenuParts }) {
  const t = useT();
  return (
    <>
      <Item onSelect={() => { selectProject(path); showWelcome(); collapseSidebarIfCompact(); }}><PlusIcon />{t('sidebar.newSession')}</Item>
      {!isRemote && <Item onSelect={() => void call('app:revealPath', path).catch(() => {})}>{t(isMac ? 'sidebar.revealMac' : 'sidebar.revealOther')}</Item>}
      <Separator />
      <Item variant="destructive" onSelect={() => void removeProject(path)}>{t('sidebar.removeProject')}</Item>
    </>
  );
}

const PR_STATE_KEY = { open: 'sidebar.prOpen', merged: 'sidebar.prMerged', closed: 'sidebar.prClosed' } as const;

function SessionRow({ s, active, child, ids, visible, tag }: { s: SessionView; active: boolean; child?: boolean; ids: string[]; visible: string[]; tag?: string }) {
  const t = useT();
  const sort = useSortable('session', s.meta.id, s.meta.pinned ? PINNED_GROUP : s.meta.projectPath, ids, 'sessions', !child);
  const [renaming, setRenaming] = useState(false);
  const picked = useSelection().has(s.meta.id);
  const prNote = s.pr ? ` · PR #${s.pr.num} ${s.pr.state === 'open' && s.pr.draft ? t('sidebar.prDraft') : PR_STATE_KEY[s.pr.state as keyof typeof PR_STATE_KEY] ? t(PR_STATE_KEY[s.pr.state as keyof typeof PR_STATE_KEY]) : s.pr.state}` : '';
  const title = s.waiting ? t('sidebar.waiting') : s.compacting ? t('status.compacting') : s.running ? t('sidebar.working') : `${s.meta.title} · ${ago(s.meta.updatedAt || Date.now(), true)}${prNote}`;
  return (
    <ContextMenu>
    <ContextMenuTrigger asChild>
    <div {...sort.props} className={cn('group flex h-7 items-center gap-2 rounded-lg px-2.5 text-sm', sort.line, child && 'ml-4', picked ? 'bg-primary/15 text-foreground' : active ? 'bg-sidebar-accent text-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent/70')}
      onContextMenu={() => { if (!picked) select([]); }}>
      {renaming ? (
        <InlineEdit
          value={s.meta.title}
          ariaLabel={t('sidebar.rename')}
          maxLength={MAX_SESSION_TITLE}
          className="flex-1"
          onCommit={(next) => { setRenaming(false); void setSessionTitle(s.meta.id, next); }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <>
          <button
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            title={title}
            onClick={(e) => { if (pick(e, s.meta.id, visible)) return; void openSession(s.meta.id); collapseSidebarIfCompact(); }}
            onDoubleClick={() => setRenaming(true)}
          >
            <StatusIcon s={s} />
            <span className={cn('truncate', s.unread && 'font-semibold')}>{s.meta.title}</span>
          </button>
          {tag && <span className="max-w-[35%] shrink-0 truncate rounded bg-muted px-1.5 text-[10px] leading-4 text-muted-foreground" title={s.meta.projectPath}>{tag}</span>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="hidden shrink-0 text-muted-foreground group-hover:block hover:text-foreground data-[state=open]:block" title={t('sidebar.more')} aria-label={t('sidebar.sessionActions')}>
                <MoreHorizontalIcon className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              <SessionActions id={s.meta.id} pinned={s.meta.pinned} parts={DROPDOWN_PARTS} onRename={() => setRenaming(true)} />
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </div>
    </ContextMenuTrigger>
    <ContextMenuContent className="w-44"><SessionActions id={s.meta.id} pinned={s.meta.pinned} parts={CONTEXT_PARTS} onRename={() => setRenaming(true)} /></ContextMenuContent>
    </ContextMenu>
  );
}

function NavItem({ icon, children, onClick, hint, active }: { icon: React.ReactNode; children: React.ReactNode; onClick?: () => void; hint?: string; active?: boolean }) {
  return (
    <button
      onClick={() => { onClick?.(); collapseSidebarIfCompact(); }}
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

function FolderHeader({ path, folded, ids, onToggle }: { path: string; folded: boolean; ids: string[]; onToggle: () => void }) {
  const t = useT();
  const sort = useSortable('folder', path, 'folders', ids, 'folders');
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div {...sort.props} className={cn('group flex h-7 items-center gap-0.5 px-2.5 text-xs font-medium text-muted-foreground', sort.line)} title={path}>
          <button className="flex min-w-0 flex-1 items-center gap-1 text-left hover:text-foreground" aria-expanded={!folded} onClick={onToggle}>
            <ChevronDownIcon className={cn('size-3.5 shrink-0 transition-transform duration-200', folded && '-rotate-90')} />
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
          <button className="hidden rounded p-0.5 group-hover:block hover:bg-sidebar-accent hover:text-foreground" title={t('sidebar.newSessionIn', { name: fname(path) })} onClick={() => { selectProject(path); showWelcome(); collapseSidebarIfCompact(); }}>
            <PlusIcon className="size-3.5" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56"><ProjectActions path={path} parts={CONTEXT_PARTS} /></ContextMenuContent>
    </ContextMenu>
  );
}

/** Pinned sessions from every folder, in one group above the folders. */
function PinnedGroup({ list, page, current, className }: { list: SessionView[]; page: string | null; current: string | null; className?: string }) {
  const t = useT();
  const saved = useOrder();
  const ordered = arrange(list, (x) => x.meta.id, saved.sessions);
  const rows = nest(ordered);
  const ids = ordered.map((x) => x.meta.id);
  const visible = rows.map((r) => r.s.meta.id);
  if (!list.length) return null;
  return (
    <div className={className} data-pinned-group>
      <div className="flex h-7 items-center gap-1 px-2.5 text-xs font-medium text-muted-foreground"><PinIcon className="size-3" />{t('sidebar.pinnedGroup')}</div>
      {rows.map(({ s, child }) => <SessionRow key={s.meta.id} s={s} child={child} ids={ids} visible={visible} tag={s.meta.kind === 'code' ? fname(s.meta.projectPath) : undefined} active={!page && s.meta.id === current} />)}
    </div>
  );
}

function CodeNav() {
  const t = useT();
  const page = usePage();
  const projects = useApp((s) => s.projects);
  const sessions = useApp((s) => s.sessions);
  const current = useApp((s) => s.current);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const toggleFolded = (path: string) => setFolded((f) => { const n = new Set(f); if (!n.delete(path)) n.add(path); return n; });
  const saved = useOrder();
  const found = new Map<string, SessionView[]>();
  for (const p of projects) found.set(p.path, []);
  const all = Object.values(sessions).filter((x) => !x.meta.archived && x.meta.kind === 'code').sort((a, b) => (b.meta.updatedAt || 0) - (a.meta.updatedAt || 0));
  for (const s of all.filter((x) => !x.meta.pinned)) {
    if (!found.has(s.meta.projectPath)) found.set(s.meta.projectPath, []);
    found.get(s.meta.projectPath)!.push(s);
  }
  const groups = arrange([...found], ([path]) => path, saved.folders);
  const folderIds = groups.map(([path]) => path);
  return (
    <>
      <TopNav view="code" />
      <PinnedGroup list={all.filter((x) => x.meta.pinned)} page={page} current={current} className="mt-3 px-2" />
      <div className="mt-3 space-y-1 px-2">
        {groups.map(([path, list]) => {
          const LIMIT = 5;
          const ordered = arrange(list, (x) => x.meta.id, saved.sessions);
          const rows = nest(ordered);
          const ids = ordered.map((x) => x.meta.id);
          const isFolded = folded.has(path);
          const collapsed = rows.length > LIMIT && !expanded.has(path) && !rows.slice(LIMIT).some((r) => r.s.meta.id === current);
          const shown = collapsed ? rows.slice(0, LIMIT) : rows;
          const visible = shown.map((r) => r.s.meta.id);
          return (
            <Collapsible key={path} open={!isFolded}>
              <FolderHeader path={path} folded={isFolded} ids={folderIds} onToggle={() => toggleFolded(path)} />
              <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
                {shown.map(({ s, child }) => <SessionRow key={s.meta.id} s={s} child={child} ids={ids} visible={visible} active={!page && s.meta.id === current} />)}
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
  const saved = useOrder();
  const all = Object.values(sessions).filter((s) => s.meta.kind === 'work' && !s.meta.archived).sort((a, b) => (b.meta.updatedAt || 0) - (a.meta.updatedAt || 0));
  const tasks = arrange(all.filter((x) => !x.meta.pinned), (x) => x.meta.id, saved.sessions);
  const ids = tasks.map((x) => x.meta.id);
  const rows = nest(tasks);
  return (
    <>
      <TopNav view="work" />
      <PinnedGroup list={all.filter((x) => x.meta.pinned)} page={page} current={current} className="mt-4 px-2" />
      <div className="mt-4 flex h-7 items-center px-4 text-xs font-medium text-muted-foreground">
        <span className="flex-1">{t('sidebar.tasks')}</span>
        <button className="rounded p-0.5 hover:bg-sidebar-accent hover:text-foreground" title={t('sidebar.search')} onClick={() => setApp((s) => void (s.paletteOpen = true))}>
          <SearchIcon className="size-3.5" />
        </button>
      </div>
      <div className="px-2">
        {tasks.length || all.some((x) => x.meta.pinned) ? rows.map(({ s, child }) => <SessionRow key={s.meta.id} s={s} child={child} ids={ids} visible={rows.map((r) => r.s.meta.id)} active={!page && s.meta.id === current} />) : (
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

