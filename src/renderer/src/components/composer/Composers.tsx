import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUpIcon,
  FolderIcon,
  FolderPlusIcon,
  GitBranchIcon,
  InfoIcon,
  LaptopIcon,
  LoaderCircleIcon,
  PlusIcon,
  SquareIcon,
  XIcon,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipHint, TooltipTrigger } from '@/components/ui/tooltip';
import { modKey } from '@/lib/api';
import { useShortcutTarget } from '@/lib/shortcut-keys';
import { useT } from '@/lib/i18n';
import { fmtTokPerSec, fname } from '@/lib/format';
import { cn } from '@/lib/utils';
import { addWorkFolder, addProject, selectProject, send, setWorkFolder, stop } from '@/store/actions';
import { modelName, setApp, setPref, useApp, useCurrent } from '@/store/app';
import { chooseBase, refreshBranches, useWelcomeBranches } from '@/store/welcome-branches';
import { useDrafts } from '@/store/drafts';
import type { SessionView } from '@/store/types';
import { bashRunning } from '@/store/transcript';
import { Clawd, moodOf, PET_GROUND, type Mood } from './Clawd';
import { ComposerInput, pickAttachments, type ComposerHandle } from './ComposerInput';
import { ComposerTodos } from './ComposerTodos';
import { ContextRing, EffortMenu, FootButton, ModeMenu, ModelMenu } from './Menus';
import { PrBar } from './PrBar';
import { WorktreeBasePicker } from './WorktreeBasePicker';

function SessionRate({ s }: { s: SessionView }) {
  const t = useT();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!s.running) return;
    const timer = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(timer);
  }, [s.running]);
  const activeStreamMs = s.running ? s.streamMs + (s.cur?.streamT0 ? Math.max(0, Date.now() - s.cur.streamT0) : 0) : 0;
  const elapsed = s.sessionStreamMs + activeStreamMs;
  const tokens = s.sessionTokens + (s.running ? s.streamTokens : 0);
  const rate = fmtTokPerSec(tokens, elapsed);
  return (
    <span
      className="min-w-20 px-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums"
      title={t('transcript.rateTip')}
    >
      {t('transcript.rate', { rate })}
    </span>
  );
}

function useSendState() {
  const s = useCurrent();
  const draft = useDrafts((st) => (st.active ? st.drafts[st.active] : undefined));
  const ready = !!(draft?.text.trim() || draft?.attachments.length || draft?.references.length);
  // A command of the user's still running counts as busy: Stop ends it.
  const stopMode = !!(s?.running || s?.compacting || bashRunning(s)) && !ready;
  // While compacting only Stop stays available: pi rejects a prompt until the compaction ends.
  const busy = !!(draft?.sending || draft?.preparing || s?.stopping || s?.historyBusy || (s?.compacting && !stopMode));
  return { s, ready, busy, stopMode };
}

function Chip({ children, className, title, ...props }: React.ComponentProps<'button'>) {
  const button = (
    <button
      {...props}
      {...PET_GROUND}
      className={cn(
        'flex h-8 max-w-60 items-center gap-1.5 rounded-lg bg-muted/80 px-2.5 text-sm text-foreground/85 hover:bg-accent hover:text-foreground data-[state=open]:bg-accent',
        className,
      )}
    >
      {children}
    </button>
  );
  return <TooltipHint title={title}>{button}</TooltipHint>;
}

