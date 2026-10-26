import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeftIcon, BotIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, CodeIcon, ExternalLinkIcon, FileCodeIcon, FileIcon, FolderIcon,
  FolderOpenIcon, ListIcon, Maximize2Icon, MessageSquareIcon, Minimize2Icon, RefreshCwIcon, SearchIcon, SquareIcon, SquareTerminalIcon,
  Trash2Icon, XIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { generatedKind, isGeneratedFile, type GeneratedKind } from '@shared/generated';
import { lineWindow, WINDOW_LINES } from '@shared/tool-previews';
import { CodeLines, DiffRows, TermOutput } from '@/components/common/CodeView';
import { CopyGlyph, useCopy } from '@/components/common/Copy';
import { Markdown } from '@/components/common/Markdown';
import { TodoList, PlanActions } from '@/components/thread/Items';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { call } from '@/lib/api';
import { modeName } from '@/lib/constants';
import { fdir, fmtDur, fmtTok, fname } from '@/lib/format';
import type { ToolState } from '@/lib/tools';
import { cn } from '@/lib/utils';
import {
  closeDetail, diffTarget, fail, loadChanges, loadFiles, openAgent, openDiffRef, openFileRef, runTerminal, setFileWindow, stopTask, togglePanel,
} from '@/store/actions';
import { modelName, setPref, updateSession, useApp } from '@/store/app';
import { findByKey, findTool } from '@/store/transcript';
import type { SessionView } from '@/store/types';
import { FileContextMenu } from './FileContextMenu';

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

// ------------------------------------------------------------ diff

const GENERATED_LABEL: Record<GeneratedKind, string> = { lockfile: 'lockfile', minified: 'minified bundle', sourcemap: 'source map' };

/** Shown instead of diff rows for a generated file the user has not asked to see. */
function GeneratedNote({ kind, onReveal }: { kind: GeneratedKind; onReveal: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground">
      <FileIcon className="size-3.5 shrink-0" />
      <span>Generated {GENERATED_LABEL[kind]} · diff hidden by default</span>
      <Button size="xs" variant="outline" onClick={onReveal}>Show diff</Button>
    </div>
  );
}

