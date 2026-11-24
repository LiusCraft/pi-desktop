import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import {
  ChevronDownIcon,
  CircleAlertIcon,
  EyeIcon,
  FolderIcon,
  GitBranchIcon,
  GitForkIcon,
  LaptopIcon,
  LoaderCircleIcon,
  PanelRightIcon,
} from 'lucide-react';
import { AttachmentTiles } from '@/components/common/Attachments';
import { ContextCards } from '@/components/composer/ContextCards';
import { CodeComposer, WorkComposer } from '@/components/composer/Composers';
import { copyText } from '@/components/common/Copy';
import { InlineEdit } from '@/components/common/InlineEdit';
import { AskDock, Transcript } from '@/components/thread/Transcript';
import { Workspace } from '@/components/workspace/Workspace';
import { IconBtn } from '@/components/workspace/PanelToolbar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { useDefaultLayout } from 'react-resizable-panels';
import { call, canTerminal, isMac } from '@/lib/api';
import { useShortcutHint } from '@/lib/shortcut-keys';
import { workIdeas, OUTPUT_STYLE_INFO, VIEW_MODES, type ViewMode } from '@/lib/constants';
import { useT } from '@/lib/i18n';
import { fname } from '@/lib/format';
import { OpenInSubmenu } from '@/components/common/OpenInMenu';
import { WindowControls } from '@/components/common/WindowControls';
import { cn } from '@/lib/utils';
import {
  archiveSession,
  startFromPr,
  deleteSession,
  exportHtml,
  openNewWorkspaceTab,
  setOutputStyle,
  setSessionTitle,
  setViewMode,
  toggleWorkspaceVisibility,
  welcomeDraftKey,
} from '@/store/actions';
import { updateSession, useApp, useCurrent, type AppState } from '@/store/app';
import { drafts, useDrafts } from '@/store/drafts';
import { openWorkspaceTabs } from '@/store/layout';
import { hasThinking } from '@/store/transcript';
import type { SessionView } from '@/store/types';
import { MAX_SESSION_TITLE, type OutputStyle, type WorkIdea } from '@shared/protocol';
import { CustomizePage } from '@/customize/CustomizePage';
import { ScheduledPage } from '@/scheduled/ScheduledPage';
import { ActivityPage } from '@/activity/ActivityPage';
import { ArchivedPage } from '@/archived/ArchivedPage';
import { ArtifactsPage } from '@/artifacts/ArtifactsPage';
import { RecentArtifacts } from '@/artifacts/RecentArtifacts';
import { ProjectsPage } from '@/projects/ProjectsPage';
import { PluginPage } from '@/plugin/PluginPage';
import { SidebarToggle } from './Sidebar';
import { Inbox } from './Inbox';
import { SessionOverview } from '@/components/workspace/SessionOverview';

const WORKSPACE_PANEL_ID = 'tools';

/**
 * Rename, open in an external app, transcript view, output style, export, archive.
 * Opens where the user clicked: the menu hangs off an invisible anchor placed at
 * the pointer (or under the button, for a keyboard activation).
 */