/** Where a new session runs: environment, project, branch / worktree. */
function NewSessionChips() {
  const t = useT();
  const projects = useApp((st) => st.projects);
  const project = useApp((st) => st.prefs.project);
  const folderTarget = useShortcutTarget('folder', project ?? t('composer.chooseProject'));
  const worktreeTarget = useShortcutTarget('worktree', t('composer.worktreeTip'));
  const worktree = useApp((st) => st.prefs.worktree);
  const info = useWelcomeBranches((st) => (project ? st[project] : undefined));
  const branch = info?.current;
  const baseRef = info?.selected ?? info?.defaultRef;
  useEffect(() => {
    if (project) void refreshBranches(project);
  }, [project]);
  const adopt = useApp((st) => (st.adopt && st.adopt.mainRoot === st.prefs.project ? st.adopt : null));
  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Chip title={t('composer.environment')}>
            <LaptopIcon className="size-4 shrink-0" />
            {t('composer.local')}
          </Chip>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-60">
          <DropdownMenuLabel className="text-xs text-muted-foreground">{t('composer.environment')}</DropdownMenuLabel>
          <DropdownMenuItem className="flex-col items-start gap-0">
            <b className="font-medium">{t('composer.local')}</b>
            <span className="text-xs text-muted-foreground">{t('composer.localHint')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem disabled className="flex-col items-start gap-0">
            <b className="font-medium">{t('composer.cloud')}</b>
            <span className="text-xs text-muted-foreground">{t('composer.comingSoon')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Chip {...folderTarget} data-shortcut-menu>
            <FolderIcon className="size-4 shrink-0" />
            <span className="truncate">{project ? fname(project) : t('composer.chooseProject')}</span>
          </Chip>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-64">
          <DropdownMenuLabel className="text-xs text-muted-foreground">{t('composer.project')}</DropdownMenuLabel>
          {projects.map((p) => (
            <DropdownMenuItem
              key={p.path}
              onSelect={() => selectProject(p.path)}
              title={p.path}
              className={cn(p.path === project && 'font-medium')}
            >
              <FolderIcon className="size-3.5" />
              {p.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void addProject()}>
            <PlusIcon className="size-3.5" />
            {t('composer.openFolder')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {adopt && (
        <div
          {...PET_GROUND}
          className="flex h-8 items-center rounded-lg bg-muted/80 text-sm text-foreground/85"
          title={t('composer.workInWorktree', { path: adopt.path })}
        >
          <span className="flex items-center gap-1.5 pr-2 pl-2.5">
            <GitBranchIcon className="size-4 shrink-0" />
            <span className="max-w-40 truncate">{adopt.branch ?? fname(adopt.path)}</span>
            <span className="text-xs text-muted-foreground">{t('composer.existingWorktree')}</span>
          </span>
          <button
            className="h-full rounded-r-lg px-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            title={t('composer.newWorktreeInstead')}
            aria-label={t('composer.dontUseWorktree')}
            onClick={() => setApp((st) => void (st.adopt = null))}
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      )}
      {project && !adopt && (
        <div {...PET_GROUND} className="flex h-8 items-center rounded-lg bg-muted/80 text-sm text-foreground/85">
          {info === undefined ? (
            <span role="status" className="flex items-center gap-1.5 px-2.5 text-muted-foreground">
              <LoaderCircleIcon aria-hidden className="size-4 motion-safe:animate-spin" />
              {t('panel.loadingBranches')}
            </span>
          ) : branch && worktree ? (
            <WorktreeBasePicker
              key={project}
              branch={branch}
              branches={info.branches}
              base={baseRef ?? branch}
              onSelect={(ref) => chooseBase(project, ref)}
            />
          ) : (
            <span
              className="flex items-center gap-1.5 pr-2 pl-2.5"
              title={branch ? t('composer.currentBranch', { branch }) : info ? t('composer.notGit') : undefined}
            >
              <GitBranchIcon className="size-4 shrink-0" />
              <span className="max-w-32 truncate">
                {branch ?? t(info ? 'composer.noGit' : 'composer.branchUnavailable')}
              </span>
            </span>
          )}
          {branch && (
            <>
              <span className="h-3.5 w-px bg-border" />
              <Label className="h-full cursor-pointer gap-1.5 rounded-r-lg pr-2.5 pl-2 font-normal hover:bg-accent">
                <Checkbox
                  {...worktreeTarget}
                  checked={worktree}
                  onCheckedChange={(v) => setPref('worktree', v === true)}
                  className="size-3.5"
                />
                worktree
              </Label>
            </>
          )}
        </div>
      )}
      <Chip title={t('composer.openFolder')} className="w-8 justify-center px-0" onClick={() => void addProject()}>
        <FolderPlusIcon className="size-4" />
      </Chip>
    </div>
  );
}

function ComposerCard({
  placeholder,
  mood,
  maxHeight,
  leading,
  children,
}: {
  placeholder: string;
  mood: Mood;
  maxHeight?: number;
  leading: ReactNode;
  children: ReactNode;
}) {
  const input = useRef<ComposerHandle>(null);
  const [drag, setDrag] = useState(false);
  return (
    // Clicking the card's padding brings focus back to the editor.
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className={cn('relative rounded-3xl surface-flat bg-card px-2.5 pt-3 pb-2', drag && 'ring-2 ring-primary/50')}
      onClick={(e) => e.target === e.currentTarget && input.current?.focus()}
    >
      <Clawd mood={mood} />
      <ComposerInput
        ref={input}
        placeholder={placeholder}
        minRows={2}
        maxHeight={maxHeight}
        className="px-2"
        onDragState={setDrag}
      />
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <div className="flex max-w-full items-center gap-0.5">{leading}</div>
        <div className="flex min-w-0 flex-[1_1_11rem] items-center justify-end gap-0.5">{children}</div>
      </div>
    </div>
  );
}

function ComposerAction({
  label,
  disabled,
  stopping = false,
  onClick,
}: {
  label: string;
  disabled: boolean;
  stopping?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="ml-1 flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring disabled:bg-muted disabled:text-muted-foreground"
    >
      {stopping ? (
        <SquareIcon aria-hidden className="size-3 fill-current" />
      ) : (
        <ArrowUpIcon aria-hidden className="size-5" />
      )}
    </button>
  );
}

/** The Code composer, also used inside every running thread (Code and Work). */
export function CodeComposer() {
  const t = useT();
  const { s, ready, busy, stopMode } = useSendState();
  const prefs = useApp((st) => st.prefs);
  const levels = useApp((st) => st.levels);
  const modelTarget = useShortcutTarget('model', t('shortcuts.model'));
  const attachmentsTarget = useShortcutTarget('attachments', t('composer.addFilesRef'));
  const model = s ? s.model : prefs.model;
  const placeholder = s?.running
    ? t('composer.placeholderQueue', { mod: modKey })
    : s
      ? t(s.meta.kind === 'work' ? 'composer.placeholderWork' : 'composer.placeholderCode')
      : t('composer.placeholderNew');
  return (
    <div className="mx-auto w-full max-w-[786px] px-6 pb-3">
      {!s && <NewSessionChips />}
      {/* The pet lives on the input box and hops onto the PR bar above it (and onto the new-session chips). */}
      {s && (
        <div {...PET_GROUND}>
          <PrBar s={s} />
        </div>
      )}
      {s && <ComposerTodos items={s.lastTodos} />}
      <ComposerCard
        placeholder={placeholder}
        mood={moodOf(s)}
        leading={
          <>
            <FootButton
              {...attachmentsTarget}
              aria-label={t('composer.addFiles')}
              className="w-8 shrink-0 justify-center px-0"
              onClick={pickAttachments}
            >
              <PlusIcon aria-hidden className="size-5" />
            </FootButton>
            <ModeMenu mode={s ? s.meta.mode : prefs.mode} />
            {s && <SessionRate s={s} />}
          </>
        }
      >
        <ModelMenu
          model={model}
          trigger={
            <FootButton {...modelTarget} className="min-w-0 text-foreground">
              <ModelLabel id={model} />
            </FootButton>
          }
        />
        <EffortMenu levels={s ? s.levels : levels} effort={s ? s.thinking : prefs.effort} />
        {s && (
          <ContextRing
            pct={s.ctxPct ?? null}
            cacheRate={s.cacheRate ?? null}
            cost={s.cost ?? null}
            busy={s.running || s.compacting}
            sid={s.meta.id}
          />
        )}
        <ComposerAction
          label={t(stopMode ? 'composer.stop' : 'composer.sendEnter')}
          disabled={busy || (!ready && !stopMode)}
          stopping={stopMode}
          onClick={() => (stopMode && s ? void stop(s.meta.id) : void send(false))}
        />
      </ComposerCard>
    </div>
  );
}

function ModelLabel({ id }: { id: string | null }) {
  const models = useApp((st) => st.models);
  const t = useT();
  return models.length || id ? (
    <span className="truncate">{modelName(models, id)}</span>
  ) : (
    <span role="status" aria-label={t('composer.loadingModel')}>
      <LoaderCircleIcon aria-hidden className="size-3.5 motion-safe:animate-spin" />
    </span>
  );
}

/** Work's welcome composer, with the folder tray underneath. */
export function WorkComposer() {
  const t = useT();
  const { ready, busy } = useSendState();
  const prefs = useApp((st) => st.prefs);
  const levels = useApp((st) => st.levels);
  const folders = useApp((st) => st.workFolders);
  const folder = prefs.workFolder;
  const folderTarget = useShortcutTarget('folder', folder || t('composer.tempWorkspaceTip'));
  const modelTarget = useShortcutTarget('model', t('shortcuts.model'));
  const attachmentsTarget = useShortcutTarget('attachments', t('composer.addFiles'));
  return (
    <div className="w-full">
      <ComposerCard
        placeholder={t('composer.workPlaceholder')}
        mood="idle"
        maxHeight={240}
        leading={
          <FootButton
            {...attachmentsTarget}
            aria-label={t('composer.addFiles')}
            className="w-8 shrink-0 justify-center px-0"
            onClick={pickAttachments}
          >
            <PlusIcon aria-hidden className="size-5" />
          </FootButton>
        }
      >
        <ModelMenu
          model={prefs.model}
          trigger={
            <FootButton {...modelTarget} className="min-w-0 text-foreground">
              <ModelLabel id={prefs.model} />
            </FootButton>
          }
        />
        <EffortMenu levels={levels} effort={prefs.effort} />
        <ComposerAction label={t('composer.send')} disabled={!ready || busy} onClick={() => void send(false)} />
      </ComposerCard>
      <div className="mt-2 flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <FootButton {...folderTarget} data-shortcut-menu className="text-sm">
              <FolderIcon className="size-4" />
              <span className="truncate">
                {folder ? fname(folder) : folder === null ? t('composer.tempWorkspace') : t('composer.projectOrFolder')}
              </span>
            </FootButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {t('composer.workInFolder')}
            </DropdownMenuLabel>
            {folders.map((f) => (
              <DropdownMenuItem
                key={f.path}
                title={f.path}
                onSelect={() => setWorkFolder(f.path)}
                className={cn(f.path === folder && 'font-medium')}
              >
                <FolderIcon className="size-3.5" />
                {f.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onSelect={() => void addWorkFolder()}>
              <PlusIcon className="size-3.5" />
              {t('composer.chooseFolder')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setWorkFolder(null)} className={cn(folder === null && 'font-medium')}>
              {t('composer.tempWorkspace')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="p-1 text-muted-foreground">
              <InfoIcon className="size-4" />
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-72">{t('composer.workTip')}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
