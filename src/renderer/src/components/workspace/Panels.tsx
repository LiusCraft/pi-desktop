import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode, type Ref } from 'react';
import {
  ArrowLeftIcon, BotIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, ChevronsDownUpIcon, ChevronsUpDownIcon, CodeIcon, ExternalLinkIcon, FileIcon, FolderIcon,
  AlignJustifyIcon, EyeIcon, ListIcon, ListTreeIcon, Maximize2Icon, MessageSquareIcon, Minimize2Icon, RefreshCwIcon, SearchIcon, SquareIcon, SquareTerminalIcon,
  Trash2Icon, XIcon,
} from 'lucide-react';
import { useDefaultLayout } from 'react-resizable-panels';
import { toast } from 'sonner';
import { findInText, SEARCH_MAX_MATCHES, type SearchResult } from '@shared/text-search';
import type { CommitInfo } from '@shared/protocol';
import { generatedKind, isGeneratedFile, type GeneratedKind } from '@shared/generated';
import { ReviewCodeView, type ReviewHandle, type ReviewItem } from '@/components/common/ReviewCodeView';
import type { FileTreeRowDecoration } from '@pierre/trees';
import { CopyGlyph, useCopy } from '@/components/common/Copy';
import { OpenInMenu } from '@/components/common/OpenInMenu';
import { HtmlPreview } from '@/components/common/HtmlPreview';
import { Markdown } from '@/components/common/Markdown';
import { SelectableContent } from '@/components/common/SelectableContent';
import { TodoList, PlanActions } from '@/components/thread/Items';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { call, isMac, isRemote } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { contentOf, onContent, wantContent } from '@/lib/change-content';
import { fileDiffOf } from '@/lib/file-diff';
import { modeName } from '@/lib/constants';
import { firstThread } from '@/lib/diff';
import { fdir, fmtDur, fmtTok, fname } from '@/lib/format';
import type { ToolState } from '@/lib/tools';
import { cn } from '@/lib/utils';
import {
  closeDetail, closeFiles, closeFileTab, diffTarget, fail, FIND_EVENT, findTarget, loadChanges, loadFiles, openAgent, openDiffRef, openFileRef, pinFileTab, setDiffBase, stopTask, togglePanel,
} from '@/store/actions';
import { modelName, setPref, updateSession, useApp } from '@/store/app';
import { findByKey, findTool } from '@/store/transcript';
import type { CardId, ChangedFile, DropPlace, Item, SessionView } from '@/store/types';
import { FileContextMenu } from './FileContextMenu';
import { FindBar, SearchResults, type FindScope } from './FindBar';
import { PathTree, type PathStatus } from './PathTree';

// ------------------------------------------------------------ card chrome

export interface CardProps {
  expanded: boolean;
  /** `wide`: cover the conversation as well (Ctrl+click, or triple-click on the header). */
  onExpand: (wide: boolean) => void;
  /** Drag the card by its header: set where the card can be dropped next to another one. */
  cardId?: CardId;
  onMove?: (dragged: CardId, place: DropPlace) => void;
}

/** dataTransfer type of a card being dragged by its header. */
const CARD_DRAG = 'application/x-pi-card';

/** Share of a card's width, at each side, that sends a dropped card to the left or right column. */
const SIDE_ZONE = 0.25;