function SessionMenu({
  s,
  onRename,
  children,
}: {
  s: SessionView;
  onRename: () => void;
  children: (props: { onClick: (e: MouseEvent<HTMLElement>) => void }) => ReactNode;
}) {
  const t = useT();
  const view = useApp((st) => st.prefs.viewMode);
  const viewHint = useShortcutHint('view');
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
          <DropdownMenuItem onSelect={onRename}>{t('main.rename')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void copyText(s.meta.cwd)}>
            {t(s.meta.worktree ? 'main.copyWorktreePath' : 'main.copyFolderPath')}
          </DropdownMenuItem>
          <OpenInSubmenu id={s.meta.id} />
          <DropdownMenuItem onSelect={() => void exportHtml(s.meta.id)}>{t('main.exportHtml')}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="flex justify-between text-xs text-muted-foreground">
            {t('main.transcriptView')}
            <span>{viewHint}</span>
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup value={view} onValueChange={(v) => setViewMode(v as ViewMode)}>
            {views.map((m) => (
              <DropdownMenuRadioItem key={m.id} value={m.id} title={m.desc}>
                {m.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">{t('main.outputStyle')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={s.meta.outputStyle} onValueChange={(v) => setOutputStyle(v as OutputStyle)}>
            {OUTPUT_STYLE_INFO.map((o) => (
              <DropdownMenuRadioItem key={o.id} value={o.id} title={o.desc}>
                {o.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void archiveSession(s.meta.id)}>{t('main.archive')}</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => void deleteSession(s.meta.id)}>
            {t('main.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/** The icon in front of the title says where a Code session runs: a worktree or the project folder itself. */
function SessionIcon({ s }: { s: SessionView }) {
  const t = useT();
  const cls = 'size-4 shrink-0 text-muted-foreground';
  if (s.meta.kind === 'work')
    return (
      <span className="flex shrink-0 items-center p-1.5">
        <FolderIcon className={cls} />
      </span>
    );
  const isWorktree = s.meta.worktree || !!s.meta.external;
  const Icon = isWorktree ? GitForkIcon : LaptopIcon;
  return (
    <span
      className="no-drag flex shrink-0 cursor-default items-center p-1.5 select-none"
      title={t('main.envTip', { env: t(isWorktree ? 'main.envWorktree' : 'main.envLocal'), path: s.meta.cwd })}
    >
      <Icon className={cls} />
    </span>
  );
}

/** Project and branch of a Code session; the tooltip has the base branch. */
function SessionBranch({ s }: { s: SessionView }) {
  const t = useT();
  const { meta } = s;
  return (
    <span
      className="hidden min-w-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground @lg:flex"
      title={t('main.branchTip', { branch: meta.branch ?? '-', base: meta.baseBranch ?? '-' })}
    >
      <span className={cn('shrink-0', meta.branch && 'hidden @xl:inline')}>{fname(meta.projectPath)}</span>
      {meta.branch && (
        <>
          <GitBranchIcon className="size-3 shrink-0" />
          <span className="truncate">{meta.branch}</span>
        </>
      )}
      {s.prHidden && (
        <button
          className="no-drag shrink-0 rounded p-0.5 hover:bg-accent hover:text-foreground"
          title={t('main.showPrBar')}
          aria-label={t('main.showPrBar')}
          onClick={() => updateSession(meta.id, (v) => void (v.prHidden = false))}
        >
          <EyeIcon className="size-3" />
        </button>
      )}
    </span>
  );
}

function Header({ s, title }: { s?: SessionView; title?: string }) {
  const t = useT();
  const collapsed = useApp((st) => st.sidebarCollapsed);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const work = s?.meta.kind === 'work';
  const hasWorkspaceTabs = !!s && openWorkspaceTabs(s, canTerminal).length > 0;
  const workspaceVisible = hasWorkspaceTabs && !s?.workspaceHidden;
  return (
    <header
      className={cn(
        'app-drag titlebar-inset @container flex h-11 shrink-0 items-center gap-1 px-3',
        collapsed && isMac && 'pl-[84px]',
      )}
    >
      {collapsed && <SidebarToggle />}
      {s ? (
        <>
          {renamingId === s.meta.id ? (
            <span className="flex min-w-0 items-center gap-1.5 px-2 py-1 text-sm font-medium">
              <SessionIcon s={s} />
              <InlineEdit
                value={s.meta.title}
                ariaLabel={t('main.rename')}
                maxLength={MAX_SESSION_TITLE}
                className="w-56"
                onCommit={(next) => {
                  setRenamingId(null);
                  void setSessionTitle(s.meta.id, next);
                }}
                onCancel={() => setRenamingId(null)}
              />
            </span>
          ) : (
            <span className="flex min-w-0 items-center text-sm font-medium">
              <SessionIcon s={s} />
              <span
                className="no-drag flex min-w-0 cursor-text items-center rounded-md px-1.5 py-1 hover:bg-accent"
                title={t('main.rename')}
                onDoubleClick={() => setRenamingId(s.meta.id)}
              >
                <span className="truncate">{s.meta.title}</span>
              </span>
              <SessionMenu s={s} onRename={() => setRenamingId(s.meta.id)}>
                {(trigger) => (
                  <button
                    {...trigger}
                    aria-label={t('main.sessionMenu')}
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <ChevronDownIcon className="size-3.5" />
                  </button>
                )}
              </SessionMenu>
            </span>
          )}
          {work ? (
            <span className="truncate rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {s.meta.scratch ? t('main.tempWorkspace') : fname(s.meta.projectPath)}
            </span>
          ) : (
            <SessionBranch s={s} />
          )}
          <span className="flex-1" />
          <SessionOverview key={s.meta.id} s={s} />
          <IconBtn
            title={t(workspaceVisible ? 'panel.hideWorkspace' : 'panel.showWorkspace')}
            className="no-drag aria-expanded:bg-accent aria-expanded:text-foreground"
            aria-expanded={workspaceVisible}
            aria-controls={hasWorkspaceTabs ? WORKSPACE_PANEL_ID : undefined}
            onClick={() => (hasWorkspaceTabs ? toggleWorkspaceVisibility(s.meta.id) : openNewWorkspaceTab(s.meta.id))}
          >
            <PanelRightIcon className="size-4" aria-hidden />
          </IconBtn>
        </>
      ) : (
        <span className="px-2 text-sm text-muted-foreground">
          {title ?? (useApp.getState().view === 'work' ? t('main.newTask') : t('main.newSession'))}
        </span>
      )}
      <WindowControls target="main" />
    </header>
  );
}

// ------------------------------------------------------------ welcome screens

function CodeWelcome() {
  const t = useT();
  const progress = useApp((st) => st.prImport);
  const stage = progress && 'stage' in progress ? progress.stage : null;
  const error = progress && 'error' in progress ? progress.error : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-6">
        <h1 className="flex items-center gap-3 font-serif text-3xl font-normal tracking-tight">
          <span className="spark size-6!" aria-hidden />
          {t('main.letsBuild')}
        </h1>
        <div className="flex w-full max-w-sm flex-col items-center">
          <button
            type="button"
            className="rounded-md surface-flat px-3 py-1.5 text-sm enabled:hover:bg-accent disabled:opacity-60"
            disabled={stage !== null}
            onClick={() => void startFromPr()}
          >
            {t('prstart.label')}
          </button>
          <div role="status" className="mt-2 flex items-center gap-2 text-sm text-muted-foreground empty:mt-0">
            {stage && stage !== 'input' && (
              <>
                {stage === 'folder' ? (
                  <FolderIcon aria-hidden className="size-4 shrink-0" />
                ) : (
                  <LoaderCircleIcon aria-hidden className="size-4 shrink-0 text-primary motion-safe:animate-spin" />
                )}
                {t(`prstart.stage.${stage}`)}
              </>
            )}
          </div>
          {error !== null && (
            <div
              role="alert"
              className="mt-2 flex w-full items-start gap-2 rounded-lg surface-flat bg-card px-3 py-2 text-sm"
            >
              <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div className="min-w-0">
                <div className="font-medium">{t('prstart.failed')}</div>
                <div className="break-words text-muted-foreground">{error}</div>
              </div>
            </div>
          )}
        </div>
        <Inbox />
      </div>
      <CodeComposer />
    </div>
  );
}

/** Ideas drawn from the recent Work sessions; the fixed ones show until (or unless) the model has some. */
function WorkIdeas() {
  const t = useT();
  const enabled = useApp((st) => st.settings.workIdeas !== false);
  const [written, setIdeas] = useState<readonly WorkIdea[] | null>(null);
  const ideas = written ?? workIdeas();
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void call('sessions:workIdeas')
      .then((list) => live && list && setIdeas(list))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [enabled]);
  if (!enabled) return null;
  return (
    <div className="mt-8">
      <div className="mb-2 text-sm text-muted-foreground">{t('main.ideasForYou')}</div>
      <div className="grid gap-2 sm:grid-cols-3">
        {ideas.map((idea) => (
          <button
            key={idea.label}
            onClick={() => drafts.setText(welcomeDraftKey(), idea.prompt)}
            className="rounded-xl surface-flat bg-card px-3.5 py-3 text-left text-sm hover:bg-accent"
          >
            {idea.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function WorkWelcome() {
  const t = useT();
  const h = new Date().getHours();
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 pb-16">
      <div className="w-full max-w-2xl">
        <h1 className="mb-8 flex items-center justify-center gap-3 font-serif text-4xl font-normal tracking-tight">
          <span className="spark size-7!" aria-hidden />
          {h < 5 || h >= 22 ? t('main.stillUp') : t('main.youreHere')}
        </h1>
        <WorkComposer />
        <WorkIdeas />
        <RecentArtifacts />
      </div>
    </div>
  );
}

// ------------------------------------------------------------ thread

/** Render the submitted draft without inventing a session id for controls that need a live host session. */
function CreatingThread({ preview }: { preview: NonNullable<AppState['creating']> }) {
  const t = useT();
  const draft = useDrafts((st) => (preview.kind === 'draft' ? st.drafts[preview.key] : undefined));
  const text = preview.kind === 'task' ? preview.prompt : draft?.text;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[786px] flex-col gap-4 px-6 pt-6 pb-4">
        <div className="flex flex-col items-end gap-1.5">
          {draft && <AttachmentTiles attachments={draft.attachments} />}
          {draft && <ContextCards references={draft.references.filter((ref) => !ref.token)} />}
          {text && (
            <div
              data-selectable
              className="max-w-[85%] rounded-2xl bg-user-bubble px-4 py-2.5 break-words whitespace-pre-wrap"
            >
              {text}
            </div>
          )}
        </div>
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <span aria-hidden className="spark spin" />
          {t('transcript.setupRunning')}
        </div>
      </div>
    </div>
  );
}

function Thread({ s }: { s: SessionView }) {
  const tabs = openWorkspaceTabs(s, canTerminal);
  const hidden = s.workspaceHidden;
  const expanded = !hidden && s.workspaceExpanded;
  // The conversation/workspace split belongs to the session, so switching back restores it.
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: `${s.meta.id}:thread` });
  const conversation = (
    <div className="relative flex h-full min-w-0 flex-col">
      <Transcript s={s} />
      <AskDock s={s} />
      <CodeComposer />
    </div>
  );
  if (!tabs.length) return <div className="min-h-0 flex-1">{conversation}</div>;
  return (
    <ResizablePanelGroup
      orientation="horizontal"
      id={`${s.meta.id}:thread`}
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
      className="relative"
    >
      <ResizablePanel id="conversation" minSize={320} inert={expanded}>
        {conversation}
      </ResizablePanel>
      <ResizableHandle
        className={cn('bg-transparent', expanded && 'invisible')}
        disabled={expanded || hidden}
        hidden={hidden}
      />
      {/* Hiding removes the dock from the split without unmounting its tabs or changing the split sizes. */}
      <ResizablePanel
        id={WORKSPACE_PANEL_ID}
        minSize={220}
        defaultSize="48%"
        hidden={hidden}
        style={{ overflow: 'hidden' }}
      >
        {/* Full width without moving or remounting the tab contents, or changing the saved split. */}
        <div className={cn('h-full p-1 pb-2', expanded && 'absolute inset-0 z-20 bg-background')}>
          <Workspace s={s} tabs={tabs} />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

export function Main() {
  const t = useT();
  const s = useCurrent();
  const view = useApp((st) => st.view);
  const creating = useApp((st) => st.creating);
  const customize = useApp((st) => st.customize);
  const scheduled = useApp((st) => st.scheduled);
  const archived = useApp((st) => st.archived);
  const activity = useApp((st) => st.activity);
  const artifacts = useApp((st) => st.artifacts);
  const projects = useApp((st) => st.workProjects);
  const pluginPage = useApp((st) => st.pluginPage);
  const plugins = useApp((st) => st.plugins);
  // The plugin page's title is the plugin's own (its manifest names it); the others have a fixed one.
  const [pluginId, pluginPageId] = (pluginPage ?? '').split(':');
  const pluginTitle = plugins
    .find((p) => p.id === pluginId)
    ?.contributions.pages.find((p) => p.id === pluginPageId)?.title;
  const title = customize
    ? t('page.customize')
    : scheduled
      ? t('page.scheduled')
      : archived
        ? t('page.archived')
        : activity
          ? t('page.activity')
          : artifacts
            ? t('page.artifacts')
            : projects
              ? t('page.projects')
              : pluginPage
                ? pluginTitle
                : undefined;
  const page = customize ? (
    <CustomizePage />
  ) : scheduled ? (
    <ScheduledPage />
  ) : archived ? (
    <ArchivedPage />
  ) : activity ? (
    <ActivityPage />
  ) : artifacts ? (
    <ArtifactsPage />
  ) : projects ? (
    <ProjectsPage />
  ) : pluginPage ? (
    <PluginPage />
  ) : null;
  return (
    <main className="flex h-full min-w-0 flex-col bg-background">
      <Header s={page ? undefined : s} title={title} />
      <div className="flex min-h-0 flex-1 flex-col">
        {page ??
          (s ? (
            <Thread key={s.meta.id} s={s} />
          ) : creating ? (
            <CreatingThread preview={creating} />
          ) : view === 'work' ? (
            <WorkWelcome />
          ) : (
            <CodeWelcome />
          ))}
      </div>
    </main>
  );
}
