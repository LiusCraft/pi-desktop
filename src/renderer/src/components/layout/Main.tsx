import type { ReactNode } from 'react';
import {
  BotIcon, ChevronDownIcon, FileTextIcon, FolderIcon, GlobeIcon, LaptopIcon, MoreVerticalIcon, PanelRightIcon, PlusIcon,
  SquareTerminalIcon, TerminalSquareIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import type { OpenTarget } from '@shared/protocol';
import { CodeComposer, CoworkComposer } from '@/components/composer/Composers';
import { Transcript } from '@/components/thread/Transcript';
import { openCards, Workspace } from '@/components/workspace/Workspace';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { call, isMac, modKey } from '@/lib/api';
import { COWORK_IDEAS, OUTPUT_STYLE_INFO, VIEW_MODES, type ViewMode } from '@/lib/constants';
import { fname } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  addProject, archiveSession, fail, importCliSession, renameSession, setOutputStyle, setViewMode,
  togglePanel, welcomeDraftKey,
} from '@/store/actions';
import { useApp, useCurrent } from '@/store/app';
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
  const hasTasks = !!s?.items.some((i) => i.kind === 'group' && i.tools.some((t) => t.kind === 'agent'));
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
          {hasTasks && <HeaderButton on={p!.tasks} title="Background tasks" onClick={() => togglePanel(s.meta.id, 'tasks')}><BotIcon className="size-4" /></HeaderButton>}
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
  const project = useApp((st) => st.prefs.project);
  const importable = useApp((st) => st.importable);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-6">
        <h1 className="flex items-center gap-3 font-serif text-3xl font-normal tracking-tight">
          <span className="spark size-6!" aria-hidden />
          {project ? fname(project) : 'Pick a project to start'}
        </h1>
        {project ? (
          <button
            disabled={!importable.length}
            onClick={() => void importCliSession()}
            className="flex items-center gap-2 rounded-xl border px-4 py-2 text-sm text-muted-foreground enabled:hover:bg-accent enabled:hover:text-foreground disabled:opacity-60"
          >
            <TerminalSquareIcon className="size-4" />
            {importable.length ? `Import ${importable.length} pi CLI session${importable.length > 1 ? 's' : ''}` : 'No pi CLI sessions to import'}
          </button>
        ) : (
          <Button variant="outline" onClick={() => void addProject()}><PlusIcon className="size-4" />Open folder…</Button>
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