export function Card({ title, tools, children, onClose, expanded, onExpand, bodyClass, cardId, onMove }: CardProps & {
  title: ReactNode;
  tools?: ReactNode;
  children: ReactNode;
  onClose?: () => void;
  bodyClass?: string;
}) {
  const t = useT();
  // Which edge of this card the dragged one would land on.
  const [drop, setDrop] = useState<DropPlace | null>(null);
  const movable = cardId && onMove;
  const edge = (e: React.DragEvent<HTMLElement>): DropPlace => {
    const rect = e.currentTarget.getBoundingClientRect();
    const side = rect.width * SIDE_ZONE;
    if (e.clientX < rect.left + side) return 'left';
    if (e.clientX > rect.right - side) return 'right';
    return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  };
  return (
    <section
      className={cn(
        'relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card',
        drop && 'after:pointer-events-none after:absolute after:bg-primary',
        (drop === 'before' || drop === 'after') && 'after:inset-x-0 after:h-1',
        (drop === 'left' || drop === 'right') && 'after:inset-y-0 after:w-1',
        drop === 'before' && 'after:top-0', drop === 'after' && 'after:bottom-0', drop === 'left' && 'after:left-0', drop === 'right' && 'after:right-0',
      )}
      onDragOver={movable ? (e) => {
        if (!e.dataTransfer.types.includes(CARD_DRAG)) return;
        e.preventDefault();
        setDrop(edge(e));
      } : undefined}
      onDragLeave={movable ? (e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null);
      } : undefined}
      onDrop={movable ? (e) => {
        const dragged = e.dataTransfer.getData(CARD_DRAG) as CardId;
        setDrop(null);
        if (!dragged) return;
        e.preventDefault();
        onMove(dragged, edge(e));
      } : undefined}
    >
      <header
        className={cn('flex h-10 shrink-0 items-center gap-1 border-b px-2', movable && 'cursor-grab active:cursor-grabbing')}
        draggable={movable ? true : undefined}
        onDragStart={movable ? (e) => {
          e.dataTransfer.setData(CARD_DRAG, cardId);
          e.dataTransfer.effectAllowed = 'move';
        } : undefined}
        onDragEnd={movable ? () => setDrop(null) : undefined}
        onClick={(e) => {
          // Double-click expands the card, triple-click takes the whole session; the header's own buttons are left alone.
          if (e.detail < 2 || (e.target as HTMLElement).closest('button, input, a')) return;
          onExpand(e.detail >= 3);
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1 text-sm font-medium">{title}</div>
        {tools}
        <IconBtn title={t(expanded ? 'panel.restore' : 'panel.expand')} onClick={(e) => onExpand(e.ctrlKey || e.metaKey)}>
          {expanded ? <Minimize2Icon className="size-3.5" /> : <Maximize2Icon className="size-3.5" />}
        </IconBtn>
        {onClose && (
          <IconBtn title={t('panel.close')} onClick={onClose}>
            <XIcon className="size-3.5" />
          </IconBtn>
        )}
      </header>
      <div className={cn('min-h-0 flex-1 overflow-auto', bodyClass)}>{children}</div>
    </section>
  );
}

export function IconBtn({ children, className, ...props }: React.ComponentProps<'button'>) {
  return (
    <button {...props} className={cn('flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground', className)}>
      {children}
    </button>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <div className="flex h-full items-center justify-center p-6 text-center text-sm whitespace-pre-line text-muted-foreground">{children}</div>;

/** Tree sizes, in pixels and as a share of the card. */
const TREE_MIN_PX = 140;
const TREE_START = '32%';
const TREE_MAX = '70%';
const VIEW_MIN_PX = 200;
/** The changed-files tree above the commit list, in pixels and as a share of the tree column. */
const FILES_MIN_PX = 80;
const COMMITS_MIN_PX = 60;
const COMMITS_START = '30%';
const COMMITS_MAX = '70%';

/** A tree beside its view; the divider between them is dragged to resize the tree (remembered per session). */
function TreeSplit({ id, tree, children }: { id: string; tree: ReactNode | null; children: ReactNode }) {
  const layout = useDefaultLayout({ id });
  if (!tree) return <div className="h-full min-w-0">{children}</div>;
  return (
    <ResizablePanelGroup orientation="horizontal" id={id} defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}>
      <ResizablePanel id="tree" defaultSize={TREE_START} minSize={TREE_MIN_PX} maxSize={TREE_MAX}>{tree}</ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id="view" minSize={VIEW_MIN_PX}>{children}</ResizablePanel>
    </ResizablePanelGroup>
  );
}

/** Ctrl/Cmd+F (and +Shift for all files) inside a card opens its find bar. */
function findKeys(open: (scope: FindScope) => void) {
  return {
    onKeyDownCapture: (event: React.KeyboardEvent) => {
      const mod = isMac ? event.metaKey : event.ctrlKey;
      if (!mod || event.altKey || event.key.toLowerCase() !== 'f') return;
      event.preventDefault();
      event.stopPropagation();
      open(event.shiftKey ? 'all' : 'file');
    },
  };
}

const FIND_DEBOUNCE_MS = 250;
const findHint = `${isMac ? '⌘' : 'Ctrl+'}F`;

/** A step through `count` hits, wrapping around. */
const wrapIndex = (index: number, direction: 1 | -1, count: number) => (index + direction + count) % count;

// ------------------------------------------------------------ diff

const GENERATED_LABEL = { lockfile: 'panel.gen.lockfile', minified: 'panel.gen.minified', sourcemap: 'panel.gen.sourcemap' } as const satisfies Record<GeneratedKind, string>;

const STATUS_OF_CHANGE: Record<ChangedFile['status'], PathStatus> = { A: 'added', M: 'modified', D: 'deleted' };

export function DiffPanel({ s, ...card }: CardProps & { s: SessionView }) {
  const t = useT();
  // Generated files start collapsed; `flipped` holds the user's per-file overrides.
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const [showTree, setShowTree] = useState(true);
  const [flat, setFlat] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  // The commit list under the tree; picking one swaps the panel from "all changes" to just that commit.
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [commit, setCommit] = useState<CommitInfo | null>(null);
  const [commitFiles, setCommitFiles] = useState<ChangedFile[]>([]);
  const review = useRef<ReviewHandle>(null);
  const finder = useRef<HTMLInputElement>(null);
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [hit, setHit] = useState(0);
  const id = s.meta.id;
  const files = commit ? commitFiles : s.changes;
  const hash = commit?.hash ?? null;
  const columnLayout = useDefaultLayout({ id: `${id}:diff-column` });
  // Contents are read per file as the viewer reaches it; each arrival re-renders the panel.
  const [arrived, arrive] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onContent(arrive), []);
  const contents = (f: ChangedFile) => contentOf(id, hash, f);
  const isBinary = (f: ChangedFile) => f.binary || !!contents(f)?.binary;
  const byPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  useEffect(() => {
    call('sessions:commits', id).then(setCommits).catch(() => setCommits([]));
  }, [id, s.changes, s.meta.baseBranch]);
  // Branches a diff can be measured from, read when the picker opens.
  const [branches, setBranches] = useState<string[]>([]);
  const loadBranches = (open: boolean) => {
    if (open) call('git:branches', s.meta.cwd).then(setBranches).catch(() => setBranches([]));
  };
  // A file that changed under the reader opens again, so its new lines are not hidden in a fold.
  const seenRevs = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const prev = seenRevs.current;
    seenRevs.current = new Map(s.changes.map((f) => [f.path, f.rev]));
    if (!prev) return;
    const changed = s.changes.filter((f) => prev.get(f.path) !== f.rev).map((f) => f.path);
    if (!changed.length) return;
    setFlipped((c) => {
      const n = new Set(c);
      for (const path of changed) if (isGeneratedFile(path)) n.add(path); else n.delete(path);
      return n;
    });
  }, [s.changes]);
  const pickBase = (ref: string) => {
    seenRevs.current = null;
    setCommit(null);
    setFlipped(new Set());
    void setDiffBase(id, ref);
  };
  const pickCommit = async (next: CommitInfo | null) => {
    setFlipped(new Set());
    if (!next || next.hash === commit?.hash) return void setCommit(null);
    try {
      const list = await call('sessions:commitChanges', id, next.hash);
      setCommitFiles(list);
      setCommit(next);
    } catch (err) {
      fail(err);
    }
  };
  const isCollapsed = (path: string) => isGeneratedFile(path) !== flipped.has(path);
  const toggle = (path: string) => setFlipped((c) => { const n = new Set(c); if (n.has(path)) n.delete(path); else n.add(path); return n; });
  // A file is collapsed when it is generated (unless flipped) or flipped (when it is not).
  const setAllCollapsed = (collapsed: boolean) => setFlipped(new Set(files.filter((f) => isGeneratedFile(f.path) !== collapsed).map((f) => f.path)));
  // One button for both: it folds everything while anything is open, and unfolds once all is folded.
  const allCollapsed = files.length > 0 && files.every((f) => f.binary || isCollapsed(f.path));
  const [focusFind, setFocusFind] = useState(0);
  const openFind = () => {
    setFinding(true);
    setFocusFind((n) => n + 1);
  };
  useEffect(() => {
    if (!focusFind) return;
    finder.current?.focus();
    finder.current?.select();
  }, [focusFind]);
  // Every line of the diff (changed and the context around it) that has the text, in file order.
  const hits = useMemo(() => {
    const out: { path: string; line: number; side: 'additions' | 'deletions' }[] = [];
    if (!finding || !query) return out;
    for (const f of files) {
      const content = contents(f);
      if (f.binary || !content || content.binary || out.length >= SEARCH_MAX_MATCHES) continue;
      const diff = fileDiffOf(f.path, f.status === 'A' ? null : content.before, f.status === 'D' ? null : content.after);
      const scan = (lines: string[], from: number, count: number, side: 'additions' | 'deletions') => {
        for (const m of findInText(lines.slice(from, from + count).join(''), query, caseSensitive)) out.push({ path: f.path, line: from + m.line, side });
      };
      for (const hunk of diff.hunks) {
        for (const c of hunk.hunkContent) {
          if (c.type === 'context') scan(diff.additionLines, c.additionLineIndex, c.lines, 'additions');
          else {
            scan(diff.deletionLines, c.deletionLineIndex, c.deletions, 'deletions');
            scan(diff.additionLines, c.additionLineIndex, c.additions, 'additions');
          }
        }
      }
    }
    return out;
  }, [finding, query, caseSensitive, files, arrived]); // eslint-disable-line react-hooks/exhaustive-deps
  // Searching needs every file's text, not just the ones scrolled to.
  useEffect(() => {
    if (finding && query) for (const f of files) if (!f.binary) wantContent(id, hash, f);
  }, [finding, !!query, files, hash]); // eslint-disable-line react-hooks/exhaustive-deps
  // Scrolling the viewer can pull focus into it; stepping with Enter needs the box to keep it.
  const keepFindFocus = () => requestAnimationFrame(() => finder.current?.focus({ preventScroll: true }));
  const showHit = (at: number) => {
    const target = hits[at];
    if (!target) return;
    setHit(at);
    setFlipped((c) => { const n = new Set(c); if (isGeneratedFile(target.path)) n.add(target.path); else n.delete(target.path); return n; });
    setActive(target.path);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      review.current?.scrollToLine(target.path, target.line, target.side);
      keepFindFocus();
    }));
  };
  // A new search starts at its first hit; a refresh of the changes under it does not move the reader.
  useEffect(() => {
    setHit(0);
    if (hits.length) showHit(0);
  }, [finding, query, caseSensitive]); // eslint-disable-line react-hooks/exhaustive-deps
  // "View diff" on a tool row is an explicit request: show the file, then land on it.
  const open = (p: string, line?: number, side?: 'additions' | 'deletions') => {
    const f = [...byPath.values()].find((x) => x.path === p || p.endsWith('/' + x.path) || x.path.endsWith(p));
    if (!f) return false;
    setFlipped((c) => { const n = new Set(c); if (isGeneratedFile(f.path)) n.add(f.path); else n.delete(f.path); return n; });
    setActive(f.path);
    requestAnimationFrame(() => (line ? review.current?.scrollToLine(f.path, line, side) : review.current?.scrollToItem(f.path)));
    return true;
  };
  // "View diff" on a tool row, and the PR bar's chips, jump here.
  useEffect(() => {
    if (diffTarget.thread) {
      // The first comment is the first one in the order the panel lists files.
      const first = firstThread(s.changes, s.prThreads);
      if (first) {
        diffTarget.thread = false;
        open(first.path);
        requestAnimationFrame(() => review.current?.focusThread(first));
      } else if (s.changes.length) diffTarget.thread = false;
      return;
    }
    if (!diffTarget.path) return;
    const { path: target, line, side } = diffTarget;
    if (!open(target, line, side)) void loadChanges(id).then(() => requestAnimationFrame(() => open(target, line, side)));
    diffTarget.path = null;
    diffTarget.line = undefined;
  }, [diffTarget.seq, s.changes.length, s.prThreads]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo<ReviewItem[]>(() => files.filter((f) => !isBinary(f)).map((f) => {
    const content = contents(f);
    return {
      id: f.path, kind: 'diff', path: f.path, ready: !!content,
      before: f.status === 'A' ? null : content?.before ?? null, after: f.status === 'D' ? null : content?.after ?? null, collapsed: isCollapsed(f.path),
    };
  }), [files, flipped, arrived, hash]); // eslint-disable-line react-hooks/exhaustive-deps
  const need = (ids: string[]) => ids.forEach((p) => { const f = byPath.get(p); if (f) wantContent(id, hash, f); });
  const statuses = useMemo(() => new Map(files.map((f) => [f.path, STATUS_OF_CHANGE[f.status]])), [files]);
  const decorate = (path: string): FileTreeRowDecoration | null => {
    const f = byPath.get(path);
    if (!f) return null;
    if (isBinary(f)) return { text: t('panel.binary') };
    return { text: `+${f.add} −${f.del}`, parts: [{ text: `+${f.add}`, color: 'var(--success)' }, { text: ` −${f.del}`, color: 'var(--destructive)' }] };
  };

  const title = (
    <span className="flex min-w-0 items-center gap-1.5 text-sm font-normal">
      <DropdownMenu onOpenChange={loadBranches}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="xs" className="min-w-0 gap-0.5 px-1 font-normal" title={t('panel.changeBase')}>
            <span className="truncate">{s.meta.baseBranch || t('panel.base')}</span>
            <ChevronDownIcon className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
          {branches.filter((b) => b !== s.meta.branch).map((b) => (
            <DropdownMenuItem key={b} onSelect={() => pickBase(b)} className={cn(b === s.meta.baseBranch && 'font-medium')}>
              <span className="truncate">{b}</span>
              {b === s.meta.baseBranch && <CheckIcon className="ml-auto size-3.5" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="text-muted-foreground">→</span>
      <span className="truncate">{s.meta.branch || fname(s.meta.cwd)}</span>
    </span>
  );
  const tools = (
    <>
      <IconBtn title={`${t('panel.findInDiff')}  ${findHint}`} onClick={openFind}><SearchIcon className="size-3.5" /></IconBtn>
      <IconBtn title={t(allCollapsed ? 'panel.expandAll' : 'panel.collapseAll')} onClick={() => setAllCollapsed(!allCollapsed)}>
        {allCollapsed ? <ChevronsUpDownIcon className="size-3.5" /> : <ChevronsDownUpIcon className="size-3.5" />}
      </IconBtn>
      <IconBtn title={t(flat ? 'panel.treeView' : 'panel.flatView')} aria-pressed={flat} onClick={() => setFlat((v) => !v)}>
        {flat ? <ListTreeIcon className="size-3.5" /> : <AlignJustifyIcon className="size-3.5" />}
      </IconBtn>
      <IconBtn title={t('panel.refresh')} onClick={() => { setFlipped(new Set()); void loadChanges(id); }}><RefreshCwIcon className="size-3.5" /></IconBtn>
      <OpenInMenu id={id}><IconBtn title={t('panel.openIn')}><ExternalLinkIcon className="size-3.5" /></IconBtn></OpenInMenu>
    </>
  );
  const treeToggle = (
    <IconBtn title={t(showTree ? 'panel.hideChangedFiles' : 'panel.showChangedFiles')} aria-pressed={showTree} className={cn(showTree && 'bg-info/15 text-info hover:bg-info/20 hover:text-info')} onClick={() => setShowTree((v) => !v)}>
      <ListIcon className="size-4" />
    </IconBtn>
  );
  let content: ReactNode;
  if (!s.meta.baseCommit) content = <Empty>{t('panel.notGit')}</Empty>;
  else if (!s.changes.length) content = <Empty>{t('panel.noChanges')}</Empty>;
  else {
    content = (
      <div className="flex h-full min-h-0 flex-col" {...findKeys(openFind)}>
        {finding && (
          <FindBar
            inputRef={finder}
            value={query}
            onValue={setQuery}
            caseSensitive={caseSensitive}
            onCaseSensitive={setCaseSensitive}
            placeholder={t('panel.findInChangesPh')}
            status={query ? `${hits.length ? hit + 1 : 0}/${hits.length}${hits.length >= SEARCH_MAX_MATCHES ? '+' : ''}` : ''}
            onStep={(direction) => hits.length && showHit(wrapIndex(hit, direction, hits.length))}
            onClose={() => setFinding(false)}
          />
        )}
        <div className="min-h-0 flex-1">
      <TreeSplit
        id={`${id}:diff-split`}
        tree={showTree && (
          <ResizablePanelGroup orientation="vertical" id={`${id}:diff-column`} defaultLayout={columnLayout.defaultLayout} onLayoutChanged={columnLayout.onLayoutChanged}>
            <ResizablePanel id="files" minSize={FILES_MIN_PX}>
              <div className="flex h-full min-h-0 flex-col">
            <PathTree
              key={String(flat)}
              flat={flat}
              className="min-h-0 flex-1"
              label="Changed files"
              meta={s.meta}
              paths={files.map((f) => f.path)}
              statuses={statuses}
              decorate={decorate}
              selected={active}
              expandAll
              snapshotOf={(p) => { const f = byPath.get(p); if (f?.status !== 'D') return undefined; wantContent(id, hash, f); return contents(f)?.before ?? undefined; }}
              onOpen={open}
            />
              </div>
            </ResizablePanel>
            {commits.length > 0 && (
              <>
                <ResizableHandle />
                <ResizablePanel id="commits" defaultSize={COMMITS_START} minSize={COMMITS_MIN_PX} maxSize={COMMITS_MAX}>
              <nav className="h-full overflow-y-auto p-1.5" aria-label={t('panel.commits')}>
                <div className="px-2 py-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{t('panel.commits')} · {commits.length}</div>
                <Button
                  variant="ghost"
                  className={cn('h-auto w-full justify-start gap-2 px-2 py-1 text-[13px] font-normal', !commit && 'bg-accent')}
                  onClick={() => void pickCommit(null)}
                >
                  <span className="truncate">{t('panel.allChanges')}</span>
                </Button>
                {commits.map((c) => (
                  <Button
                    key={c.hash}
                    variant="ghost"
                    title={`${c.short} · ${c.author} · ${new Date(c.date).toLocaleString()}
${c.subject}`}
                    onClick={() => void pickCommit(c)}
                    className={cn('h-auto w-full justify-start gap-2 px-2 py-1 text-[13px] font-normal', commit?.hash === c.hash && 'bg-accent')}
                  >
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{c.short}</span>
                    <span className="min-w-0 flex-1 truncate text-left">{c.subject}</span>
                  </Button>
                ))}
              </nav>
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        )}
      >
        <div className="relative h-full min-w-0">
          {files.length === 0 && <Empty>{t('panel.commitEmpty')}</Empty>}
          <ReviewCodeView
            ref={review}
            className="h-full"
            sid={id}
            items={items}
            threads={s.prThreads}
            onNeed={need}
            onActiveChange={setActive}
            renderPrefix={(item) => (
              <button className="flex items-center text-muted-foreground hover:text-foreground" aria-expanded={!isCollapsed(item.path)} title={t(isCollapsed(item.path) ? 'panel.showDiff' : 'panel.hideDiff')} onClick={() => toggle(item.path)}>
                {isCollapsed(item.path) ? <ChevronRightIcon className="size-3.5" /> : <ChevronDownIcon className="size-3.5" />}
              </button>
            )}
            renderMetadata={(item) => {
              const gen = generatedKind(item.path);
              return (
                <span className="flex items-center gap-1.5">
                  {gen && <span title={t('panel.generated', { kind: t(GENERATED_LABEL[gen]) })} className="text-[10px] font-medium tracking-wide text-muted-foreground/70">{t('panel.gen')}</span>}
                  {byPath.get(item.path)?.status !== 'D' && (
                    <IconBtn title={t('panel.openFile')} className="size-6" onClick={() => void openFileRef(item.path)}><CodeIcon className="size-3.5" /></IconBtn>
                  )}
                </span>
              );
            }}
          />
        </div>
      </TreeSplit>
        </div>
      </div>
    );
  }
  return (
    <Card {...card} title={<>{treeToggle}{title}</>} tools={tools} onClose={() => togglePanel(id, 'diff', false)} bodyClass="overflow-hidden">
      {content}
    </Card>
  );
}

// ------------------------------------------------------------ preview

export function PreviewPanel({ s, ...card }: CardProps & { s: SessionView }) {
  const t = useT();
  const saved = useApp((st) => st.prefs.previewUrl);
  const url = s.previewUrl || saved;
  const [value, setValue] = useState(url);
  const [nonce, setNonce] = useState(0);
  useEffect(() => setValue(url), [url]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    let u = value.trim();
    if (!/^https?:\/\//.test(u)) u = `http://${u}`;
    if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)) return void toast.warning(t('panel.localhostOnly'));
    updateSession(s.meta.id, (v) => void (v.previewUrl = u));
    setPref('previewUrl', u);
  };
  return (
    <Card
      {...card}
      title={
        <form onSubmit={submit} className="flex-1">
          <Input value={value} onChange={(e) => setValue(e.target.value)} aria-label={t('panel.previewUrl')} spellCheck={false} className="h-7 font-mono text-xs" />
        </form>
      }
      tools={<IconBtn title={t('panel.reload')} onClick={() => setNonce((n) => n + 1)}><RefreshCwIcon className="size-3.5" /></IconBtn>}
      onClose={() => togglePanel(s.meta.id, 'preview', false)}
      bodyClass="overflow-hidden"
    >
      <iframe key={`${url}#${nonce}`} src={url} title={t('panel.preview')} className="size-full border-0 bg-white" sandbox="allow-scripts allow-forms allow-same-origin" />
    </Card>
  );
}

// ------------------------------------------------------------ files

type FileDetail = Extract<NonNullable<SessionView['detail']>, { type: 'file' }>;

/** One window for the project: the file tree on the left, the open files (as tabs) on the right. */
export function FilesPanel({ s, ...card }: CardProps & { s: SessionView }) {
  const t = useT();
  const id = s.meta.id;
  const d = s.detail?.type === 'file' ? s.detail : null;
  const [source, setSource] = useSourceToggle(d?.path ?? '');
  const [showTree, setShowTree] = useState(true);
  const view = useRef<ReviewHandle>(null);
  const finder = useRef<HTMLInputElement>(null);
  const [find, setFind] = useState<FindScope | null>(null);
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [hit, setHit] = useState(0);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const paths = useMemo(() => s.files ?? [], [s.files]);

  const [focusFind, setFocusFind] = useState(0);
  const openFind = (scope: FindScope) => {
    setFind(scope);
    setFocusFind((n) => n + 1);
  };
  // The bar exists once the state has rendered; only then can it take the cursor.
  useEffect(() => {
    if (!focusFind) return;
    finder.current?.focus();
    finder.current?.select();
  }, [focusFind]);
  const closeFind = () => {
    setFind(null);
    setResult(null);
  };
  // Ctrl/Cmd+Shift+F anywhere in the app lands here.
  useEffect(() => {
    const take = () => {
      if (!findTarget.scope) return;
      openFind(findTarget.scope);
      findTarget.scope = null;
    };
    take();
    window.addEventListener(FIND_EVENT, take);
    return () => window.removeEventListener(FIND_EVENT, take);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // In the open file: the lines with the text, stepped through with Enter.
  const rendered = !!d && hasRenderedView(d.path) && !source;
  const fileHits = useMemo(() => (find === 'file' && d?.text != null && !rendered ? findInText(d.text, query, caseSensitive) : []), [find, d?.text, rendered, query, caseSensitive]);
  const showHit = (at: number) => {
    if (!d || !fileHits[at]) return;
    setHit(at);
    view.current?.scrollToLine(d.path, fileHits[at].line);
    requestAnimationFrame(() => finder.current?.focus({ preventScroll: true }));
  };
  useEffect(() => {
    setHit(0);
    if (!fileHits.length) return;
    const frame = requestAnimationFrame(() => showHit(0));
    return () => cancelAnimationFrame(frame);
  }, [fileHits]); // eslint-disable-line react-hooks/exhaustive-deps

  // In every file: the host reads the project; a keystroke later it is asked again.
  useEffect(() => {
    if (find !== 'all') return;
    if (!query) return void setResult(null);
    let live = true;
    const timer = setTimeout(() => {
      setSearching(true);
      call('sessions:search', id, query, caseSensitive)
        .then((r) => live && setResult(r))
        .catch((err) => live && fail(err))
        .finally(() => live && setSearching(false));
    }, FIND_DEBOUNCE_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [find, query, caseSensitive, id]);

  const [flat, setFlat] = useState(false);
  const treeToggle = (
    <IconBtn title={t(showTree ? 'panel.hideTree' : 'panel.showTree')} aria-pressed={showTree} className={cn(showTree && 'bg-info/15 text-info hover:bg-info/20 hover:text-info')} onClick={() => setShowTree((v) => !v)}>
      <ListIcon className="size-4" />
    </IconBtn>
  );
  const listing = find === 'all'
    ? <SearchResults result={result} busy={searching} onOpen={(path, line) => void openFileRef(path, line)} />
    : !s.files ? <Empty>{t('panel.loadingFiles')}</Empty> : !paths.length ? <Empty>{t('panel.noFiles')}</Empty> : (
      <PathTree
        key={String(flat)}
        flat={flat}
        className="min-h-0 flex-1"
        label="Project files"
        meta={s.meta}
        paths={paths}
        selected={d?.path}
        onOpen={(p) => void openFileRef(p)}
        onPin={(p) => pinFileTab(id, p)}
      />
    );
  const status = !query ? '' : find === 'all'
    ? (searching ? '…' : `${result?.matches.length ?? 0}${result?.truncated ? '+' : ''}`)
    : `${fileHits.length ? hit + 1 : 0}/${fileHits.length}${fileHits.length >= SEARCH_MAX_MATCHES ? '+' : ''}`;
  return (
    <Card
      {...card}
      title={<>{treeToggle}<span>{t('panel.files')}</span></>}
      tools={(
        <>
          <IconBtn title={`${t('panel.findInFiles')}  ${findHint} · ${isMac ? '⇧⌘' : 'Ctrl+Shift+'}F`} onClick={() => openFind(d ? 'file' : 'all')}><SearchIcon className="size-3.5" /></IconBtn>
          <IconBtn title={t(flat ? 'panel.treeView' : 'panel.flatView')} aria-pressed={flat} onClick={() => setFlat((v) => !v)}>
            {flat ? <ListTreeIcon className="size-3.5" /> : <AlignJustifyIcon className="size-3.5" />}
          </IconBtn>
          <IconBtn title={t('panel.refresh')} onClick={() => void loadFiles(id, true)}><RefreshCwIcon className="size-3.5" /></IconBtn>
        </>
      )}
      onClose={() => { togglePanel(id, 'files', false); closeFiles(id); }}
      bodyClass="overflow-hidden"
    >
      <div className="flex h-full min-h-0 flex-col" {...findKeys(openFind)}>
        {find && (
          <FindBar
            inputRef={finder}
            value={query}
            onValue={setQuery}
            caseSensitive={caseSensitive}
            onCaseSensitive={setCaseSensitive}
            scope={find}
            onScope={openFind}
            placeholder={t(find === 'all' ? 'panel.searchAllPh' : 'panel.searchFilePh')}
            status={status}
            onStep={find === 'file' ? (direction) => fileHits.length && showHit(wrapIndex(hit, direction, fileHits.length)) : undefined}
            onClose={closeFind}
          />
        )}
        <div className="min-h-0 flex-1">
          <TreeSplit id={`${id}:files-split`} tree={(showTree || find === 'all') && <div className="flex h-full min-h-0 flex-col">{listing}</div>}>
            <div className="flex h-full min-w-0 flex-col">
              {d ? (
                <>
                  <div className="flex h-9 shrink-0 items-stretch border-b">
                    <div role="tablist" className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
                      {s.fileTabs.map((tab) => (
                        <div
                          key={tab.path}
                          role="tab"
                          aria-selected={tab.path === d.path}
                          title={tab.path}
                          onClick={() => void openFileRef(tab.path)}
                          onDoubleClick={() => pinFileTab(id, tab.path)}
                          className={cn('group flex max-w-48 shrink-0 cursor-pointer items-center gap-1.5 border-r px-3 text-xs', tab.path === d.path ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50')}
                        >
                          <span className={cn('truncate', !tab.pinned && 'italic')}>{fname(tab.path)}</span>
                          <button
                            aria-label={t('panel.closeTab', { name: fname(tab.path) })}
                            className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-accent focus-visible:opacity-100"
                            onClick={(event) => { event.stopPropagation(); closeFileTab(id, tab.path); }}
                          >
                            <XIcon className="size-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="flex shrink-0 items-center gap-1 px-2"><FileTools s={s} d={d} source={source} onSource={setSource} /></div>
                  </div>
                  <FileBody s={s} d={d} source={source} viewRef={view} />
                </>
              ) : <Empty>{t('panel.pickFile')}</Empty>}
            </div>
          </TreeSplit>
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------ background tasks

/** Every subagent of the session, newest first. */
function agentTools(s: SessionView) {
  const out: ToolState[] = [];
  for (const item of s.items) if (item.kind === 'group') for (const t of item.tools) if (t.kind === 'agent') out.push(t);
  return out.reverse();
}

export const runningTasks = (s: SessionView) => agentTools(s).filter((t) => t.status === 'running');

/** Re-render every second while something is running, for the elapsed timers. */
function useTicker(on: boolean) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [on]);
}

const elapsed = (t: ToolState) => (t.sub ? fmtDur((t.sub.endedAt ?? Date.now()) - t.sub.startedAt) : '');

function TaskMeta({ tool, onTranscript }: { tool: ToolState; onTranscript?: () => void }) {
  const t = useT();
  const sub = tool.sub;
  const running = tool.status === 'running';
  const state = running ? sub?.activity || t('tasks.working') : t(tool.status === 'err' ? 'tasks.failed' : tool.status === 'denied' ? 'tasks.stopped' : 'tasks.completed');
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
      {sub && !tool.sh && <span><b className="font-medium text-foreground/80">{fmtTok(sub.tokens)}</b> {t('tasks.tokens')}</span>}
      {sub && !tool.sh && <span><b className="font-medium text-foreground/80">{sub.toolUses}</b> {t(sub.toolUses === 1 ? 'tasks.toolUse' : 'tasks.toolUses')}</span>}
      <span className={cn(running && 'shimmer', tool.status === 'err' && 'text-destructive')}>{state}</span>
      {onTranscript && <button className="text-info hover:underline" onClick={onTranscript}>{t(tool.sh ? 'tasks.viewOutput' : 'tasks.viewTranscript')}</button>}
    </div>
  );
}

export function TasksPanel({ s, ...card }: CardProps & { s: SessionView }) {
  const t = useT();
  const id = s.meta.id;
  const all = agentTools(s);
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const running = all.filter((task) => task.status === 'running');
  const done = all.filter((task) => task.status !== 'running' && !cleared.has(task.id));
  useTicker(running.length > 0);
  const row = (task: ToolState) => (
    <div key={task.id} className="group rounded-lg border bg-muted/40 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" title={task.desc}>{task.desc}</div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">{task.sh ? <SquareTerminalIcon className="size-3" /> : <BotIcon className="size-3" />}{task.sh ? t('tasks.shell') : `${t('tasks.agent')}${task.args?.subagent_type ? ` · ${task.args.subagent_type}` : ''}`}</span>
            {task.sub && <span className="tabular-nums">{elapsed(task)}</span>}
          </div>
        </div>
        {task.status === 'running' ? (
          <IconBtn title={t('tasks.stop')} className="size-6 border bg-card" onClick={() => void stopTask(id, task.id)}><SquareIcon className="size-2.5 fill-current" /></IconBtn>
        ) : task.status === 'done' ? <CheckIcon className="mt-0.5 size-4 text-success" /> : <XIcon className="mt-0.5 size-4 text-destructive" />}
      </div>
      <div className="mt-1.5"><TaskMeta tool={task} onTranscript={() => openAgent(id, task.id)} /></div>
    </div>
  );
  return (
    <Card
      {...card}
      title={t('tasks.title')}
      tools={<IconBtn title={t('tasks.clear')} disabled={!done.length} className="disabled:opacity-40" onClick={() => setCleared(new Set(all.filter((task) => task.status !== 'running').map((task) => task.id)))}><Trash2Icon className="size-3.5" /></IconBtn>}
      onClose={() => togglePanel(id, 'tasks', false)}
    >
      {!running.length && !done.length ? <Empty>{t('tasks.empty')}</Empty> : (
        <div className="space-y-4 p-3">
          {running.length > 0 && (
            <section className="space-y-2">
              <h3 className="px-0.5 text-xs text-muted-foreground">{t('tasks.running')}</h3>
              {running.map(row)}
            </section>
          )}
          {done.length > 0 && (
            <section className="space-y-2">
              <h3 className="px-0.5 text-xs text-muted-foreground">{t('tasks.finished')}</h3>
              {done.map(row)}
            </section>
          )}
        </div>
      )}
    </Card>
  );
}

const STEP_ICON: Record<string, typeof FileIcon> = { bash: SquareTerminalIcon, read: FileIcon, grep: SearchIcon, find: SearchIcon, ls: FolderIcon };

/** A subagent's prompt, every tool call and message it produced, then its report. */
function AgentTranscript({ s, tool, card, close }: { s: SessionView; tool: ToolState; card: CardProps; close: () => void }) {
  const t = useT();
  const running = tool.status === 'running';
  useTicker(running);
  const body = useRef<HTMLDivElement>(null);
  const steps = tool.sub?.steps ?? [];
  // The report is the last message; don't show it twice.
  const shown = !running && tool.md && steps.at(-1)?.kind === 'text' ? steps.slice(0, -1) : steps;
  useEffect(() => {
    if (running) body.current?.scrollTo({ top: body.current.scrollHeight });
  }, [running, steps.length]);
  return (
    <Card
      {...card}
      title={<><IconBtn title={t('tasks.back')} onClick={close}><ArrowLeftIcon className="size-3.5" /></IconBtn><span className="truncate">{tool.desc}</span>{tool.sub && <span className="shrink-0 text-xs font-normal text-muted-foreground tabular-nums">{elapsed(tool)}</span>}</>}
      tools={running && <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => void stopTask(s.meta.id, tool.id)}>{t('tasks.stopBtn')}</Button>}
      onClose={close}
      bodyClass="overflow-hidden"
    >
      <div ref={body} className="h-full overflow-auto">
        <div className="space-y-3 p-4">
          <TaskMeta tool={tool} />
          <div className={cn('rounded-lg bg-muted px-3 py-2 text-xs whitespace-pre-wrap text-muted-foreground', tool.sh && 'font-mono')}>{tool.prompt}</div>
          {tool.sh && <pre className="max-h-[60vh] overflow-auto rounded-lg border bg-card p-3 font-mono text-xs whitespace-pre-wrap">{tool.sh.output || t(running ? 'tasks.waitingOutput' : 'tasks.noOutput')}{!running && tool.sh.exitCode != null ? '\n[exit ' + tool.sh.exitCode + ']' : ''}</pre>}
          {shown.length > 0 && (
            <div className="space-y-1.5 border-l pl-3">
              {shown.map((step, i) => {
                if (step.kind === 'text') return <div key={i} className="text-sm"><Markdown text={step.text} /></div>;
                const Icon = STEP_ICON[step.name] ?? CodeIcon;
                return (
                  <div key={i} className={cn('flex min-w-0 items-center gap-2 text-xs', step.status === 'err' && 'text-destructive')} title={step.label}>
                    <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="shrink-0 text-muted-foreground">{step.name}</span>
                    <span className={cn('truncate font-mono', step.status === 'running' && 'shimmer')}>{step.label}</span>
                  </div>
                );
              })}
            </div>
          )}
          {tool.sh ? null : running ? <div className="text-sm"><span className="shimmer">{tool.sub?.activity || tool.summary || t('tasks.workingEllipsis')}</span></div> : (
            <>
              {tool.summary && <div className="text-xs text-muted-foreground">{tool.summary}</div>}
              {tool.md ? <Markdown text={tool.md} /> : !steps.length && <div className="text-sm text-muted-foreground">{t('tasks.noTranscript')}</div>}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------ detail: plan, subagent, file

export function DetailPanel({ s, ...card }: CardProps & { s: SessionView }) {
  const t = useT();
  const d = s.detail!;
  const id = s.meta.id;
  const close = () => closeDetail(id);
  const { copied, copy } = useCopy();
  if (d.type === 'plan') {
    const plan = findByKey(s, d.key);
    if (plan?.kind !== 'plan') return null;
    return (
      <Card {...card} title={t('plan.title')} onClose={close} tools={<IconBtn title={t(copied ? 'plan.copied' : 'plan.copy')} onClick={() => copy(plan.md)}><CopyGlyph copied={copied} /></IconBtn>}>
        <div className="space-y-4 p-4">
          <div className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            <MessageSquareIcon className="mt-0.5 size-3.5 shrink-0" />{t('plan.review')}
          </div>
          <Markdown text={plan.md || t('plan.waiting')} />
          {plan.requestId && !plan.resolved && <PlanActions sid={id} itemKey={plan.key} />}
        </div>
      </Card>
    );
  }
  if (d.type === 'agent') {
    const tool = findTool(s, d.toolCallId)?.tool;
    if (!tool) return null;
    return <AgentTranscript s={s} tool={tool} card={card} close={close} />;
  }
  return <FileViewer s={s} {...card} />;
}

const HTML_FILE = /\.html?$/i;
const MARKDOWN_FILE = /\.(md|markdown|mdx)$/i;
/** Files that open rendered, with a toggle for the source. */
const hasRenderedView = (path: string) => HTML_FILE.test(path) || MARKDOWN_FILE.test(path);
/** A file opens at its top; only a line past the first is a place to jump to. */
const FIRST_LINE = 1;

/** An HTML or Markdown file opens rendered; the toggle brings the source back. A new file starts rendered again. */
function useSourceToggle(path: string) {
  const [source, setSource] = useState(false);
  useEffect(() => setSource(false), [path]);
  return [source, setSource] as const;
}

function FileTools({ s, d, source, onSource }: { s: SessionView; d: FileDetail; source: boolean; onSource: (on: boolean) => void }) {
  const t = useT();
  const hasDiff = s.changes.some((f) => f.path === d.path);
  return (
    <>
      {hasRenderedView(d.path) && d.text != null && (
        <IconBtn title={t(source ? 'file.viewRendered' : 'file.viewSource')} onClick={() => onSource(!source)}>{source ? <EyeIcon className="size-3.5" /> : <CodeIcon className="size-3.5" />}</IconBtn>
      )}
      {hasDiff && <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => openDiffRef(d.path)}>{t('file.diff')}</Button>}
    </>
  );
}

function FileBody({ s, d, source, viewRef }: { s: SessionView; d: FileDetail; source: boolean; viewRef?: Ref<ReviewHandle> }) {
  const t = useT();
  const target = useMemo(() => (d.line > FIRST_LINE ? { id: d.path, line: d.line } : null), [d.path, d.line]);
  const items = useMemo<ReviewItem[]>(() => (d.text != null ? [{ id: d.path, kind: 'file', path: d.path, text: d.text }] : []), [d.path, d.text]);
  if (d.loading) return <Empty>{t('file.loading')}</Empty>;
  if (d.error) return <div className="p-4 text-sm text-destructive">{t('file.unable')}<pre className="mt-2 text-xs whitespace-pre-wrap">{d.error}</pre></div>;
  if (d.image !== undefined) {
    return d.image ? (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:20px_20px] p-4">
        <img src={d.image} alt={fname(d.path)} className="max-h-full max-w-full object-contain shadow-sm" />
      </div>
    ) : <Empty>{t('file.noImage')}</Empty>;
  }
  if (d.media !== undefined) {
    if (!d.media) return <Empty>{t('file.noMedia')}</Empty>;
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        {d.media.kind === 'video'
          ? <video key={d.path} src={d.media.src} controls className="max-h-full max-w-full" />
          : <audio key={d.path} src={d.media.src} controls className="w-full max-w-md" />}
      </div>
    );
  }
  if (d.text == null) return <Empty>{t('file.noPreview')}</Empty>;
  if (MARKDOWN_FILE.test(d.path) && !source) {
    return <SelectableContent key={d.path} sid={s.meta.id} path={d.path} className="flex-1"><div className="p-4"><Markdown text={d.text} className="text-sm" /></div></SelectableContent>;
  }
  if (HTML_FILE.test(d.path) && !source) {
    return <HtmlPreview key={d.path} sid={s.meta.id} path={d.path} html={d.text} title={fname(d.path)} />;
  }
  return <ReviewCodeView key={d.path} ref={viewRef} sid={s.meta.id} className="flex-1" items={items} target={target} hideHeader />;
}

/** A file opened from a Work session, which has no Files card: the preview stands alone. */
function FileViewer({ s, ...card }: CardProps & { s: SessionView }) {
  const d = s.detail as FileDetail;
  const [source, setSource] = useSourceToggle(d.path);
  return (
    <Card
      {...card}
      title={<span className="truncate font-mono text-xs" title={d.path}>{d.path}</span>}
      tools={<FileTools s={s} d={d} source={source} onSource={setSource} />}
      onClose={() => closeDetail(s.meta.id)}
      bodyClass="overflow-hidden flex flex-col"
    >
      <FileBody s={s} d={d} source={source} />
    </Card>
  );
}

// ------------------------------------------------------------ work progress

/** The subagents dispatched since the user's last message, oldest first. */
function turnAgents(items: Item[]): ToolState[] {
  let from = items.length - 1;
  while (from >= 0 && items[from].kind !== 'user') from--;
  return items.slice(from + 1).flatMap((item) => (item.kind === 'group' ? item.tools.filter((tool) => tool.kind === 'agent') : []));
}

/** What the model has dispatched this turn, for when it keeps no checklist. */
function Dispatched({ tasks }: { tasks: ToolState[] }) {
  return (
    <ul className="space-y-1">
      {tasks.map((task) => (
        <li key={task.id} className="flex items-center gap-2 text-sm">
          <span className="flex size-4 shrink-0 items-center justify-center">
            {task.status === 'running' ? <span className="size-1.5 animate-pulse rounded-full bg-primary" />
              : task.status === 'done' ? <CheckIcon className="size-3.5 text-muted-foreground" />
              : <XIcon className="size-3.5 text-destructive" />}
          </span>
          <span className={cn('min-w-0 truncate', task.status !== 'running' && 'text-muted-foreground')} title={task.desc}>{task.desc}</span>
        </li>
      ))}
    </ul>
  );
}

export function WorkPanel({ s, ...card }: CardProps & { s: SessionView }) {
  const t = useT();
  const models = useApp((st) => st.models);
  const todos = s.lastTodos;
  const tasks = todos.length ? [] : turnAgents(s.items);
  const done = todos.filter((todo) => todo.status === 'completed').length;
  const outputs = [...s.outputs].sort((a, b) => b.t - a.t);
  const id = s.meta.id;
  const folderName = s.meta.scratch ? t('progress.tempWorkspace') : fname(s.meta.cwd);
  return (
    <Card {...card} title={t('progress.title')} onClose={() => togglePanel(id, 'progress', false)}>
      <div className="divide-y">
        <section className="space-y-2 p-4">
          <h3 className="flex items-center justify-between text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t('progress.title')}{todos.length > 0 && <span>{done}/{todos.length}</span>}
          </h3>
          {todos.length ? (
            <>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(done / todos.length) * 100}%` }} /></div>
              <TodoList items={todos} />
            </>
          ) : tasks.length ? <Dispatched tasks={tasks} />
            : <p className="text-sm text-muted-foreground">{t(s.running ? 'progress.learning' : 'progress.multiStep')}</p>}
        </section>
        <section className="space-y-1 p-4">
          <h3 className="flex items-center justify-between text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('progress.files')}{outputs.length > 0 && <span>{outputs.length}</span>}</h3>
          {outputs.length ? outputs.map((o) => (
            <FileContextMenu key={o.path} meta={s.meta} path={o.path}>
            <div className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent">
              <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => void openFileRef(o.path)}>
                <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{fname(o.path)}</span>
                  <span className="block truncate text-xs text-muted-foreground">{fdir(o.path) || folderName} · {t(o.kind === 'write' ? 'progress.created' : 'progress.edited')}</span>
                </span>
              </button>
              {!isRemote && <IconBtn title={t('progress.open')} onClick={() => call('sessions:openPath', id, o.path, false).catch(fail)}><ExternalLinkIcon className="size-3.5" /></IconBtn>}
              {!isRemote && <IconBtn title={t('progress.reveal')} onClick={() => call('sessions:openPath', id, o.path, true).catch(fail)}><FolderIcon className="size-3.5" /></IconBtn>}
            </div>
            </FileContextMenu>
          )) : <p className="text-sm text-muted-foreground">{t('progress.filesEmpty')}</p>}
        </section>
        <section className="space-y-1 p-4">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('progress.context')}</h3>
          <button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left enabled:hover:bg-accent" disabled={isRemote} onClick={() => call('sessions:openPath', id, '.', false).catch(fail)}>
            <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0"><span className="block truncate text-sm font-medium">{folderName}</span><span className="block truncate text-xs text-muted-foreground">{s.meta.cwd}</span></span>
          </button>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <CodeIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0"><span className="block truncate text-sm font-medium">{modelName(models, s.model)}</span><span className="block text-xs text-muted-foreground">{modeName(s.meta.mode)} · {s.ctxPct != null ? t('progress.contextUsed', { pct: Math.round(s.ctxPct) }) : t('progress.context1')}</span></span>
          </div>
        </section>
      </div>
    </Card>
  );
}
