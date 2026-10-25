import type { ReactNode } from 'react';
import {
  ChevronDownIcon, FileTextIcon, FolderIcon, GlobeIcon, LaptopIcon, MoreVerticalIcon, PanelRightIcon, PlusIcon,
  SquareTerminalIcon, TerminalSquareIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import type { OpenTarget } from '@shared/protocol';
import { CodeComposer, CoworkComposer } from '@/components/composer/Composers';
import { Transcript } from '@/components/thread/Transcript';
import { openCards, Workspace } from '@/components/workspace/Workspace';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { call, isMac, modKey } from '@/lib/api';
import { COWORK_IDEAS, OUTPUT_STYLE_INFO, VIEW_MODES, type ViewMode } from '@/lib/constants';
import { fname } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  addProject, archiveSession, fail, importCliSession, renameSession, selectProject, setOutputStyle, setViewMode,
  togglePanel, welcomeDraftKey,
} from '@/store/actions';
import { setPref, useApp, useCurrent } from '@/store/app';
import { drafts } from '@/store/drafts';
import { hasThinking } from '@/store/transcript';
import type { SessionView } from '@/store/types';
import type { OutputStyle } from '@shared/protocol';
import { SidebarToggle } from './Sidebar';

function HeaderButton({ on, children, ...props }: React.ComponentProps<'button'> & { on?: boolean }) {
  return (
    <button {...props} className={cn('flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground', on && 'bg-accent text-foreground')}>
      {children}
    </button>
  );
}

