import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode, type Ref } from 'react';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  CodeIcon,
  ExternalLinkIcon,
  FileIcon,
  FolderIcon,
  AlignJustifyIcon,
  EyeIcon,
  FileDiffIcon,
  ListTreeIcon,
  MessageSquareIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SquareIcon,
  SquareTerminalIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { useDefaultLayout } from 'react-resizable-panels';
import { toast } from 'sonner';
import { findInText, SEARCH_MAX_MATCHES, type SearchResult } from '@shared/text-search';
import type { CommitInfo, FileContent } from '@shared/protocol';
import { generatedKind, isGeneratedFile, type GeneratedKind } from '@shared/generated';
import {
  HEADER_TOGGLE_ATTR,
  ReviewCodeView,
  type ReviewHandle,
  type ReviewItem,
} from '@/components/common/ReviewCodeView';
import type { FileTreeRowDecoration } from '@pierre/trees';
import { CopyGlyph, useCopy } from '@/components/common/Copy';
import { OpenInMenu, OpenInSubmenu } from '@/components/common/OpenInMenu';
import { ZoomImage } from '@/components/common/ZoomImage';
import { HtmlPreview } from '@/components/common/HtmlPreview';
import { Markdown } from '@/components/common/Markdown';
import { SelectableContent } from '@/components/common/SelectableContent';
import { TodoDisclosure } from '@/components/common/TodoDisclosure';
import { TodoList, PlanActions } from '@/components/thread/Items';
import { Button } from '@/components/ui/button';
import { CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { bridge, call, isMac, isRemote } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { platformBinding, shortcutFor } from '@shared/shortcuts';
import { shortcutFromEvent, useShortcutHint } from '@/lib/shortcut-keys';
import { contentOf, onContent, wantContent } from '@/lib/change-content';
import { fileDiffOf } from '@/lib/file-diff';
import { modeName } from '@/lib/constants';
import { firstThread } from '@/lib/diff';
import { fdir, fmtDur, fmtTok, fname } from '@/lib/format';
import type { ToolState } from '@/lib/tools';
import { cn } from '@/lib/utils';
import {
  closeDetail,
  closeFileTab,
  diffTarget,
  fail,
  FIND_EVENT,
  findTarget,
  loadChanges,
  loadFiles,
  openAgent,
  openDiffRef,
  openFileRef,
  pinFileTab,
  stopTask,
} from '@/store/actions';
import { getApp, modelName, setPref, updateSession, useApp } from '@/store/app';
import { findByKey, findTool } from '@/store/transcript';
import type { ChangedFile, DiffScope, FileDetail, Item, SessionChange, SessionView } from '@/store/types';
import { DiffSince } from './DiffSince';
import { FileContextMenu } from './FileContextMenu';
import { FindBar, SearchResults, type FindScope } from './FindBar';
import { PathTree, type PathStatus } from './PathTree';
import { IconBtn, PanelActionButton, PanelToolbar, type PanelAction } from './PanelToolbar';
import { useDiffComparison } from './useDiffComparison';

// ------------------------------------------------------------ panel chrome

/** Content toolbar inside the shared workspace, without a second panel frame. */
export function Card({
  title,
  actions = [],
  menu,
  fillTitle,
  children,
  bodyClass,
}: {
  title?: ReactNode;
  actions?: PanelAction[];
  menu?: ReactNode;
  fillTitle?: boolean;
  children: ReactNode;
  bodyClass?: string;
}) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {(title || actions.length > 0 || menu) && (
        <header className="panel-heading">
          <PanelToolbar title={title} fillTitle={fillTitle} menu={menu} actions={actions} />
        </header>
      )}
      <div className={cn('min-h-0 flex-1 overflow-auto', bodyClass)}>{children}</div>
    </div>
  );
}

const Empty = ({ children }: { children: ReactNode }) => (
  <div className="flex h-full items-center justify-center p-6 text-center text-sm whitespace-pre-line text-muted-foreground">
    {children}
  </div>
);

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
    <ResizablePanelGroup
      orientation="horizontal"
      id={id}
      defaultLayout={layout.defaultLayout}
      onLayoutChanged={layout.onLayoutChanged}
    >
      <ResizablePanel id="tree" defaultSize={TREE_START} minSize={TREE_MIN_PX} maxSize={TREE_MAX} className="bg-chrome">
        {tree}
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id="view" minSize={VIEW_MIN_PX}>
        {children}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

/** A focused card handles find locally, rather than switching to the Files card. */
function findKeys(open: (scope: FindScope) => void) {
  return {
    'data-panel-find': true,
    onKeyDownCapture: (event: React.KeyboardEvent) => {
      const pressed = platformBinding(shortcutFromEvent(event.nativeEvent, isMac), isMac);
      const overrides = getApp().settings.shortcuts;
      for (const [action, scope] of [
        ['findFile', 'file'],
        ['findAll', 'all'],
      ] as const) {
        const key = shortcutFor(overrides, action);
        if (!key || platformBinding(key, isMac) !== pressed) continue;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) open(scope);
        break;
      }
    },
  };
}

const FIND_DEBOUNCE_MS = 250;

/** A step through `count` hits, wrapping around. */
const wrapIndex = (index: number, direction: 1 | -1, count: number) => (index + direction + count) % count;

// ------------------------------------------------------------ diff

const GENERATED_LABEL = {
  lockfile: 'panel.gen.lockfile',
  minified: 'panel.gen.minified',
  sourcemap: 'panel.gen.sourcemap',
} as const satisfies Record<GeneratedKind, string>;

const STATUS_OF_CHANGE: Record<ChangedFile['status'], PathStatus> = { A: 'added', M: 'modified', D: 'deleted' };
type DiffFile = ChangedFile | SessionChange;
const NO_DIFF_FILES: ChangedFile[] = [];
const NO_COMMITS: CommitInfo[] = [];

