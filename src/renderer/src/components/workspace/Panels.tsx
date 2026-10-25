import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeftIcon, ChevronDownIcon, ChevronRightIcon, CodeIcon, CopyIcon, ExternalLinkIcon, FileIcon, FolderIcon, FolderOpenIcon,
  ListIcon, Maximize2Icon, MessageSquareIcon, Minimize2Icon, RefreshCwIcon, SearchIcon, XIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { lineWindow, WINDOW_LINES } from '@shared/tool-previews';
import { CodeLines, DiffRows, TermOutput } from '@/components/common/CodeView';
import { Markdown } from '@/components/common/Markdown';
import { TodoList, PlanActions } from '@/components/thread/Items';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { call } from '@/lib/api';
import { modeName } from '@/lib/constants';
import { fdir, fname } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  closeDetail, diffTarget, fail, loadChanges, loadFiles, openDiffRef, openFileRef, runTerminal, setFileWindow, togglePanel,
} from '@/store/actions';
import { modelName, setPref, updateSession, useApp } from '@/store/app';
import { findByKey, findTool } from '@/store/transcript';
import type { SessionView } from '@/store/types';

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

export function DiffPanel({ s, ...card }: CardProps & { s: SessionView }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [gaps, setGaps] = useState<Set<string>>(new Set());
  const body = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const id = s.meta.id;
  const scrollTo = (p: string) => {
    const el = [...(body.current?.querySelectorAll<HTMLElement>('[data-path]') ?? [])].find((x) => x.dataset.path === p || p.endsWith('/' + x.dataset.path) || x.dataset.path!.endsWith(p));
    if (!el) return false;
    el.scrollIntoView({ block: 'start' });
    setFlash(el.dataset.path!);
    setTimeout(() => setFlash(null), 900);
    return true;
  };
  // "View diff" on a tool row jumps here.
  useEffect(() => {
    if (!diffTarget.path) return;
    const target = diffTarget.path;
    setCollapsed((c) => {
      const n = new Set(c);
      n.delete(target);
      return n;
    });
    if (!scrollTo(target)) void loadChanges(id).then(() => requestAnimationFrame(() => scrollTo(target)));
    diffTarget.path = null;
  }, [diffTarget.seq, s.changes.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = (
    <span className="flex min-w-0 items-center gap-1 font-mono text-xs">
      <span className="truncate">{s.meta.baseBranch || 'base'}</span>
      <span className="text-muted-foreground">→</span>
      <span className="truncate">{s.meta.branch || fname(s.meta.cwd)}</span>
    </span>
  );
  const tools = (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconBtn title="Changed files"><ListIcon className="size-3.5" /></IconBtn>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Changed files</DropdownMenuLabel>
          {s.changes.map((f) => (
            <DropdownMenuItem key={f.path} onSelect={() => scrollTo(f.path)} className="justify-between gap-3">
              <span className="truncate">{f.path}</span>
              <span className="shrink-0 font-mono text-xs"><span className="text-success">+{f.add}</span> <span className="text-destructive">−{f.del}</span></span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <IconBtn title="Search files" onClick={() => togglePanel(id, 'files', true)}><SearchIcon className="size-3.5" /></IconBtn>
      <IconBtn title="Refresh" onClick={() => { setGaps(new Set()); setCollapsed(new Set()); void loadChanges(id); toast('Refreshed'); }}><RefreshCwIcon className="size-3.5" /></IconBtn>
      <IconBtn title="Open in VS Code" onClick={() => call('sessions:openIn', id, 'vscode').catch(fail)}><ExternalLinkIcon className="size-3.5" /></IconBtn>
    </>
  );
  let content: ReactNode;
  if (!s.meta.baseCommit) content = <Empty>{'这个项目不是 git 仓库\n初始化 git 后即可查看 Claude 的改动'}</Empty>;
  else if (!s.changes.length) content = <Empty>{'No changes yet\nClaude 修改的文件会出现在这里'}</Empty>;
  else content = (
    <div ref={body} className="divide-y">
      {s.changes.map((f) => {
        const isCollapsed = collapsed.has(f.path);
        return (
          <div key={f.path} data-path={f.path} className={cn('transition-colors', flash === f.path && 'bg-primary/10')}>
            <button
              className="sticky top-0 z-10 flex w-full items-center gap-2 border-b bg-card px-3 py-1.5 text-left text-xs"
              onClick={() => setCollapsed((c) => { const n = new Set(c); if (n.has(f.path)) n.delete(f.path); else n.add(f.path); return n; })}
            >
              {isCollapsed ? <ChevronRightIcon className="size-3.5" /> : <ChevronDownIcon className="size-3.5" />}
              <CodeIcon className="size-3.5 text-muted-foreground" />
              <span className="font-medium">{fname(f.path)}</span>
              <span className="truncate text-muted-foreground">{fdir(f.path)}</span>
              {f.status === 'A' && <span className="text-[10px] font-semibold text-success">NEW</span>}
              {f.status === 'D' && <span className="text-[10px] font-semibold text-destructive">DELETED</span>}
              <span className="ml-auto font-mono"><span className="text-success">+{f.add}</span> <span className="text-destructive">−{f.del}</span></span>
            </button>
            {!isCollapsed && (f.binary ? <div className="px-3 py-2 text-xs text-muted-foreground">Binary or large file</div> : (
              <DiffRows before={f.before} after={f.status === 'D' ? null : f.after} path={f.path} openGaps={gaps} onOpenGap={(g) => setGaps((x) => new Set(x).add(g))} />
            ))}
          </div>
        );
      })}
    </div>
  );
  return <Card {...card} title={title} tools={tools} onClose={() => togglePanel(id, 'diff', false)}>{content}</Card>;
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
    if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)) return void toast('预览只支持 localhost');
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
            <button
              key={node.path}
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
          <div className="p-3 text-xs text-muted-foreground">Claude 运行的命令会显示在这里。也可以在下面输入命令，输出会加入对话上下文。</div>
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

// ------------------------------------------------------------ detail: plan, subagent, file

export function DetailPanel({ s, ...card }: CardProps & { s: SessionView }) {
  const d = s.detail!;
  const id = s.meta.id;
  const close = () => closeDetail(id);
  if (d.type === 'plan') {
    const plan = findByKey(s, d.key);
    if (plan?.kind !== 'plan') return null;
    return (
      <Card {...card} title="Plan" onClose={close} tools={<IconBtn title="Copy" onClick={() => void navigator.clipboard.writeText(plan.md).then(() => toast('Plan copied'))}><CopyIcon className="size-3.5" /></IconBtn>}>
        <div className="space-y-4 p-4">
          <div className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            <MessageSquareIcon className="mt-0.5 size-3.5 shrink-0" />Review the plan. Approve it to let Claude start, or keep planning and reply with changes.
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
    return (
      <Card {...card} title={<><IconBtn title="Back" onClick={close}><ArrowLeftIcon className="size-3.5" /></IconBtn><span className="truncate">{tool.desc}</span></>} onClose={close}>
        <div className="space-y-3 p-4">
          <div className="rounded-lg bg-muted px-3 py-2 text-xs whitespace-pre-wrap text-muted-foreground">{tool.prompt}</div>
          {tool.status === 'running' ? <div className="text-sm"><span className="shimmer">{tool.summary || 'Working…'}</span></div> : (
            <>
              {tool.summary && <div className="text-xs text-muted-foreground">{tool.summary}</div>}
              <Markdown text={tool.md || ''} />
            </>
          )}
        </div>
      </Card>
    );
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
      ) : !view ? <Empty>{'File preview unavailable\nBinary, non-text, or larger than 1 MiB'}</Empty> : (
        <>
          {nav}
          <div ref={body} className="relative min-h-0 flex-1 overflow-auto">
            {d.line > view.totalLines && <div className="px-3 py-1.5 text-xs text-muted-foreground">Requested line {d.line} is beyond the current file ({view.totalLines} lines). Showing the last line.</div>}
            <CodeLines lines={view.lines} path={d.path} startLine={view.startLine} target={view.targetLine} limit={WINDOW_LINES} />
          </div>
        </>
      )}
    </Card>
  );
}

// ------------------------------------------------------------ cowork progress

export function CoworkPanel({ s, ...card }: CardProps & { s: SessionView }) {
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
          ) : <p className="text-sm text-muted-foreground">{s.running ? 'Claude 正在了解任务…' : '多步骤的任务会在这里显示进度。'}</p>}
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
          )) : <p className="text-sm text-muted-foreground">Claude 创建或修改的文件会出现在这里。</p>}
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