/** Rename, transcript view, output style, export, archive. */
function SessionMenu({ s, trigger }: { s: SessionView; trigger: ReactNode }) {
  const view = useApp((st) => st.prefs.viewMode);
  const views = VIEW_MODES.filter((m) => m.id !== 'thinking' || hasThinking(s));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuItem onSelect={() => void renameSession(s.meta.id)}>Rename</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(s.meta.cwd).then(() => toast('Copied'))}>Copy {s.meta.worktree ? 'worktree' : 'folder'} path</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => call('sessions:exportHtml', s.meta.id).then((r) => toast(`Exported to ${r.path}`)).catch(fail)}>Export as HTML</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex justify-between text-xs text-muted-foreground">Transcript view<span>{modKey}O</span></DropdownMenuLabel>
        <DropdownMenuRadioGroup value={view} onValueChange={(v) => setViewMode(v as ViewMode, true)}>
          {views.map((m) => <DropdownMenuRadioItem key={m.id} value={m.id} title={m.desc}>{m.name}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Output style</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={s.meta.outputStyle} onValueChange={(v) => setOutputStyle(v as OutputStyle, true)}>
          {OUTPUT_STYLE_INFO.map((o) => <DropdownMenuRadioItem key={o.id} value={o.id} title={o.desc}>{o.name}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => void archiveSession(s.meta.id)}>Archive</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const OPEN_IN: { id: OpenTarget; label: string; badge: string; color: string }[] = [
  { id: 'vscode', label: 'VS Code', badge: 'VS', color: '#2f80ed' },
  { id: 'cursor', label: 'Cursor', badge: 'Cu', color: '#3a3a3a' },
  { id: 'terminal', label: 'Terminal', badge: '>_', color: '#444' },
  { id: 'folder', label: isMac ? 'Finder' : 'File Explorer', badge: 'F', color: '#e3a21a' },
];

function Header({ s }: { s?: SessionView }) {
  const collapsed = useApp((st) => st.sidebarCollapsed);
  const cowork = s?.meta.kind === 'cowork';
  const p = s?.panels;
  return (
    <header className={cn('app-drag titlebar-inset flex h-11 shrink-0 items-center gap-1 px-3', collapsed && isMac && 'pl-[84px]')}>
      {collapsed && <SidebarToggle />}
      {s ? (
        <>
          <SessionMenu
            s={s}
            trigger={
              <button className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium hover:bg-accent">
                {cowork ? <FolderIcon className="size-4 shrink-0 text-muted-foreground" /> : <LaptopIcon className="size-4 shrink-0 text-muted-foreground" />}
                <span className="truncate">{s.meta.title}</span>
                <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            }
          />
          <span className="truncate rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {cowork ? (s.meta.scratch ? 'Temporary workspace' : fname(s.meta.projectPath)) : `${fname(s.meta.projectPath)}${s.meta.branch ? ` · ${s.meta.branch}` : ''}`}
          </span>
          <span className="flex-1" />
          {cowork ? (
            <HeaderButton on={p!.progress} title="Progress" onClick={() => togglePanel(s.meta.id, 'progress')}><PanelRightIcon className="size-4" /></HeaderButton>
          ) : (
            <>
              <HeaderButton on={p!.terminal} title="Terminal" onClick={() => togglePanel(s.meta.id, 'terminal')}><SquareTerminalIcon className="size-4" /></HeaderButton>
              <HeaderButton on={p!.diff} title={`Diff  ${modKey}D`} onClick={() => togglePanel(s.meta.id, 'diff')}><FileTextIcon className="size-4" /></HeaderButton>
              <HeaderButton on={p!.preview} title="Preview" onClick={() => togglePanel(s.meta.id, 'preview')}><GlobeIcon className="size-4" /></HeaderButton>
              <HeaderButton on={p!.files} title="Files" onClick={() => togglePanel(s.meta.id, 'files')}><FolderIcon className="size-4" /></HeaderButton>
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <HeaderButton title="Open in…"><TerminalSquareIcon className="size-4" /></HeaderButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Open in</DropdownMenuLabel>
              {OPEN_IN.map((o) => (
                <DropdownMenuItem key={o.id} onSelect={() => call('sessions:openIn', s.meta.id, o.id).catch(fail)}>
                  <span className="flex size-5 items-center justify-center rounded text-[9px] font-bold text-white" style={{ background: o.color }}>{o.badge}</span>
                  {o.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <SessionMenu s={s} trigger={<HeaderButton title="More"><MoreVerticalIcon className="size-4" /></HeaderButton>} />
        </>
      ) : (
        <span className="px-2 text-sm text-muted-foreground">{useApp.getState().view === 'cowork' ? 'New task' : 'New session'}</span>
      )}
    </header>
  );
}

// ------------------------------------------------------------ welcome screens

function CodeWelcome() {
  const projects = useApp((st) => st.projects);
  const project = useApp((st) => st.prefs.project);
  const worktree = useApp((st) => st.prefs.worktree);
  const importable = useApp((st) => st.importable);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-6">
        <div className="w-full max-w-md rounded-2xl border bg-card p-2 shadow-sm">
          {projects.map((p) => (
            <button key={p.path} title={p.path} onClick={() => selectProject(p.path)} className={cn('flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-sm hover:bg-accent', p.path === project && 'bg-accent font-medium')}>
              <LaptopIcon className="size-4 text-muted-foreground" />
              <span className="truncate">{p.name}</span>
            </button>
          ))}
          <button onClick={() => void addProject()} className="flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
            <PlusIcon className="size-4" />Open folder…
          </button>
          <div className="my-1.5 border-t" />
          <DropdownMenu>
            <DropdownMenuTrigger className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs text-muted-foreground hover:bg-accent">
              Local environment<ChevronDownIcon className="size-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Environment</DropdownMenuLabel>
              <DropdownMenuItem className="flex-col items-start gap-0"><b className="font-medium">Local</b><span className="text-xs text-muted-foreground">在这台电脑上运行</span></DropdownMenuItem>
              <DropdownMenuItem disabled className="flex-col items-start gap-0"><b className="font-medium">Cloud</b><span className="text-xs text-muted-foreground">即将推出</span></DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={worktree} onCheckedChange={(v) => setPref('worktree', !!v)} onSelect={(e) => e.preventDefault()}>
                Use isolated worktree
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {project && (
          <button
            disabled={!importable.length}
            onClick={() => void importCliSession()}
            className="flex items-center gap-2 rounded-xl border px-4 py-2 text-sm text-muted-foreground enabled:hover:bg-accent enabled:hover:text-foreground disabled:opacity-60"
          >
            <TerminalSquareIcon className="size-4" />
            {importable.length ? `Import ${importable.length} pi CLI session${importable.length > 1 ? 's' : ''}` : 'No pi CLI sessions to import'}
          </button>
        )}
      </div>
      <CodeComposer />
    </div>
  );
}

function CoworkWelcome() {
  const h = new Date().getHours();
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 pb-16">
      <div className="w-full max-w-2xl">
        <h1 className="mb-8 flex items-center justify-center gap-3 font-serif text-4xl font-normal tracking-tight">
          <span className="spark size-7!" aria-hidden />
          {h < 5 || h >= 22 ? 'Still up?' : 'You’re here!'}
        </h1>
        <CoworkComposer />
        <div className="mt-8">
          <div className="mb-2 text-sm text-muted-foreground">Ideas for you</div>
          <div className="grid gap-2 sm:grid-cols-3">
            {COWORK_IDEAS.map((idea) => (
              <button
                key={idea.label}
                onClick={() => drafts.setText(welcomeDraftKey(), idea.prompt)}
                className="rounded-xl border bg-card px-3.5 py-3 text-left text-sm hover:bg-accent"
              >
                {idea.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ thread

function Thread({ s }: { s: SessionView }) {
  const { primary, secondary } = openCards(s);
  const tools = primary.length + secondary.length > 0;
  const conversation = (
    <div className="flex h-full min-w-0 flex-col">
      <Transcript s={s} />
      <CodeComposer />
    </div>
  );
  if (!tools) return conversation;
  return (
    <ResizablePanelGroup orientation="horizontal" id="thread-workspace">
      <ResizablePanel id="conversation" minSize={320}>{conversation}</ResizablePanel>
      <ResizableHandle className="bg-transparent" />
      <ResizablePanel id="tools" minSize={300} defaultSize={secondary.length && primary.length ? '62%' : '48%'} className="pb-2">
        <Workspace s={s} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

export function Main() {
  const s = useCurrent();
  const view = useApp((st) => st.view);
  return (
    <main className="flex h-full min-w-0 flex-col bg-background">
      <Header s={s} />
      <div className="flex min-h-0 flex-1 flex-col">{s ? <Thread key={s.meta.id} s={s} /> : view === 'cowork' ? <CoworkWelcome /> : <CodeWelcome />}</div>
    </main>
  );
}

