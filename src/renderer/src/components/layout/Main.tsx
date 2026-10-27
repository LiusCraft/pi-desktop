import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import {
  BotIcon, ChevronDownIcon, ExternalLinkIcon, FileTextIcon, FolderIcon, GlobeIcon, LaptopIcon, PanelRightIcon,
  SquareTerminalIcon,
} from 'lucide-react';
import { PET_BLOCK_ATTR } from '@/components/composer/Clawd';
import { CodeComposer, WorkComposer } from '@/components/composer/Composers';
import { copyText } from '@/components/common/Copy';
import { AskDock, Transcript } from '@/components/thread/Transcript';
import { openCards, soloCard, Workspace } from '@/components/workspace/Workspace';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { useDefaultLayout } from 'react-resizable-panels';
import { call, isMac, modKey } from '@/lib/api';
import { WORK_IDEAS, OUTPUT_STYLE_INFO, VIEW_MODES, type ViewMode } from '@/lib/constants';
import { fname } from '@/lib/format';
import { OpenInMenu } from '@/components/common/OpenInMenu';
import { cn } from '@/lib/utils';
import {
  archiveSession, deleteSession, exportHtml, renameSession, setOutputStyle, setViewMode,
  togglePanel, welcomeDraftKey,
} from '@/store/actions';
import { useApp, useCurrent } from '@/store/app';
import { drafts } from '@/store/drafts';
import { hasThinking } from '@/store/transcript';
import type { SessionView } from '@/store/types';
import type { OutputStyle, WorkIdea } from '@shared/protocol';
import { CustomizePage } from '@/customize/CustomizePage';
import { ScheduledPage } from '@/scheduled/ScheduledPage';
import { ActivityPage } from '@/activity/ActivityPage';
import { ArchivedPage } from '@/archived/ArchivedPage';
import { ArtifactsPage } from '@/artifacts/ArtifactsPage';
import { RecentArtifacts } from '@/artifacts/RecentArtifacts';
import { ProjectsPage } from '@/projects/ProjectsPage';
import { SidebarToggle } from './Sidebar';
import { Inbox } from './Inbox';
import { SideChatView } from '@/components/side/SideChat';
import { useSide } from '@/store/side';

function HeaderButton({ on, children, ...props }: React.ComponentProps<'button'> & { on?: boolean }) {
  return (
    <button {...props} className={cn('flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground', on && 'bg-accent text-foreground')}>
      {children}
    </button>
  );
}

/**
 * Rename, transcript view, output style, export, archive.
 * Opens where the user clicked: the menu hangs off an invisible anchor placed at
 * the pointer (or under the button, for a keyboard activation).
 */
function SessionMenu({ s, children }: { s: SessionView; children: (props: { onClick: (e: MouseEvent<HTMLElement>) => void }) => ReactNode }) {
  const view = useApp((st) => st.prefs.viewMode);
  const views = VIEW_MODES.filter((m) => m.id !== 'thinking' || hasThinking(s));
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState({ x: 0, y: 0 });
  const onClick = (e: MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    // A keyboard "click" has no pointer position.
    setAt(e.detail === 0 ? { x: rect.left, y: rect.bottom } : { x: e.clientX, y: e.clientY });
    setOpen(true);
  };
  return (
    <>
      {children({ onClick })}
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <span aria-hidden className="pointer-events-none fixed size-0" style={{ left: at.x, top: at.y }} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={0} className="w-60" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuItem onSelect={() => void renameSession(s.meta.id)}>Rename</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void copyText(s.meta.cwd)}>Copy {s.meta.worktree ? 'worktree' : 'folder'} path</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void exportHtml(s.meta.id)}>Export as HTML</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex justify-between text-xs text-muted-foreground">Transcript view<span>{modKey}O</span></DropdownMenuLabel>
        <DropdownMenuRadioGroup value={view} onValueChange={(v) => setViewMode(v as ViewMode)}>
          {views.map((m) => <DropdownMenuRadioItem key={m.id} value={m.id} title={m.desc}>{m.name}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Output style</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={s.meta.outputStyle} onValueChange={(v) => setOutputStyle(v as OutputStyle)}>
          {OUTPUT_STYLE_INFO.map((o) => <DropdownMenuRadioItem key={o.id} value={o.id} title={o.desc}>{o.name}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void archiveSession(s.meta.id)}>Archive</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => void deleteSession(s.meta.id)}>Delete…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function Header({ s, title }: { s?: SessionView; title?: string }) {
  const collapsed = useApp((st) => st.sidebarCollapsed);
  const work = s?.meta.kind === 'work';
  const p = s?.panels;
  const hasTasks = !!s?.items.some((i) => i.kind === 'group' && i.tools.some((t) => t.kind === 'agent'));
  return (
    <header className={cn('app-drag titlebar-inset flex h-11 shrink-0 items-center gap-1 px-3', collapsed && isMac && 'pl-[84px]')}>
      {collapsed && <SidebarToggle />}
      {s ? (
        <>
          <SessionMenu s={s}>
            {(trigger) => (
              <button {...trigger} className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium hover:bg-accent">
                {work ? <FolderIcon className="size-4 shrink-0 text-muted-foreground" /> : <LaptopIcon className="size-4 shrink-0 text-muted-foreground" />}
                <span className="truncate">{s.meta.title}</span>
                <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            )}
          </SessionMenu>
          <span className="truncate rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {work ? (s.meta.scratch ? 'Temporary workspace' : fname(s.meta.projectPath)) : `${fname(s.meta.projectPath)}${s.meta.branch ? ` · ${s.meta.branch}` : ''}`}
          </span>
          <span className="flex-1" />
          {hasTasks && <HeaderButton on={p!.tasks} title="Background tasks" onClick={() => togglePanel(s.meta.id, 'tasks')}><BotIcon className="size-4" /></HeaderButton>}
          {work ? (
            <HeaderButton on={p!.progress} title="Progress" onClick={() => togglePanel(s.meta.id, 'progress')}><PanelRightIcon className="size-4" /></HeaderButton>
          ) : (
            <>
              <HeaderButton on={p!.terminal} title="Terminal" onClick={() => togglePanel(s.meta.id, 'terminal')}><SquareTerminalIcon className="size-4" /></HeaderButton>
              <HeaderButton on={p!.diff} title={`Diff  ${modKey}D`} onClick={() => togglePanel(s.meta.id, 'diff')}><FileTextIcon className="size-4" /></HeaderButton>
              <HeaderButton on={p!.preview} title="Preview" onClick={() => togglePanel(s.meta.id, 'preview')}><GlobeIcon className="size-4" /></HeaderButton>
              <HeaderButton on={p!.files} title="Files" onClick={() => togglePanel(s.meta.id, 'files')}><FolderIcon className="size-4" /></HeaderButton>
            </>
          )}
          <OpenInMenu id={s.meta.id}><HeaderButton title="Open in…"><ExternalLinkIcon className="size-4" /></HeaderButton></OpenInMenu>
        </>
      ) : (
        <span className="px-2 text-sm text-muted-foreground">{title ?? (useApp.getState().view === 'work' ? 'New task' : 'New session')}</span>
      )}
    </header>
  );
}

// ------------------------------------------------------------ welcome screens

function CodeWelcome() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-6">
        <h1 className="flex items-center gap-3 font-serif text-3xl font-normal tracking-tight">
          <span className="spark size-6!" aria-hidden />
          Let’s build
        </h1>
        <Inbox />
      </div>
      <CodeComposer />
    </div>
  );
}