export function DiffPanel({ s, ...card }: CardProps & { s: SessionView }) {
  // Generated files start collapsed; `flipped` holds the user's per-file overrides.
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [closedDirs, setClosedDirs] = useState<Set<string>>(new Set());
  const [gaps, setGaps] = useState<Set<string>>(new Set());
  const [showTree, setShowTree] = useState(true);
  const [active, setActive] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const id = s.meta.id;
  const scrollTo = (p: string) => {
    const el = [...(body.current?.querySelectorAll<HTMLElement>('[data-path]') ?? [])].find((x) => x.dataset.path === p || p.endsWith('/' + x.dataset.path) || x.dataset.path!.endsWith(p));
    if (!el || !body.current) return false;
    body.current.scrollTop = el.offsetTop;
    setActive(el.dataset.path!);
    return true;
  };
  const isCollapsed = (path: string) => isGeneratedFile(path) !== flipped.has(path);
  const toggle = (path: string) => setFlipped((c) => { const n = new Set(c); if (n.has(path)) n.delete(path); else n.add(path); return n; });
  // "View diff" on a tool row is an explicit request, so it expands and reveals.
  const open = (p: string) => {
    if (isGeneratedFile(p)) {
      setFlipped((c) => new Set(c).add(p));
      setRevealed((r) => new Set(r).add(p));
    } else setFlipped((c) => { const n = new Set(c); n.delete(p); return n; });
    requestAnimationFrame(() => scrollTo(p));
  };
  // "View diff" on a tool row jumps here.
  useEffect(() => {
    if (!diffTarget.path) return;
    const target = diffTarget.path;
    open(target);
    if (!scrollTo(target)) void loadChanges(id).then(() => requestAnimationFrame(() => scrollTo(target)));
    diffTarget.path = null;
  }, [diffTarget.seq, s.changes.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // The file whose header has scrolled past the top is the one the tree highlights.
  const onScroll = () => {
    const el = body.current;
    if (!el) return;
    let current: string | null = null;
    for (const f of el.querySelectorAll<HTMLElement>('[data-path]')) {
      if (f.offsetTop - el.scrollTop > 8) break;
      current = f.dataset.path!;
    }
    setActive(current ?? s.changes[0]?.path ?? null);
  };

  // Changed files grouped by folder, root files first.
  const dirs = useMemo(() => {
    const map = new Map<string, typeof s.changes>();
    for (const f of s.changes) {
      const d = fdir(f.path);
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(f);
    }
    return [...map.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  }, [s.changes]);

  const title = (
    <span className="flex min-w-0 items-center gap-1.5 text-sm font-normal">
      <span className="truncate">{s.meta.baseBranch || 'base'}</span>
      <span className="text-muted-foreground">→</span>
      <span className="truncate">{s.meta.branch || fname(s.meta.cwd)}</span>
    </span>
  );
  const tools = (
    <>
      <IconBtn title="Search files" onClick={() => togglePanel(id, 'files', true)}><SearchIcon className="size-3.5" /></IconBtn>
      <IconBtn title="Refresh" onClick={() => { setGaps(new Set()); setFlipped(new Set()); setRevealed(new Set()); void loadChanges(id); }}><RefreshCwIcon className="size-3.5" /></IconBtn>
      <IconBtn title="Open in VS Code" onClick={() => call('sessions:openIn', id, 'vscode').catch(fail)}><ExternalLinkIcon className="size-3.5" /></IconBtn>
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
    const genTag = (path: string) => {
      const gen = generatedKind(path);
      return gen ? <span title={`Generated ${GENERATED_LABEL[gen]}`} className="shrink-0 text-[10px] font-medium tracking-wide text-muted-foreground/70">gen</span> : null;
    };
    const fileRow = (f: (typeof s.changes)[number]) => (
      <FileContextMenu key={f.path} meta={s.meta} path={f.path} snapshot={f.status === 'D' ? f.before ?? '' : undefined}>
      <button
        title={f.path}
        onClick={() => open(f.path)}
        className={cn('flex w-full items-center gap-2 rounded-md py-1 pr-2 pl-2 text-left text-[13px] hover:bg-accent', active === f.path && 'bg-accent')}
      >
        <FileCodeIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className={cn('min-w-0 flex-1 truncate', f.status === 'D' && 'line-through opacity-70')}>{fname(f.path)}</span>
        {genTag(f.path)}
        <span className="shrink-0 font-mono text-xs"><span className="text-success">+{f.add}</span> <span className="text-destructive">−{f.del}</span></span>
      </button>
      </FileContextMenu>
    );
    content = (
      <div className="flex h-full min-h-0">
        {showTree && (
          <nav className="w-[38%] max-w-72 min-w-44 shrink-0 overflow-y-auto border-r p-1.5" aria-label="Changed files">
            {dirs.map(([dir, files]) => dir === '' ? files.map((f) => fileRow(f)) : (
              <div key={dir}>
                <FileContextMenu meta={s.meta} path={dir} directory>
                <button
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[13px] hover:bg-accent"
                  title={dir}
                  onClick={() => setClosedDirs((c) => { const n = new Set(c); if (n.has(dir)) n.delete(dir); else n.add(dir); return n; })}
                >
                  {closedDirs.has(dir) ? <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />}
                  <span className="truncate">{dir}</span>
                </button>
                </FileContextMenu>
                {!closedDirs.has(dir) && <div className="ml-3.5 border-l">{files.map((f) => fileRow(f))}</div>}
              </div>
            ))}
          </nav>
        )}
        <div ref={body} onScroll={onScroll} className="relative min-w-0 flex-1 overflow-auto">
          {s.changes.map((f) => {
            const gen = generatedKind(f.path);
            return (
              <section key={f.path} data-path={f.path}>
                <div className="group sticky top-0 z-10 flex items-center gap-2 border-b bg-card px-3 py-2 text-[13px]">
                  <button
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    aria-expanded={!isCollapsed(f.path)}
                    onClick={() => toggle(f.path)}
                  >
                    {isCollapsed(f.path) ? <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />}
                    <FileCodeIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="shrink-0 font-medium">{fname(f.path)}</span>
                    {fdir(f.path) && <span className="truncate text-muted-foreground">{fdir(f.path)}</span>}
                    <span className="shrink-0 font-mono text-xs"><span className="text-success">+{f.add}</span> <span className="text-destructive">−{f.del}</span></span>
                    {f.status === 'A' && <span className="shrink-0 text-[10px] font-semibold text-success">NEW</span>}
                    {f.status === 'D' && <span className="shrink-0 text-[10px] font-semibold text-destructive">DELETED</span>}
                    {genTag(f.path)}
                  </button>
                  {f.status !== 'D' && (
                    <IconBtn title="Open file" className="size-6 opacity-0 group-hover:opacity-100" onClick={() => void openFileRef(f.path)}><CodeIcon className="size-3.5" /></IconBtn>
                  )}
                </div>
                {!isCollapsed(f.path) && (f.binary ? <div className="px-3 py-2 text-xs text-muted-foreground">Binary or large file</div> : gen && !revealed.has(f.path) ? (
                  <GeneratedNote kind={gen} onReveal={() => setRevealed((r) => new Set(r).add(f.path))} />
                ) : (
                  <DiffRows sid={id} wrap before={f.before} after={f.status === 'D' ? null : f.after} path={f.path} openGaps={gaps} onOpenGap={(g) => setGaps((x) => new Set(x).add(g))} />
                ))}
              </section>
            );
          })}
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

export function FilesPanel({ s, ...card }: CardProps & { s: SessionView }) {
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const id = s.meta.id;
  const rows = useMemo(() => {
    if (!s.files) return [];
    const q = filter.toLowerCase();
    type Node = { path: string; name: string; depth: number; folder: boolean; children: string[] };
    const tree = new Map<string, Node>();
    for (const path of s.files.filter((p) => !q || p.toLowerCase().includes(q))) {
      const bits = path.split('/');
      for (let i = 1; i <= bits.length; i++) {
        const key = bits.slice(0, i).join('/');
        if (!tree.has(key)) tree.set(key, { path: key, name: bits[i - 1], depth: i - 1, folder: i < bits.length, children: [] });
        if (i > 1) {
          const parent = tree.get(bits.slice(0, i - 1).join('/'))!;
          if (!parent.children.includes(key)) parent.children.push(key);
        }
      }
    }
    const out: Node[] = [];
    const visit = (nodes: Node[]) => {
      nodes.sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name));
      for (const node of nodes) {
        out.push(node);
        if (node.folder && (q || open.has(node.path))) visit(node.children.map((k) => tree.get(k)!));
      }
    };
    visit([...tree.values()].filter((n) => !n.depth));
    return out;
  }, [s.files, filter, open]);
  return (
    <Card
      {...card}
      title="Files"
      tools={<IconBtn title="Refresh" onClick={() => void loadFiles(id, true)}><RefreshCwIcon className="size-3.5" /></IconBtn>}
      onClose={() => togglePanel(id, 'files', false)}
      bodyClass="flex flex-col overflow-hidden"
    >
      <div className="border-b p-2">
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter files" aria-label="Filter files" spellCheck={false} className="h-7 text-xs" autoFocus />
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {!s.files ? <Empty>Loading files…</Empty> : !rows.length ? <Empty>No matching files</Empty> : rows.map((node) => {
          const expanded = !!filter || open.has(node.path);
          return (
            <FileContextMenu key={node.path} meta={s.meta} path={node.path} directory={node.folder}>
            <button
              title={node.path}
              aria-expanded={node.folder ? expanded : undefined}
              style={{ paddingLeft: 8 + node.depth * 14 }}
              className="flex w-full items-center gap-1.5 py-[3px] pr-2 text-left text-[13px] hover:bg-accent"
              onClick={() => (node.folder ? setOpen((o) => { const n = new Set(o); if (n.has(node.path)) n.delete(node.path); else n.add(node.path); return n; }) : void openFileRef(node.path))}
            >
              {node.folder ? (expanded ? <ChevronDownIcon className="size-3 shrink-0" /> : <ChevronRightIcon className="size-3 shrink-0" />) : <span className="w-3 shrink-0" />}
              {node.folder ? (expanded ? <FolderOpenIcon className="size-3.5 shrink-0 text-muted-foreground" /> : <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />) : <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />}
              <span className="truncate">{node.name}</span>
            </button>
            </FileContextMenu>
          );
        })}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------ terminal

export function TerminalPanel({ s, ...card }: CardProps & { s: SessionView }) {
  const [cmd, setCmd] = useState('');
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    body.current?.scrollTo({ top: body.current.scrollHeight });
  }, [s.term]);
  return (
    <Card
      {...card}
      title={<>Terminal <span className="truncate font-mono text-xs font-normal text-muted-foreground">{s.meta.cwd}</span></>}
      onClose={() => togglePanel(s.meta.id, 'terminal', false)}
      bodyClass="flex flex-col overflow-hidden bg-code"
    >
      <div ref={body} className="min-h-0 flex-1 overflow-auto">
        {s.term.length ? s.term.map((t, i) => <TermOutput key={i} cmd={t.cmd} out={t.out} />) : (
          <div className="p-3 text-xs text-muted-foreground">Pi Desktop 运行的命令会显示在这里。也可以在下面输入命令，输出会加入对话上下文。</div>
        )}
      </div>
      <form
        className="flex items-center gap-2 border-t px-3 py-2 font-mono text-xs"
        onSubmit={(e) => {
          e.preventDefault();
          if (!cmd.trim()) return;
          void runTerminal(s.meta.id, cmd.trim());
          setCmd('');
        }}
      >
        <span className="text-primary">❯</span>
        <input value={cmd} onChange={(e) => setCmd(e.target.value)} aria-label="Run a terminal command" placeholder={`Run a command in ${fname(s.meta.cwd)}`} spellCheck={false} className="flex-1 bg-transparent outline-none" />
      </form>
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

function FileViewer({ s, ...card }: CardProps & { s: SessionView }) {
  const d = s.detail as Extract<NonNullable<SessionView['detail']>, { type: 'file' }>;
  const body = useRef<HTMLDivElement>(null);
  const view = d.text != null ? lineWindow(d.text, d.line, d.start) : null;
  const hasDiff = s.changes.some((f) => f.path === d.path);
  useEffect(() => {
    const el = body.current?.querySelector<HTMLElement>('.code-row.target');
    if (el && body.current) body.current.scrollTop = el.offsetTop - 65;
    else body.current?.scrollTo({ top: 0 });
  }, [d.path, d.line, d.start, d.loading]);
  const nav = view && (
    <div className="flex items-center justify-between border-b px-3 py-1 text-xs text-muted-foreground">
      <Button variant="ghost" size="sm" className="h-6 text-xs" disabled={view.previous == null} onClick={() => setFileWindow(s.meta.id, view.previous!)}>Previous lines</Button>
      <span>Lines {view.startLine}–{view.endLine} of {view.totalLines}</span>
      <Button variant="ghost" size="sm" className="h-6 text-xs" disabled={view.next == null} onClick={() => setFileWindow(s.meta.id, view.next!)}>Next lines</Button>
    </div>
  );
  return (
    <Card
      {...card}
      title={<span className="truncate font-mono text-xs" title={d.path}>{d.path}</span>}
      tools={hasDiff && <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => openDiffRef(d.path)}>Diff</Button>}
      onClose={() => closeDetail(s.meta.id)}
      bodyClass="overflow-hidden flex flex-col"
    >
      {d.loading ? <Empty>Loading current file…</Empty> : d.error ? (
        <div className="p-4 text-sm text-destructive">Unable to open current file.<pre className="mt-2 text-xs whitespace-pre-wrap">{d.error}</pre></div>
      ) : d.image !== undefined ? (
        d.image ? (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:20px_20px] p-4">
            <img src={d.image} alt={fname(d.path)} className="max-h-full max-w-full object-contain shadow-sm" />
          </div>
        ) : <Empty>{'Image preview unavailable\nNot a supported image, outside the session folder, or larger than 20 MiB'}</Empty>
      ) : !view ? <Empty>{'File preview unavailable\nBinary, non-text, or larger than 1 MiB'}</Empty> : (
        <>
          {nav}
          <div ref={body} className="relative min-h-0 flex-1 overflow-auto">
            {d.line > view.totalLines && <div className="px-3 py-1.5 text-xs text-muted-foreground">Requested line {d.line} is beyond the current file ({view.totalLines} lines). Showing the last line.</div>}
            <CodeLines sid={s.meta.id} lines={view.lines} path={d.path} startLine={view.startLine} target={view.targetLine} limit={WINDOW_LINES} />
          </div>
        </>
      )}
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