export function DiffPanel({ s }: { s: SessionView }) {
  const t = useT();
  const findHint = useShortcutHint('findFile', t('panel.findInDiff'));
  // Generated files start collapsed; `flipped` holds the user's per-file overrides.
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const [showTree, setShowTree] = useState(true);
  const [flat, setFlat] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  // The commit list under the tree; picking one swaps the panel from "all changes" to just that commit.
  const [commit, setCommit] = useState<CommitInfo | null>(null);
  const [commitFiles, setCommitFiles] = useState<ChangedFile[]>([]);
  const commitRequest = useRef(0);
  const review = useRef<ReviewHandle>(null);
  const finder = useRef<HTMLInputElement>(null);
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [hit, setHit] = useState(0);
  const id = s.meta.id;
  const sessionMode = !s.meta.baseCommit;
  const scope = s.diffScope;
  const pickedBranch = s.diffBranch;
  const [menuOpen, setMenuOpen] = useState(false);
  const branch = pickedBranch ?? s.meta.baseBranch;
  const branchDiff = useDiffComparison(
    s,
    { kind: 'branch', ref: branch },
    !sessionMode && (scope === 'branch' || menuOpen),
  );
  const lastCommitDiff = useDiffComparison(
    s,
    { kind: 'lastCommit' },
    !sessionMode && (scope === 'lastCommit' || menuOpen),
  );
  const turnDiff = useDiffComparison(s, { kind: 'lastTurn' }, scope === 'lastTurn' || menuOpen);
  const comparison = scope === 'lastTurn' ? turnDiff : scope === 'branch' ? branchDiff : lastCommitDiff;
  const toolChanges = sessionMode && scope === 'branch';
  const loading = !toolChanges && !comparison.data && !comparison.error;
  const diffFiles = toolChanges ? s.sessionChanges : comparison.data?.files;
  const files: DiffFile[] = commit ? commitFiles : (diffFiles ?? NO_DIFF_FILES);
  const commits = toolChanges ? NO_COMMITS : (comparison.data?.commits ?? NO_COMMITS);
  const hash = commit?.hash ?? null;
  const base = commit || toolChanges ? undefined : comparison.data?.base;
  const columnLayout = useDefaultLayout({ id: `${id}:diff-column` });
  // Contents are read per file as the viewer reaches it; each arrival re-renders the panel.
  const [arrived, arrive] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onContent(arrive), []);
  const contents = useCallback(
    (f: DiffFile): FileContent | undefined =>
      !commit && 'before' in f ? { before: f.before, after: f.after, binary: f.binary } : contentOf(id, hash, f, base),
    [id, hash, base, commit],
  );
  const isBinary = useCallback((f: ChangedFile) => f.binary || !!contents(f)?.binary, [contents]);
  const byPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  // A file that changed under the reader opens again, so its new lines are not hidden in a fold.
  const seenRevs = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (loading) return;
    const prev = seenRevs.current;
    seenRevs.current = new Map(files.map((f) => [f.path, f.rev]));
    if (!prev) return;
    const changed = files.filter((f) => prev.get(f.path) !== f.rev).map((f) => f.path);
    if (!changed.length) return;
    setFlipped((c) => {
      const n = new Set(c);
      for (const path of changed)
        if (isGeneratedFile(path)) n.add(path);
        else n.delete(path);
      return n;
    });
  }, [files, loading]);
  const pickComparison = (next: DiffScope, ref?: string) => {
    commitRequest.current++;
    seenRevs.current = null;
    setCommit(null);
    setActive(null);
    setFlipped(new Set());
    updateSession(id, (view) => {
      view.diffScope = next;
      if (ref) view.diffBranch = ref;
    });
  };
  const pickCommit = async (next: CommitInfo | null) => {
    const request = ++commitRequest.current;
    setFlipped(new Set());
    if (!next || next.hash === commit?.hash) return void setCommit(null);
    try {
      const list = await call('sessions:commitChanges', id, next.hash);
      if (request !== commitRequest.current) return;
      setCommitFiles(list);
      setCommit(next);
    } catch (err) {
      fail(err);
    }
  };
  const isCollapsed = useCallback((path: string) => isGeneratedFile(path) !== flipped.has(path), [flipped]);
  const toggle = (path: string) =>
    setFlipped((c) => {
      const n = new Set(c);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });
  // A file is collapsed when it is generated (unless flipped) or flipped (when it is not).
  const setAllCollapsed = (collapsed: boolean) =>
    setFlipped(new Set(files.filter((f) => isGeneratedFile(f.path) !== collapsed).map((f) => f.path)));
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
      const diff = fileDiffOf(
        f.path,
        f.status === 'A' ? null : content.before,
        f.status === 'D' ? null : content.after,
      );
      const scan = (lines: string[], from: number, count: number, side: 'additions' | 'deletions') => {
        for (const m of findInText(lines.slice(from, from + count).join(''), query, caseSensitive))
          out.push({ path: f.path, line: from + m.line, side });
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
    if (finding && query)
      for (const f of files) if (!f.binary && !('before' in f && 'after' in f)) wantContent(id, hash, f, base);
  }, [finding, !!query, files, hash, base]); // eslint-disable-line react-hooks/exhaustive-deps
  // Scrolling the viewer can pull focus into it; stepping with Enter needs the box to keep it.
  const keepFindFocus = () => requestAnimationFrame(() => finder.current?.focus({ preventScroll: true }));
  const showHit = (at: number) => {
    const target = hits[at];
    if (!target) return;
    setHit(at);
    setFlipped((c) => {
      const n = new Set(c);
      if (isGeneratedFile(target.path)) n.add(target.path);
      else n.delete(target.path);
      return n;
    });
    setActive(target.path);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        review.current?.scrollToLine(target.path, target.line, target.side);
        keepFindFocus();
      }),
    );
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
    setFlipped((c) => {
      const n = new Set(c);
      if (isGeneratedFile(f.path)) n.add(f.path);
      else n.delete(f.path);
      return n;
    });
    setActive(f.path);
    requestAnimationFrame(() =>
      line ? review.current?.scrollToLine(f.path, line, side) : review.current?.scrollToItem(f.path),
    );
    return true;
  };
  // "View diff" on a tool row, and the PR bar's chips, jump here.
  useEffect(() => {
    if ((diffTarget.thread || diffTarget.path) && (scope !== 'branch' || pickedBranch || commit)) {
      pickComparison('branch');
      updateSession(id, (view) => void (view.diffBranch = null));
      return;
    }
    if (loading) return;
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
    if (!open(target, line, side) && !sessionMode)
      void loadChanges(id).then(() => requestAnimationFrame(() => open(target, line, side)));
    diffTarget.path = null;
    diffTarget.line = undefined;
  }, [diffTarget.seq, s.diffRequest, files, s.prThreads, sessionMode, scope, pickedBranch, commit, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo<ReviewItem[]>(() => {
    // `arrived` is a cache-busting counter: contentOf() reads a store outside React.
    void arrived;
    return files
      .filter((f) => !isBinary(f))
      .map((f) => {
        const content = contents(f);
        return {
          id: f.path,
          kind: 'diff',
          path: f.path,
          ready: !!content,
          before: f.status === 'A' ? null : (content?.before ?? null),
          after: f.status === 'D' ? null : (content?.after ?? null),
          collapsed: isCollapsed(f.path),
        };
      });
  }, [files, contents, isCollapsed, isBinary, arrived]);
  const need = (ids: string[]) =>
    ids.forEach((p) => {
      const f = byPath.get(p);
      if (f && !('before' in f && 'after' in f)) wantContent(id, hash, f, base);
    });
  const statuses = useMemo(() => new Map(files.map((f) => [f.path, STATUS_OF_CHANGE[f.status]])), [files]);
  const decorate = (path: string): FileTreeRowDecoration | null => {
    const f = byPath.get(path);
    if (!f) return null;
    if (isBinary(f)) return { text: t('panel.binary') };
    return {
      text: `+${f.add} −${f.del}`,
      parts: [
        { text: `+${f.add}`, color: 'var(--success)' },
        { text: ` −${f.del}`, color: 'var(--destructive)' },
      ],
    };
  };

  const comparisonPicker = (
    <DiffSince
      cwd={s.meta.cwd}
      scope={scope}
      branch={branch}
      sessionMode={sessionMode}
      files={{
        branch: sessionMode ? s.sessionChanges : branchDiff.data?.files,
        lastCommit: lastCommitDiff.data?.files,
        lastTurn: turnDiff.data?.files,
      }}
      onSelect={pickComparison}
      onOpenChange={setMenuOpen}
    />
  );
  const actions: PanelAction[] = [
    {
      id: 'tree',
      label: t(showTree ? 'panel.hideChangedFiles' : 'panel.showChangedFiles'),
      icon: <ListTreeIcon className="size-3.5" />,
      pressed: showTree,
      onSelect: () => setShowTree((v) => !v),
    },
    {
      id: 'find',
      label: findHint,
      icon: <SearchIcon className="size-3.5" />,
      focusContent: true,
      onSelect: openFind,
    },
    ...(!isRemote
      ? [
          {
            id: 'open-in',
            priority: 'secondary' as const,
            button: (
              <OpenInMenu id={id}>
                <IconBtn title={t('panel.openIn')}>
                  <ExternalLinkIcon className="size-3.5" />
                </IconBtn>
              </OpenInMenu>
            ),
            menu: <OpenInSubmenu id={id} />,
          },
        ]
      : []),
  ];
  const menu = (
    <>
      <DropdownMenuItem onSelect={() => setAllCollapsed(!allCollapsed)}>
        {allCollapsed ? <ChevronsUpDownIcon /> : <ChevronsDownUpIcon />}
        {t(allCollapsed ? 'panel.expandAll' : 'panel.collapseAll')}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setFlat((v) => !v)}>
        {flat ? <ListTreeIcon /> : <AlignJustifyIcon />}
        {t(flat ? 'panel.treeView' : 'panel.flatView')}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={() => {
          setFlipped(new Set());
          void loadChanges(id);
        }}
      >
        <RefreshCwIcon />
        {t('panel.refresh')}
      </DropdownMenuItem>
    </>
  );
  let content: ReactNode;
  if (loading) content = <Empty>{t('panel.loadingDiff')}</Empty>;
  else if (!toolChanges && comparison.error) content = <Empty>{t('panel.diffError')}</Empty>;
  else if (!files.length) content = <Empty>{t('panel.noChanges')}</Empty>;
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
            status={
              query ? `${hits.length ? hit + 1 : 0}/${hits.length}${hits.length >= SEARCH_MAX_MATCHES ? '+' : ''}` : ''
            }
            onStep={(direction) => hits.length && showHit(wrapIndex(hit, direction, hits.length))}
            onClose={() => setFinding(false)}
          />
        )}
        <div className="min-h-0 flex-1">
          <TreeSplit
            id={`${id}:diff-split`}
            tree={
              showTree && (
                <ResizablePanelGroup
                  orientation="vertical"
                  id={`${id}:diff-column`}
                  defaultLayout={columnLayout.defaultLayout}
                  onLayoutChanged={columnLayout.onLayoutChanged}
                >
                  <ResizablePanel id="files" minSize={FILES_MIN_PX}>
                    <div className="flex h-full min-h-0 flex-col">
                      <PathTree
                        key={String(flat)}
                        flat={flat}
                        className="min-h-0 flex-1"
                        label={t('panel.changedFiles')}
                        meta={s.meta}
                        paths={files.map((f) => f.path)}
                        statuses={statuses}
                        decorate={decorate}
                        selected={active}
                        expandAll
                        snapshotOf={(p) => {
                          const f = byPath.get(p);
                          if (f?.status !== 'D') return undefined;
                          wantContent(id, hash, f, base);
                          return contents(f)?.before ?? undefined;
                        }}
                        onOpen={open}
                      />
                    </div>
                  </ResizablePanel>
                  {commits.length > 0 && (
                    <>
                      <ResizableHandle />
                      <ResizablePanel
                        id="commits"
                        defaultSize={COMMITS_START}
                        minSize={COMMITS_MIN_PX}
                        maxSize={COMMITS_MAX}
                      >
                        <nav className="h-full overflow-y-auto p-1.5" aria-label={t('panel.commits')}>
                          <div className="px-2 py-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                            {t('panel.commits')} · {commits.length}
                          </div>
                          <Button
                            variant="ghost"
                            className={cn(
                              'h-auto w-full justify-start gap-2 px-2 py-1 text-[13px] font-normal',
                              !commit && 'bg-accent',
                            )}
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
                              className={cn(
                                'h-auto w-full justify-start gap-2 px-2 py-1 text-[13px] font-normal',
                                commit?.hash === c.hash && 'bg-accent',
                              )}
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
              )
            }
          >
            <div className="relative h-full min-w-0">
              {files.length === 0 && <Empty>{t('panel.commitEmpty')}</Empty>}
              <ReviewCodeView
                ref={review}
                className="h-full"
                sid={id}
                items={items}
                threads={scope === 'branch' && branch === s.meta.baseBranch && !commit ? s.prThreads : []}
                onNeed={need}
                onActiveChange={setActive}
                renderPrefix={(item) => (
                  <button
                    {...{ [HEADER_TOGGLE_ATTR]: '' }}
                    className="flex items-center text-muted-foreground hover:text-foreground"
                    aria-expanded={!isCollapsed(item.path)}
                    title={t(isCollapsed(item.path) ? 'panel.showDiff' : 'panel.hideDiff')}
                    onClick={() => toggle(item.path)}
                  >
                    {isCollapsed(item.path) ? (
                      <ChevronRightIcon className="size-3.5" />
                    ) : (
                      <ChevronDownIcon className="size-3.5" />
                    )}
                  </button>
                )}
                renderMetadata={(item) => {
                  const gen = generatedKind(item.path);
                  return (
                    <span className="flex items-center gap-1.5">
                      {gen && (
                        <span
                          title={t('panel.generated', { kind: t(GENERATED_LABEL[gen]) })}
                          className="text-[10px] font-medium tracking-wide text-muted-foreground/70"
                        >
                          {t('panel.gen')}
                        </span>
                      )}
                      {byPath.get(item.path)?.status !== 'D' && (
                        <IconBtn
                          title={t('panel.openFile')}
                          className="size-6"
                          onClick={() => void openFileRef(item.path)}
                        >
                          <CodeIcon className="size-3.5" />
                        </IconBtn>
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
    <Card
      title={
        <>
          <FileDiffIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{t('panel.changes')}</span>
          <span className="text-xs font-normal text-muted-foreground tabular-nums">{files.length}</span>
        </>
      }
      actions={actions}
      menu={menu}
      bodyClass="overflow-hidden"
    >
      <div className="flex h-full min-h-0 flex-col">
        <div data-slot="panel-context" className="flex h-8 shrink-0 items-center border-b border-divider px-3">
          {comparisonPicker}
        </div>
        <div className="min-h-0 flex-1">{content}</div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------ preview

const PREVIEW_PROTOCOLS = new Set(['http:', 'https:', 'file:']);

function normalizePreviewUrl(input: string): string | null {
  let raw = input.trim();
  if (!raw) return null;
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) raw = `http://${raw}`;
  try {
    const url = new URL(raw);
    return PREVIEW_PROTOCOLS.has(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

interface PreviewTab {
  id: string;
  partition: string;
  url: string;
  src: string;
  title: string;
}

type PreviewWebviewEvent = Event & { title?: string; url?: string };

interface PreviewWebview {
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  addEventListener(event: string, listener: (event: PreviewWebviewEvent) => void): void;
  removeEventListener(event: string, listener: (event: PreviewWebviewEvent) => void): void;
}

function tabLabel(tab: PreviewTab): string {
  if (tab.title.trim()) return tab.title;
  if (tab.url === 'about:blank') return '';
  try {
    const url = new URL(tab.url);
    return url.hostname || url.protocol.replace(':', '');
  } catch {
    return tab.url;
  }
}

export function PreviewPanel({ s }: { s: SessionView }) {
  const t = useT();
  const saved = useApp((st) => st.prefs.previewUrl);
  const initialUrl = s.previewUrl || saved;
  const [tabs, setTabs] = useState<PreviewTab[]>([
    { id: 'tab-1', partition: 'pi-preview-tab-1', url: initialUrl, src: initialUrl, title: '' },
  ]);
  const [activeId, setActiveId] = useState('tab-1');
  const [value, setValue] = useState(initialUrl);
  const [nonce, setNonce] = useState(0);
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);
  const nextTab = useRef(2);
  const webviewsRef = useRef(new Map<string, PreviewWebview>());
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const tabIds = tabs.map((tab) => tab.id).join('|');

  const syncHistory = useCallback(
    (tabId: string) => {
      if (tabId !== activeId) return;
      const view = webviewsRef.current.get(tabId);
      if (!view) return;
      try {
        setCanBack(view.canGoBack());
        setCanForward(view.canGoForward());
      } catch {
        // The guest is not ready yet.
      }
    },
    [activeId],
  );

  const setWebviewRef = useCallback((tabId: string, element: HTMLWebViewElement | null) => {
    if (element) webviewsRef.current.set(tabId, element as unknown as PreviewWebview);
    else webviewsRef.current.delete(tabId);
  }, []);

  const updateTabUrl = useCallback(
    (tabId: string, nextUrl: string) => {
      setTabs((current) => current.map((tab) => (tab.id === tabId ? { ...tab, url: nextUrl } : tab)));
      if (tabId !== activeId) return;
      setValue(nextUrl === 'about:blank' ? '' : nextUrl);
      if (nextUrl !== 'about:blank') {
        updateSession(s.meta.id, (session) => void (session.previewUrl = nextUrl));
        setPref('previewUrl', nextUrl);
      }
      syncHistory(tabId);
    },
    [activeId, s.meta.id, syncHistory],
  );

  const updateTabTitle = useCallback((tabId: string, title: string) => {
    setTabs((current) => current.map((tab) => (tab.id === tabId ? { ...tab, title } : tab)));
  }, []);

  useEffect(() => {
    const cleanups: (() => void)[] = [];
    for (const tab of tabs) {
      const view = webviewsRef.current.get(tab.id);
      if (!view) continue;
      const onNavigate = (event: PreviewWebviewEvent) => {
        if (event.url) updateTabUrl(tab.id, event.url);
      };
      const onTitle = (event: PreviewWebviewEvent) => {
        if (event.title) updateTabTitle(tab.id, event.title);
      };
      const onFinish = () => syncHistory(tab.id);
      view.addEventListener('did-navigate', onNavigate);
      view.addEventListener('did-navigate-in-page', onNavigate);
      view.addEventListener('page-title-updated', onTitle);
      view.addEventListener('did-finish-load', onFinish);
      cleanups.push(() => {
        view.removeEventListener('did-navigate', onNavigate);
        view.removeEventListener('did-navigate-in-page', onNavigate);
        view.removeEventListener('page-title-updated', onTitle);
        view.removeEventListener('did-finish-load', onFinish);
      });
    }
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [activeId, nonce, syncHistory, tabIds, tabs, updateTabTitle, updateTabUrl]);

  useEffect(() => {
    return bridge.on('preview:open', ({ partition, url, disposition }) => {
      // oxfmt-ignore
      const source = partition
        ? tabsRef.current.find((tab) => tab.partition === partition) ??
          tabsRef.current.find((tab) => tab.id === activeIdRef.current)
        : tabsRef.current.find((tab) => tab.id === activeIdRef.current);
      if (!source) return;
      const next = normalizePreviewUrl(url);
      if (!next) return;
      const id = `tab-${nextTab.current++}`;
      const tab = { id, partition: `pi-preview-${id}`, url: next, src: next, title: '' };
      const nextTabs = [...tabsRef.current, tab];
      tabsRef.current = nextTabs;
      setTabs(nextTabs);
      if (disposition !== 'background-tab') {
        setActiveId(id);
        setValue(next);
        setCanBack(false);
        setCanForward(false);
      }
    });
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = normalizePreviewUrl(value);
    if (!next) return void toast.warning(t('panel.invalidUrl'));
    setTabs((current) =>
      current.map((tab) => (tab.id === activeId ? { ...tab, url: next, src: next, title: '' } : tab)),
    );
    updateTabUrl(activeId, next);
    setNonce((current) => current + 1);
  };

  const selectTab = (id: string) => {
    const tab = tabs.find((item) => item.id === id);
    if (!tab) return;
    setActiveId(id);
    setValue(tab.url === 'about:blank' ? '' : tab.url);
    setCanBack(false);
    setCanForward(false);
  };

  const addTab = () => {
    const id = `tab-${nextTab.current++}`;
    const tab = { id, partition: `pi-preview-${id}`, url: 'about:blank', src: 'about:blank', title: '' };
    const nextTabs = [...tabs, tab];
    tabsRef.current = nextTabs;
    setTabs(nextTabs);
    setActiveId(id);
    setValue('');
    setCanBack(false);
    setCanForward(false);
  };

  const closeTab = (id: string) => {
    if (tabs.length === 1) return;
    const index = tabs.findIndex((tab) => tab.id === id);
    const remaining = tabs.filter((tab) => tab.id !== id);
    tabsRef.current = remaining;
    setTabs(remaining);
    webviewsRef.current.delete(id);
    if (id !== activeId) return;
    const replacement = remaining[Math.min(index, remaining.length - 1)];
    setActiveId(replacement.id);
    setValue(replacement.url === 'about:blank' ? '' : replacement.url);
    setCanBack(false);
    setCanForward(false);
  };

  return (
    <Card
      fillTitle
      title={
        <form onSubmit={submit} className="min-w-0 flex-1">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label={t('panel.previewUrl')}
            spellCheck={false}
            className="h-7 font-mono text-xs"
          />
        </form>
      }
      actions={[
        {
          id: 'back',
          label: t('panel.back'),
          icon: <ArrowLeftIcon className="size-3.5" />,
          disabled: !canBack,
          onSelect: () => webviewsRef.current.get(activeId)?.goBack(),
        },
        {
          id: 'forward',
          label: t('panel.forward'),
          icon: <ArrowRightIcon className="size-3.5" />,
          disabled: !canForward,
          onSelect: () => webviewsRef.current.get(activeId)?.goForward(),
        },
        {
          id: 'reload',
          label: t('panel.reload'),
          icon: <RefreshCwIcon className="size-3.5" />,
          onSelect: () => setNonce((current) => current + 1),
        },
      ]}
      bodyClass="overflow-hidden"
    >
      <div className="flex h-full min-h-0 flex-col">
        <div role="tablist" className="panel-tabs overflow-x-auto">
          {tabs.map((tab) => (
            <div key={tab.id} data-state={tab.id === activeId ? 'active' : 'inactive'} className="panel-tab max-w-56">
              <button
                type="button"
                role="tab"
                aria-selected={tab.id === activeId}
                className="h-full min-w-0 truncate outline-none focus-visible:underline"
                onClick={() => selectTab(tab.id)}
              >
                {tabLabel(tab) || t('panel.newTab')}
              </button>
              {tabs.length > 1 && (
                <IconBtn
                  title={t('panel.closeTab', { name: tabLabel(tab) || t('panel.newTab') })}
                  className="size-5 rounded-sm"
                  onClick={() => closeTab(tab.id)}
                >
                  <XIcon className="size-3" />
                </IconBtn>
              )}
            </div>
          ))}
          <IconBtn title={t('panel.newTab')} className="mx-1 self-center" onClick={addTab}>
            <PlusIcon className="size-3.5" />
          </IconBtn>
        </div>
        <div className="relative min-h-0 flex-1">
          {tabs.map((tab) => (
            <webview
              key={`${tab.id}:${tab.id === activeId ? nonce : 0}`}
              ref={(element) => setWebviewRef(tab.id, element)}
              src={tab.src}
              partition={tab.partition}
              title={t('panel.preview')}
              className={cn(
                'absolute inset-0 size-full border-0 bg-white',
                tab.id !== activeId && 'pointer-events-none invisible',
              )}
              allowpopups
              webpreferences="contextIsolation=yes,sandbox=yes"
            />
          ))}
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------ files

/** One window for the project: the file tree on the left, the open files (as tabs) on the right. */
export function FilesPanel({ s }: { s: SessionView }) {
  const t = useT();
  const findHint = useShortcutHint('findFile');
  const findAllHint = useShortcutHint('findAll');
  const id = s.meta.id;
  const d = s.fileDetail;
  const [source, setSource] = useSourceToggle(d?.path ?? '');
  const [showTree, setShowTree] = useState(true);
  const view = useRef<ReviewHandle>(null);
  const tabList = useRef<HTMLDivElement>(null);
  const finder = useRef<HTMLInputElement>(null);
  const [find, setFind] = useState<FindScope | null>(null);
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [hit, setHit] = useState(0);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const paths = useMemo(() => s.files ?? [], [s.files]);

  useEffect(() => {
    tabList.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [d?.path]);

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
  const fileHits = useMemo(
    () => (find === 'file' && d?.text != null && !rendered ? findInText(d.text, query, caseSensitive) : []),
    [find, d?.text, rendered, query, caseSensitive],
  );
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
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [find, query, caseSensitive, id]);

  const [flat, setFlat] = useState(false);
  const fileActions = useFileActions(s, d, source, setSource);
  const listing =
    find === 'all' ? (
      <SearchResults result={result} busy={searching} onOpen={(path, line) => void openFileRef(path, line)} />
    ) : !s.files ? (
      <Empty>{t('panel.loadingFiles')}</Empty>
    ) : !paths.length ? (
      <Empty>{t('panel.noFiles')}</Empty>
    ) : (
      <PathTree
        key={String(flat)}
        flat={flat}
        className="min-h-0 flex-1"
        label={t('panel.projectFiles')}
        meta={s.meta}
        paths={paths}
        selected={d?.path}
        onOpen={(p) => void openFileRef(p)}
        onPin={(p) => pinFileTab(id, p)}
      />
    );
  const status = !query
    ? ''
    : find === 'all'
      ? searching
        ? '…'
        : `${result?.matches.length ?? 0}${result?.truncated ? '+' : ''}`
      : `${fileHits.length ? hit + 1 : 0}/${fileHits.length}${fileHits.length >= SEARCH_MAX_MATCHES ? '+' : ''}`;
  return (
    <Card
      title={
        <span className="font-mono text-muted-foreground" title={s.meta.cwd}>
          {s.meta.cwd}
        </span>
      }
      actions={[
        {
          id: 'tree',
          label: t(showTree ? 'panel.hideTree' : 'panel.showTree'),
          icon: <ListTreeIcon className="size-3.5" />,
          pressed: showTree,
          onSelect: () => setShowTree((v) => !v),
        },
        {
          id: 'find',
          label: `${t('panel.findInFiles')}  ${[findHint, findAllHint].filter(Boolean).join(' · ')}`,
          icon: <SearchIcon className="size-3.5" />,
          focusContent: true,
          onSelect: () => openFind(d ? 'file' : 'all'),
        },
      ]}
      menu={
        <>
          <DropdownMenuItem onSelect={() => setFlat((v) => !v)}>
            {flat ? <ListTreeIcon /> : <AlignJustifyIcon />}
            {t(flat ? 'panel.treeView' : 'panel.flatView')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void loadFiles(id, true)}>
            <RefreshCwIcon />
            {t('panel.refresh')}
          </DropdownMenuItem>
        </>
      }
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
            onStep={
              find === 'file'
                ? (direction) => fileHits.length && showHit(wrapIndex(hit, direction, fileHits.length))
                : undefined
            }
            onClose={closeFind}
          />
        )}
        <div className="min-h-0 flex-1">
          <TreeSplit
            id={`${id}:files-split`}
            tree={(showTree || find === 'all') && <div className="flex h-full min-h-0 flex-col">{listing}</div>}
          >
            <div className="flex h-full min-w-0 flex-col">
              {d ? (
                <>
                  <div className="panel-tabs">
                    <div ref={tabList} role="tablist" className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
                      {s.fileTabs.map((tab) => (
                        <div
                          key={tab.path}
                          role="tab"
                          data-state={tab.path === d.path ? 'active' : 'inactive'}
                          aria-selected={tab.path === d.path}
                          tabIndex={tab.path === d.path ? 0 : -1}
                          title={tab.path}
                          onClick={() => void openFileRef(tab.path)}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter' && event.key !== ' ') return;
                            event.preventDefault();
                            void openFileRef(tab.path);
                          }}
                          onDoubleClick={() => pinFileTab(id, tab.path)}
                          className="group panel-tab max-w-48 cursor-pointer"
                        >
                          <span className={cn('truncate', !tab.pinned && 'italic')}>{fname(tab.path)}</span>
                          <button
                            aria-label={t('panel.closeTab', { name: fname(tab.path) })}
                            className="shrink-0 rounded p-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-accent focus-visible:opacity-100"
                            onClick={(event) => {
                              event.stopPropagation();
                              closeFileTab(id, tab.path);
                            }}
                          >
                            <XIcon className="size-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="flex shrink-0 items-center gap-1 px-2">
                      {fileActions.map((action) => (
                        <PanelActionButton key={action.id} action={action} />
                      ))}
                    </div>
                  </div>
                  <FileBody s={s} d={d} source={source} viewRef={view} />
                </>
              ) : (
                <Empty>{t('panel.pickFile')}</Empty>
              )}
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
  for (const item of s.items)
    if (item.kind === 'group') for (const t of item.tools) if (t.kind === 'agent') out.push(t);
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
  const state = running
    ? sub?.activity || t('tasks.working')
    : t(tool.status === 'err' ? 'tasks.failed' : tool.status === 'denied' ? 'tasks.stopped' : 'tasks.completed');
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
      {sub && !tool.sh && (
        <span>
          <b className="font-medium text-foreground/80">{fmtTok(sub.tokens)}</b> {t('tasks.tokens')}
        </span>
      )}
      {sub && !tool.sh && (
        <span>
          <b className="font-medium text-foreground/80">{sub.toolUses}</b>{' '}
          {t(sub.toolUses === 1 ? 'tasks.toolUse' : 'tasks.toolUses')}
        </span>
      )}
      <span className={cn(running && 'shimmer', tool.status === 'err' && 'text-destructive')}>{state}</span>
      {onTranscript && (
        <button className="text-info hover:underline" onClick={onTranscript}>
          {t(tool.sh ? 'tasks.viewOutput' : 'tasks.viewTranscript')}
        </button>
      )}
    </div>
  );
}

export function TasksPanel({ s }: { s: SessionView }) {
  const t = useT();
  const id = s.meta.id;
  const all = agentTools(s);
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const running = all.filter((task) => task.status === 'running');
  const done = all.filter((task) => task.status !== 'running' && !cleared.has(task.id));
  useTicker(running.length > 0);
  const row = (task: ToolState) => (
    <div key={task.id} className="group rounded-lg surface-flat bg-muted/40 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" title={task.desc}>
            {task.desc}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              {task.sh ? <SquareTerminalIcon className="size-3" /> : <BotIcon className="size-3" />}
              {task.sh
                ? t('tasks.shell')
                : `${t('tasks.agent')}${task.args?.subagent_type ? ` · ${task.args.subagent_type}` : ''}`}
            </span>
            {task.sub && <span className="tabular-nums">{elapsed(task)}</span>}
          </div>
        </div>
        {task.status === 'running' ? (
          <IconBtn title={t('tasks.stop')} className="size-6 bg-card" onClick={() => void stopTask(id, task.id)}>
            <SquareIcon className="size-2.5 fill-current" />
          </IconBtn>
        ) : task.status === 'done' ? (
          <CheckIcon className="mt-0.5 size-4 text-success" />
        ) : (
          <XIcon className="mt-0.5 size-4 text-destructive" />
        )}
      </div>
      <div className="mt-1.5">
        <TaskMeta tool={task} onTranscript={() => openAgent(id, task.id)} />
      </div>
    </div>
  );
  return (
    <Card
      actions={[
        {
          id: 'clear',
          label: t('tasks.clear'),
          icon: <Trash2Icon className="size-3.5" />,
          disabled: !done.length,
          onSelect: () => setCleared(new Set(all.filter((task) => task.status !== 'running').map((task) => task.id))),
        },
      ]}
    >
      {!running.length && !done.length ? (
        <Empty>{t('tasks.empty')}</Empty>
      ) : (
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

const STEP_ICON: Record<string, typeof FileIcon> = {
  bash: SquareTerminalIcon,
  read: FileIcon,
  grep: SearchIcon,
  find: SearchIcon,
  ls: FolderIcon,
};

/** A subagent's prompt, every tool call and message it produced, then its report. */
function AgentTranscript({ s, tool, close }: { s: SessionView; tool: ToolState; close: () => void }) {
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
      title={
        <>
          <IconBtn title={t('tasks.back')} onClick={close}>
            <ArrowLeftIcon className="size-3.5" />
          </IconBtn>
          <span className="truncate">{tool.desc}</span>
          {tool.sub && (
            <span className="shrink-0 text-xs font-normal text-muted-foreground tabular-nums">{elapsed(tool)}</span>
          )}
        </>
      }
      actions={
        running
          ? [
              {
                id: 'stop',
                label: t('tasks.stop'),
                icon: <SquareIcon className="size-3 fill-current" />,
                onSelect: () => void stopTask(s.meta.id, tool.id),
              },
            ]
          : []
      }
      bodyClass="overflow-hidden"
    >
      <div ref={body} className="h-full overflow-auto">
        <div className="space-y-3 p-4">
          <TaskMeta tool={tool} />
          <div
            className={cn(
              'rounded-lg bg-muted px-3 py-2 text-xs whitespace-pre-wrap text-muted-foreground',
              tool.sh && 'font-mono',
            )}
          >
            {tool.prompt}
          </div>
          {tool.sh && (
            <pre className="max-h-[60vh] overflow-auto rounded-lg surface-flat bg-code p-3 font-mono text-xs whitespace-pre-wrap">
              {tool.sh.output || t(running ? 'tasks.waitingOutput' : 'tasks.noOutput')}
              {!running && tool.sh.exitCode != null ? '\n[exit ' + tool.sh.exitCode + ']' : ''}
            </pre>
          )}
          {shown.length > 0 && (
            <div className="space-y-1.5 border-l pl-3">
              {shown.map((step, i) => {
                if (step.kind === 'text')
                  return (
                    <div key={i} className="text-sm">
                      <Markdown text={step.text} />
                    </div>
                  );
                const Icon = STEP_ICON[step.name] ?? CodeIcon;
                return (
                  <div
                    key={i}
                    className={cn(
                      'flex min-w-0 items-center gap-2 text-xs',
                      step.status === 'err' && 'text-destructive',
                    )}
                    title={step.label}
                  >
                    <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="shrink-0 text-muted-foreground">{step.name}</span>
                    <span className={cn('truncate font-mono', step.status === 'running' && 'shimmer')}>
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {tool.sh ? null : running ? (
            <div className="text-sm">
              <span className="shimmer">{tool.sub?.activity || tool.summary || t('tasks.workingEllipsis')}</span>
            </div>
          ) : (
            <>
              {tool.summary && <div className="text-xs text-muted-foreground">{tool.summary}</div>}
              {tool.md ? (
                <Markdown text={tool.md} />
              ) : (
                !steps.length && <div className="text-sm text-muted-foreground">{t('tasks.noTranscript')}</div>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------ detail: plan, subagent, file

export function DetailPanel({ s }: { s: SessionView }) {
  const t = useT();
  const d = s.detail!;
  const id = s.meta.id;
  const { copied, copy } = useCopy();
  if (d.type === 'plan') {
    const plan = findByKey(s, d.key);
    if (plan?.kind !== 'plan') return null;
    return (
      <Card
        actions={[
          {
            id: 'copy',
            label: t(copied ? 'plan.copied' : 'plan.copy'),
            icon: <CopyGlyph copied={copied} />,
            onSelect: () => copy(plan.md),
          },
        ]}
      >
        <div className="space-y-4 p-4">
          <div className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            <MessageSquareIcon className="mt-0.5 size-3.5 shrink-0" />
            {t('plan.review')}
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
    return <AgentTranscript s={s} tool={tool} close={() => closeDetail(id)} />;
  }
  return <WorkspaceFilePanel s={s} d={d} />;
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

function useFileActions(
  s: SessionView,
  d: FileDetail | null,
  source: boolean,
  onSource: (on: boolean) => void,
): PanelAction[] {
  const t = useT();
  if (!d) return [];
  const hasDiff = s.changes.some((f) => f.path === d.path);
  const actions: PanelAction[] = [];
  if (hasRenderedView(d.path) && d.text != null)
    actions.push({
      id: 'source',
      label: t(source ? 'file.viewRendered' : 'file.viewSource'),
      icon: source ? <EyeIcon className="size-3.5" /> : <CodeIcon className="size-3.5" />,
      onSelect: () => onSource(!source),
    });
  if (hasDiff)
    actions.push({
      id: 'diff',
      label: t('file.diff'),
      icon: <FileDiffIcon className="size-3.5" />,
      onSelect: () => openDiffRef(d.path),
    });
  return actions;
}

function FileBody({
  s,
  d,
  source,
  viewRef,
}: {
  s: SessionView;
  d: FileDetail;
  source: boolean;
  viewRef?: Ref<ReviewHandle>;
}) {
  const t = useT();
  const target = useMemo(() => (d.line > FIRST_LINE ? { id: d.path, line: d.line } : null), [d.path, d.line]);
  const items = useMemo<ReviewItem[]>(
    () => (d.text != null ? [{ id: d.path, kind: 'file', path: d.path, text: d.text }] : []),
    [d.path, d.text],
  );
  if (d.loading) return <Empty>{t('file.loading')}</Empty>;
  if (d.error)
    return (
      <div className="p-4 text-sm text-destructive">
        {t('file.unable')}
        <pre className="mt-2 text-xs whitespace-pre-wrap">{d.error}</pre>
      </div>
    );
  if (d.image !== undefined) {
    return d.image ? (
      <ZoomImage
        src={d.image}
        alt={fname(d.path)}
        className="min-h-0 flex-1 bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:20px_20px] p-4"
      />
    ) : (
      <Empty>{t('file.noImage')}</Empty>
    );
  }
  if (d.media !== undefined) {
    if (!d.media) return <Empty>{t('file.noMedia')}</Empty>;
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        {d.media.kind === 'video' ? (
          // A user-supplied file preview; captions are not available.
          // oxlint-disable-next-line jsx-a11y/media-has-caption
          <video key={d.path} src={d.media.src} controls className="max-h-full max-w-full" />
        ) : (
          // oxlint-disable-next-line jsx-a11y/media-has-caption
          <audio key={d.path} src={d.media.src} controls className="w-full max-w-md" />
        )}
      </div>
    );
  }
  if (d.text == null) return <Empty>{t('file.noPreview')}</Empty>;
  if (MARKDOWN_FILE.test(d.path) && !source) {
    return (
      <SelectableContent key={d.path} sid={s.meta.id} path={d.path} className="flex-1">
        <div className="p-4">
          <Markdown text={d.text} className="text-sm" />
        </div>
      </SelectableContent>
    );
  }
  if (HTML_FILE.test(d.path) && !source) {
    return <HtmlPreview key={d.path} sid={s.meta.id} path={d.path} html={d.text} title={fname(d.path)} />;
  }
  return (
    <ReviewCodeView
      key={d.path}
      ref={viewRef}
      sid={s.meta.id}
      className="flex-1"
      items={items}
      target={target}
      hideHeader
    />
  );
}

/** A standalone file preview in the workspace. */
export function WorkspaceFilePanel({ s, d }: { s: SessionView; d: FileDetail }) {
  const [source, setSource] = useSourceToggle(d.path);
  const actions = useFileActions(s, d, source, setSource);
  return (
    <Card
      title={
        <span className="truncate font-mono text-xs" title={d.path}>
          {d.path}
        </span>
      }
      actions={actions}
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
  return items
    .slice(from + 1)
    .flatMap((item) => (item.kind === 'group' ? item.tools.filter((tool) => tool.kind === 'agent') : []));
}

/** What the model has dispatched this turn, for when it keeps no checklist. */
function Dispatched({ tasks }: { tasks: ToolState[] }) {
  return (
    <ul className="space-y-1">
      {tasks.map((task) => (
        <li key={task.id} className="flex items-center gap-2 text-sm">
          <span className="flex size-4 shrink-0 items-center justify-center">
            {task.status === 'running' ? (
              <span className="size-1.5 animate-pulse rounded-full bg-primary" />
            ) : task.status === 'done' ? (
              <CheckIcon className="size-3.5 text-muted-foreground" />
            ) : (
              <XIcon className="size-3.5 text-destructive" />
            )}
          </span>
          <span
            className={cn('min-w-0 truncate', task.status !== 'running' && 'text-muted-foreground')}
            title={task.desc}
          >
            {task.desc}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function WorkPanel({ s }: { s: SessionView }) {
  const t = useT();
  const models = useApp((st) => st.models);
  const todos = s.lastTodos;
  const tasks = todos.length ? [] : turnAgents(s.items);
  const done = todos.filter((todo) => todo.status === 'completed').length;
  const outputs = [...s.outputs].sort((a, b) => b.t - a.t);
  const id = s.meta.id;
  const folderName = s.meta.scratch ? t('progress.tempWorkspace') : fname(s.meta.cwd);
  return (
    <Card>
      <div>
        <section className="space-y-2 p-4">
          {todos.length ? (
            <TodoDisclosure className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded text-left hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                  <span>{t('progress.title')}</span>{' '}
                  <span className="ml-auto">
                    {done}/{todos.length}
                  </span>
                  <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 group-data-[state=closed]:rotate-180" />
                </CollapsibleTrigger>
              </h3>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${(done / todos.length) * 100}%` }}
                />
              </div>
              <CollapsibleContent>
                <TodoList items={todos} />
              </CollapsibleContent>
            </TodoDisclosure>
          ) : (
            <>
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {t('progress.title')}
              </h3>
              {tasks.length ? (
                <Dispatched tasks={tasks} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t(s.running ? 'progress.learning' : 'progress.multiStep')}
                </p>
              )}
            </>
          )}
        </section>
        <section className="space-y-1 p-4">
          <h3 className="flex items-center justify-between text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t('progress.files')}
            {outputs.length > 0 && <span>{outputs.length}</span>}
          </h3>
          {outputs.length ? (
            outputs.map((o) => (
              <FileContextMenu key={o.path} meta={s.meta} path={o.path}>
                <div className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent">
                  <button
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => void openFileRef(o.path)}
                  >
                    <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{fname(o.path)}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {fdir(o.path) || folderName} · {t(o.kind === 'write' ? 'progress.created' : 'progress.edited')}
                      </span>
                    </span>
                  </button>
                  {!isRemote && (
                    <IconBtn
                      title={t('progress.open')}
                      onClick={() => call('sessions:openPath', id, o.path, false).catch(fail)}
                    >
                      <ExternalLinkIcon className="size-3.5" />
                    </IconBtn>
                  )}
                  {!isRemote && (
                    <IconBtn
                      title={t('progress.reveal')}
                      onClick={() => call('sessions:openPath', id, o.path, true).catch(fail)}
                    >
                      <FolderIcon className="size-3.5" />
                    </IconBtn>
                  )}
                </div>
              </FileContextMenu>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">{t('progress.filesEmpty')}</p>
          )}
        </section>
        <section className="space-y-1 p-4">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t('progress.context')}
          </h3>
          <button
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left enabled:hover:bg-accent"
            disabled={isRemote}
            onClick={() => call('sessions:openPath', id, '.', false).catch(fail)}
          >
            <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{folderName}</span>
              <span className="block truncate text-xs text-muted-foreground">{s.meta.cwd}</span>
            </span>
          </button>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <CodeIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{modelName(models, s.model)}</span>
              <span className="block text-xs text-muted-foreground">
                {modeName(s.meta.mode)} ·{' '}
                {s.ctxPct != null ? t('progress.contextUsed', { pct: Math.round(s.ctxPct) }) : t('progress.context1')}
              </span>
            </span>
          </div>
        </section>
      </div>
    </Card>
  );
}