/** Ideas drawn from the recent Work sessions; the fixed ones show until (or unless) the model has some. */
function WorkIdeas() {
  const enabled = useApp((st) => st.settings.workIdeas !== false);
  const [ideas, setIdeas] = useState<readonly WorkIdea[]>(WORK_IDEAS);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void call('sessions:workIdeas').then((list) => live && list && setIdeas(list)).catch(() => {});
    return () => { live = false; };
  }, [enabled]);
  if (!enabled) return null;
  return (
    <div className="mt-8">
      <div className="mb-2 text-sm text-muted-foreground">Ideas for you</div>
      <div className="grid gap-2 sm:grid-cols-3">
        {ideas.map((idea) => (
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
  );
}

function WorkWelcome() {
  const h = new Date().getHours();
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 pb-16">
      <div className="w-full max-w-2xl">
        <h1 className="mb-8 flex items-center justify-center gap-3 font-serif text-4xl font-normal tracking-tight">
          <span className="spark size-7!" aria-hidden />
          {h < 5 || h >= 22 ? 'Still up?' : 'You’re here!'}
        </h1>
        <WorkComposer />
        <WorkIdeas />
        <RecentArtifacts />
      </div>
    </div>
  );
}

// ------------------------------------------------------------ thread

function Thread({ s }: { s: SessionView }) {
  const { primary, secondary } = openCards(s);
  const tools = primary.length + secondary.length > 0;
  // The conversation/workspace split belongs to the session, so switching back restores it.
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: `${s.meta.id}:thread` });
  const sideOpen = useSide((st) => !!st.open[s.meta.id] && !st.windows[s.meta.id]);
  const conversation = (
    <div className="relative flex h-full min-w-0 flex-col">
      <Transcript s={s} />
      <AskDock s={s} />
      <CodeComposer />
      {sideOpen && (
        // Floats over the conversation; the thread underneath keeps running.
        <div {...{ [PET_BLOCK_ATTR]: '' }} className="absolute top-3 right-3 bottom-auto z-20 h-[min(560px,calc(100%-1.5rem))] w-[min(400px,calc(100%-1.5rem))]">
          <SideChatView sid={s.meta.id} mode="embedded" />
        </div>
      )}
    </div>
  );
  if (!tools) return conversation;
  if (s.expandedWide && soloCard(s)) return <Workspace s={s} />;
  return (
    <ResizablePanelGroup orientation="horizontal" id={`${s.meta.id}:thread`} defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
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
  const customize = useApp((st) => st.customize);
  const scheduled = useApp((st) => st.scheduled);
  const archived = useApp((st) => st.archived);
  const activity = useApp((st) => st.activity);
  const artifacts = useApp((st) => st.artifacts);
  const projects = useApp((st) => st.workProjects);
  return (
    <main className="flex h-full min-w-0 flex-col bg-background">
      <Header s={customize || scheduled || archived || activity || artifacts || projects ? undefined : s} title={customize ? 'Customize' : scheduled ? 'Scheduled' : archived ? 'Archived sessions' : activity ? 'Activity' : artifacts ? 'Artifacts' : projects ? 'Projects' : undefined} />
      <div className="flex min-h-0 flex-1 flex-col">{customize ? <CustomizePage /> : scheduled ? <ScheduledPage /> : archived ? <ArchivedPage /> : activity ? <ActivityPage /> : artifacts ? <ArtifactsPage /> : projects ? <ProjectsPage /> : s ? <Thread key={s.meta.id} s={s} /> : view === 'work' ? <WorkWelcome /> : <CodeWelcome />}</div>
    </main>
  );
}

