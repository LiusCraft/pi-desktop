import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode, type Ref } from 'react';
import {
  ArrowLeftIcon, BotIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, ChevronsDownUpIcon, ChevronsUpDownIcon, CodeIcon, ExternalLinkIcon, FileIcon, FolderIcon,
  EyeIcon, ListIcon, Maximize2Icon, MessageSquareIcon, Minimize2Icon, RefreshCwIcon, SearchIcon, SquareIcon, SquareTerminalIcon,
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
import { Markdown } from '@/components/common/Markdown';
import { TodoList, PlanActions } from '@/components/thread/Items';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { call, isMac } from '@/lib/api';
import { contentOf, onContent, wantContent } from '@/lib/change-content';
import { fileDiffOf } from '@/lib/file-diff';
import { modeName } from '@/lib/constants';
import { firstThread } from '@/lib/diff';
import { fdir, fmtDur, fmtTok, fname } from '@/lib/format';
import type { ToolState } from '@/lib/tools';
import { cn } from '@/lib/utils';
import {
  closeDetail, closeFiles, closeFileTab, diffTarget, fail, FIND_EVENT, findTarget, loadChanges, loadFiles, openAgent, openDiffRef, openFileRef, pinFileTab, stopTask, togglePanel,
} from '@/store/actions';
import { modelName, setPref, updateSession, useApp } from '@/store/app';
import { findByKey, findTool } from '@/store/transcript';
import type { ChangedFile, SessionView } from '@/store/types';
import { FindBar, SearchResults, type FindScope } from './FindBar';
import { PathTree, type PathStatus } from './PathTree';

// ------------------------------------------------------------ card chrome

export interface CardProps {
  expanded: boolean;
  onExpand: () => void;
}

export function Card({ title, tools, children, onClose, expanded, onExpand, bodyClass }: CardProps & {
  title: ReactNode;
  tools?: ReactNode;
  children: ReactNode;
  onClose?: () => void;
  bodyClass?: string;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card">
      <header className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1 text-sm font-medium">{title}</div>
        {tools}
        <IconBtn title={expanded ? 'Restore' : 'Expand'} onClick={onExpand}>
          {expanded ? <Minimize2Icon className="size-3.5" /> : <Maximize2Icon className="size-3.5" />}
        </IconBtn>
        {onClose && (
          <IconBtn title="Close" onClick={onClose}>
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

const GENERATED_LABEL: Record<GeneratedKind, string> = { lockfile: 'lockfile', minified: 'minified bundle', sourcemap: 'source map' };

const STATUS_OF_CHANGE: Record<ChangedFile['status'], PathStatus> = { A: 'added', M: 'modified', D: 'deleted' };

export function DiffPanel({ s, ...card }: CardProps & { s: SessionView }) {
  // Generated files start collapsed; `flipped` holds the user's per-file overrides.
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const [showTree, setShowTree] = useState(true);
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
  }, [id, s.changes]);
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
  const open = (p: string) => {
    const f = [...byPath.values()].find((x) => x.path === p || p.endsWith('/' + x.path) || x.path.endsWith(p));
    if (!f) return false;
    setFlipped((c) => { const n = new Set(c); if (isGeneratedFile(f.path)) n.add(f.path); else n.delete(f.path); return n; });
    setActive(f.path);
    requestAnimationFrame(() => review.current?.scrollToItem(f.path));
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
    const target = diffTarget.path;
    if (!open(target)) void loadChanges(id).then(() => requestAnimationFrame(() => open(target)));
    diffTarget.path = null;
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
    if (isBinary(f)) return { text: 'binary' };
    return { text: `+${f.add} −${f.del}`, parts: [{ text: `+${f.add}`, color: 'var(--success)' }, { text: ` −${f.del}`, color: 'var(--destructive)' }] };
  };

  const title = (
    <span className="flex min-w-0 items-center gap-1.5 text-sm font-normal">
      <span className="truncate">{s.meta.baseBranch || 'base'}</span>
      <span className="text-muted-foreground">→</span>
      <span className="truncate">{s.meta.branch || fname(s.meta.cwd)}</span>
    </span>
  );
  const tools = (
    <>
      <IconBtn title={`Find in the diff  ${findHint}`} onClick={openFind}><SearchIcon className="size-3.5" /></IconBtn>
      <IconBtn title={allCollapsed ? 'Expand all' : 'Collapse all'} onClick={() => setAllCollapsed(!allCollapsed)}>
        {allCollapsed ? <ChevronsUpDownIcon className="size-3.5" /> : <ChevronsDownUpIcon className="size-3.5" />}
      </IconBtn>
      <IconBtn title="Refresh" onClick={() => { setFlipped(new Set()); void loadChanges(id); }}><RefreshCwIcon className="size-3.5" /></IconBtn>
      <OpenInMenu id={id}><IconBtn title="Open in…"><ExternalLinkIcon className="size-3.5" /></IconBtn></OpenInMenu>
    </>
  );
  const treeToggle = (
    <IconBtn title={showTree ? 'Hide changed files' : 'Show changed files'} aria-pressed={showTree} className={cn(showTree && 'bg-info/15 text-info hover:bg-info/20 hover:text-info')} onClick={() => setShowTree((v) => !v)}>
      <ListIcon className="size-4" />
    </IconBtn>
  );
  let content: ReactNode;
  if (!s.meta.baseCommit) content = <Empty>{'这个项目不是 git 仓库\n初始化 git 后即可查看 Pi Desktop 的改动'}</Empty>;
  else if (!s.changes.length) content = <Empty>{'No changes yet\nPi Desktop 修改的文件会出现在这里'}</Empty>;
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
            placeholder="在改动中查找"
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
              <nav className="h-full overflow-y-auto p-1.5" aria-label="Commits">
                <div className="px-2 py-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Commits · {commits.length}</div>
                <button
                  className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] hover:bg-accent', !commit && 'bg-accent')}
                  onClick={() => void pickCommit(null)}
                >
                  <span className="truncate">All changes</span>
                </button>
                {commits.map((c) => (
                  <button
                    key={c.hash}
                    title={`${c.short} · ${c.author} · ${new Date(c.date).toLocaleString()}
${c.subject}`}
                    onClick={() => void pickCommit(c)}
                    className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] hover:bg-accent', commit?.hash === c.hash && 'bg-accent')}
                  >
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{c.short}</span>
                    <span className="min-w-0 flex-1 truncate">{c.subject}</span>
                  </button>
                ))}
              </nav>
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        )}
      >
        <div className="relative h-full min-w-0">
          {files.length === 0 && <Empty>这个提交没有文件改动</Empty>}
          <ReviewCodeView
            ref={review}
            className="h-full"
            sid={id}
            items={items}
            threads={s.prThreads}
            onNeed={need}
            onActiveChange={setActive}
            renderPrefix={(item) => (
              <button className="flex items-center text-muted-foreground hover:text-foreground" aria-expanded={!isCollapsed(item.path)} title={isCollapsed(item.path) ? 'Show diff' : 'Hide diff'} onClick={() => toggle(item.path)}>
                {isCollapsed(item.path) ? <ChevronRightIcon className="size-3.5" /> : <ChevronDownIcon className="size-3.5" />}
              </button>
            )}
            renderMetadata={(item) => {
              const gen = generatedKind(item.path);
              return (
                <span className="flex items-center gap-1.5">
                  {gen && <span title={`Generated ${GENERATED_LABEL[gen]}`} className="text-[10px] font-medium tracking-wide text-muted-foreground/70">gen</span>}
                  {byPath.get(item.path)?.status !== 'D' && (
                    <IconBtn title="Open file" className="size-6" onClick={() => void openFileRef(item.path)}><CodeIcon className="size-3.5" /></IconBtn>
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
  const saved = useApp((st) => st.prefs.previewUrl);
  const url = s.previewUrl || saved;
  const [value, setValue] = useState(url);
  const [nonce, setNonce] = useState(0);
  useEffect(() => setValue(url), [url]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    let u = value.trim();
    if (!/^https?:\/\//.test(u)) u = `http://${u}`;
    if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)) return void toast.warning('预览只支持 localhost');
    updateSession(s.meta.id, (v) => void (v.previewUrl = u));
    setPref('previewUrl', u);
  };
  return (
    <Card
      {...card}
      title={
        <form onSubmit={submit} className="flex-1">
          <Input value={value} onChange={(e) => setValue(e.target.value)} aria-label="Preview URL" spellCheck={false} className="h-7 font-mono text-xs" />
        </form>
      }
      tools={<IconBtn title="Reload" onClick={() => setNonce((n) => n + 1)}><RefreshCwIcon className="size-3.5" /></IconBtn>}
      onClose={() => togglePanel(s.meta.id, 'preview', false)}
      bodyClass="overflow-hidden"
    >
      <iframe key={`${url}#${nonce}`} src={url} title="Preview" className="size-full border-0 bg-white" sandbox="allow-scripts allow-forms allow-same-origin" />
    </Card>
  );
}

// ------------------------------------------------------------ files

type FileDetail = Extract<NonNullable<SessionView['detail']>, { type: 'file' }>;

/** One window for the project: the file tree on the left, the open files (as tabs) on the right. */
export function FilesPanel({ s, ...card }: CardProps & { s: SessionView }) {
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
  const rendered = !!d && HTML_FILE.test(d.path) && !source;
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

  const treeToggle = (
    <IconBtn title={showTree ? 'Hide file tree' : 'Show file tree'} aria-pressed={showTree} className={cn(showTree && 'bg-info/15 text-info hover:bg-info/20 hover:text-info')} onClick={() => setShowTree((v) => !v)}>
      <ListIcon className="size-4" />
    </IconBtn>
  );
  const listing = find === 'all'
    ? <SearchResults result={result} busy={searching} onOpen={(path, line) => void openFileRef(path, line)} />
    : !s.files ? <Empty>Loading files…</Empty> : !paths.length ? <Empty>No files</Empty> : (
      <PathTree
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
      title={<>{treeToggle}<span>Files</span></>}
      tools={(
        <>
          <IconBtn title={`Find in files  ${findHint} · ${isMac ? '⇧⌘' : 'Ctrl+Shift+'}F`} onClick={() => openFind(d ? 'file' : 'all')}><SearchIcon className="size-3.5" /></IconBtn>
          <IconBtn title="Refresh" onClick={() => void loadFiles(id, true)}><RefreshCwIcon className="size-3.5" /></IconBtn>
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
            placeholder={find === 'all' ? '在所有文件中搜索' : '在当前文件中查找'}
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
                            aria-label={`Close ${fname(tab.path)}`}
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
              ) : <Empty>{'选择左侧的文件来预览\n双击保留标签页'}</Empty>}
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
  const sub = tool.sub;
  const running = tool.status === 'running';
  const state = running ? sub?.activity || 'Working' : tool.status === 'err' ? 'Failed' : tool.status === 'denied' ? 'Stopped' : 'Completed';
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
      {sub && !tool.sh && <span><b className="font-medium text-foreground/80">{fmtTok(sub.tokens)}</b> tokens</span>}
      {sub && !tool.sh && <span><b className="font-medium text-foreground/80">{sub.toolUses}</b> tool use{sub.toolUses === 1 ? '' : 's'}</span>}
      <span className={cn(running && 'shimmer', tool.status === 'err' && 'text-destructive')}>{state}</span>
      {onTranscript && <button className="text-info hover:underline" onClick={onTranscript}>{tool.sh ? 'View output' : 'View transcript'}</button>}
    </div>
  );
}

export function TasksPanel({ s, ...card }: CardProps & { s: SessionView }) {
  const id = s.meta.id;
  const all = agentTools(s);
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const running = all.filter((t) => t.status === 'running');
  const done = all.filter((t) => t.status !== 'running' && !cleared.has(t.id));
  useTicker(running.length > 0);
  const row = (t: ToolState) => (
    <div key={t.id} className="group rounded-lg border bg-muted/40 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" title={t.desc}>{t.desc}</div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">{t.sh ? <SquareTerminalIcon className="size-3" /> : <BotIcon className="size-3" />}{t.sh ? 'Shell' : `Agent${t.args?.subagent_type ? ` · ${t.args.subagent_type}` : ''}`}</span>
            {t.sub && <span className="tabular-nums">{elapsed(t)}</span>}
          </div>
        </div>
        {t.status === 'running' ? (
          <IconBtn title="Stop this task" className="size-6 border bg-card" onClick={() => void stopTask(id, t.id)}><SquareIcon className="size-2.5 fill-current" /></IconBtn>
        ) : t.status === 'done' ? <CheckIcon className="mt-0.5 size-4 text-success" /> : <XIcon className="mt-0.5 size-4 text-destructive" />}
      </div>
      <div className="mt-1.5"><TaskMeta tool={t} onTranscript={() => openAgent(id, t.id)} /></div>
    </div>
  );
  return (
    <Card
      {...card}
      title="Background tasks"
      tools={<IconBtn title="Clear finished tasks" disabled={!done.length} className="disabled:opacity-40" onClick={() => setCleared(new Set(all.filter((t) => t.status !== 'running').map((t) => t.id)))}><Trash2Icon className="size-3.5" /></IconBtn>}
      onClose={() => togglePanel(id, 'tasks', false)}
    >
      {!running.length && !done.length ? <Empty>{'No background tasks\nSubagents and shell commands Pi Desktop runs in the background show up here'}</Empty> : (
        <div className="space-y-4 p-3">
          {running.length > 0 && (
            <section className="space-y-2">
              <h3 className="px-0.5 text-xs text-muted-foreground">Running</h3>
              {running.map(row)}
            </section>
          )}
          {done.length > 0 && (
            <section className="space-y-2">
              <h3 className="px-0.5 text-xs text-muted-foreground">Finished</h3>
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
      title={<><IconBtn title="Back" onClick={close}><ArrowLeftIcon className="size-3.5" /></IconBtn><span className="truncate">{tool.desc}</span>{tool.sub && <span className="shrink-0 text-xs font-normal text-muted-foreground tabular-nums">{elapsed(tool)}</span>}</>}
      tools={running && <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => void stopTask(s.meta.id, tool.id)}>Stop</Button>}
      onClose={close}
      bodyClass="overflow-hidden"
    >
      <div ref={body} className="h-full overflow-auto">
        <div className="space-y-3 p-4">
          <TaskMeta tool={tool} />
          <div className={cn('rounded-lg bg-muted px-3 py-2 text-xs whitespace-pre-wrap text-muted-foreground', tool.sh && 'font-mono')}>{tool.prompt}</div>
          {tool.sh && <pre className="max-h-[60vh] overflow-auto rounded-lg border bg-card p-3 font-mono text-xs whitespace-pre-wrap">{tool.sh.output || (running ? 'Waiting for output…' : 'No output')}{!running && tool.sh.exitCode != null ? '\n[exit ' + tool.sh.exitCode + ']' : ''}</pre>}
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
          {tool.sh ? null : running ? <div className="text-sm"><span className="shimmer">{tool.sub?.activity || tool.summary || 'Working…'}</span></div> : (
            <>
              {tool.summary && <div className="text-xs text-muted-foreground">{tool.summary}</div>}
              {tool.md ? <Markdown text={tool.md} /> : !steps.length && <div className="text-sm text-muted-foreground">No transcript was recorded for this task.</div>}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------ detail: plan, subagent, file

export function DetailPanel({ s, ...card }: CardProps & { s: SessionView }) {
  const d = s.detail!;
  const id = s.meta.id;
  const close = () => closeDetail(id);
  const { copied, copy } = useCopy();
  if (d.type === 'plan') {
    const plan = findByKey(s, d.key);
    if (plan?.kind !== 'plan') return null;
    return (
      <Card {...card} title="Plan" onClose={close} tools={<IconBtn title={copied ? 'Copied' : 'Copy plan'} onClick={() => copy(plan.md)}><CopyGlyph copied={copied} /></IconBtn>}>
        <div className="space-y-4 p-4">
          <div className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            <MessageSquareIcon className="mt-0.5 size-3.5 shrink-0" />Review the plan. Approve it to let Pi Desktop start, or keep planning and reply with changes.
          </div>
          <Markdown text={plan.md || '_Waiting for the plan…_'} />
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
/** A file opens at its top; only a line past the first is a place to jump to. */
const FIRST_LINE = 1;

/** An HTML file opens rendered; the toggle brings the source back. A new file starts rendered again. */
function useSourceToggle(path: string) {
  const [source, setSource] = useState(false);
  useEffect(() => setSource(false), [path]);
  return [source, setSource] as const;
}

function FileTools({ s, d, source, onSource }: { s: SessionView; d: FileDetail; source: boolean; onSource: (on: boolean) => void }) {
  const hasDiff = s.changes.some((f) => f.path === d.path);
  return (
    <>
      {HTML_FILE.test(d.path) && d.text != null && (
        <IconBtn title={source ? '查看渲染效果' : '查看源码'} onClick={() => onSource(!source)}>{source ? <EyeIcon className="size-3.5" /> : <CodeIcon className="size-3.5" />}</IconBtn>
      )}
      {hasDiff && <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => openDiffRef(d.path)}>Diff</Button>}
    </>
  );
}

function FileBody({ s, d, source, viewRef }: { s: SessionView; d: FileDetail; source: boolean; viewRef?: Ref<ReviewHandle> }) {
  const target = useMemo(() => (d.line > FIRST_LINE ? { id: d.path, line: d.line } : null), [d.path, d.line]);
  const items = useMemo<ReviewItem[]>(() => (d.text != null ? [{ id: d.path, kind: 'file', path: d.path, text: d.text }] : []), [d.path, d.text]);
  if (d.loading) return <Empty>Loading current file…</Empty>;
  if (d.error) return <div className="p-4 text-sm text-destructive">Unable to open current file.<pre className="mt-2 text-xs whitespace-pre-wrap">{d.error}</pre></div>;
  if (d.image !== undefined) {
    return d.image ? (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:20px_20px] p-4">
        <img src={d.image} alt={fname(d.path)} className="max-h-full max-w-full object-contain shadow-sm" />
      </div>
    ) : <Empty>{'Image preview unavailable\nNot a supported image, outside the session folder, or larger than 20 MiB'}</Empty>;
  }
  if (d.text == null) return <Empty>{'File preview unavailable\nBinary, non-text, or larger than 1 MiB'}</Empty>;
  if (HTML_FILE.test(d.path) && !source) {
    return <iframe key={d.path} srcDoc={d.text} title={fname(d.path)} className="min-h-0 flex-1 border-0 bg-white" sandbox="allow-scripts" />;
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

export function WorkPanel({ s, ...card }: CardProps & { s: SessionView }) {
  const models = useApp((st) => st.models);
  const todos = s.lastTodos;
  const done = todos.filter((t) => t.status === 'completed').length;
  const outputs = [...s.outputs].sort((a, b) => b.t - a.t);
  const id = s.meta.id;
  const folderName = s.meta.scratch ? 'Temporary workspace' : fname(s.meta.cwd);
  return (
    <Card {...card} title="Progress" onClose={() => togglePanel(id, 'progress', false)}>
      <div className="divide-y">
        <section className="space-y-2 p-4">
          <h3 className="flex items-center justify-between text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Progress{todos.length > 0 && <span>{done}/{todos.length}</span>}
          </h3>
          {todos.length ? (
            <>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(done / todos.length) * 100}%` }} /></div>
              <TodoList items={todos} />
            </>
          ) : <p className="text-sm text-muted-foreground">{s.running ? 'Pi Desktop 正在了解任务…' : '多步骤的任务会在这里显示进度。'}</p>}
        </section>
        <section className="space-y-1 p-4">
          <h3 className="flex items-center justify-between text-xs font-semibold tracking-wide text-muted-foreground uppercase">Files{outputs.length > 0 && <span>{outputs.length}</span>}</h3>
          {outputs.length ? outputs.map((o) => (
            <div key={o.path} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent">
              <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => void openFileRef(o.path)}>
                <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{fname(o.path)}</span>
                  <span className="block truncate text-xs text-muted-foreground">{fdir(o.path) || folderName} · {o.kind === 'write' ? 'created' : 'edited'}</span>
                </span>
              </button>
              <IconBtn title="Open" onClick={() => call('sessions:openPath', id, o.path, false).catch(fail)}><ExternalLinkIcon className="size-3.5" /></IconBtn>
              <IconBtn title="Show in folder" onClick={() => call('sessions:openPath', id, o.path, true).catch(fail)}><FolderIcon className="size-3.5" /></IconBtn>
            </div>
          )) : <p className="text-sm text-muted-foreground">Pi Desktop 创建或修改的文件会出现在这里。</p>}
        </section>
        <section className="space-y-1 p-4">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Context</h3>
          <button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent" onClick={() => call('sessions:openPath', id, '.', false).catch(fail)}>
            <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0"><span className="block truncate text-sm font-medium">{folderName}</span><span className="block truncate text-xs text-muted-foreground">{s.meta.cwd}</span></span>
          </button>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <CodeIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0"><span className="block truncate text-sm font-medium">{modelName(models, s.model)}</span><span className="block text-xs text-muted-foreground">{modeName(s.meta.mode)} · {s.ctxPct != null ? `${Math.round(s.ctxPct)}% context used` : 'context'}</span></span>
          </div>
        </section>
      </div>
    </Card>
  );
}
