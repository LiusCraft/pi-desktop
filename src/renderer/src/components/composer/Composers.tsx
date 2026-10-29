import { useRef, useState } from 'react';
import {
  ArrowUpIcon,
  ChevronDownIcon,
  CircleStopIcon,
  CornerDownLeftIcon,
  FolderIcon,
  FolderPlusIcon,
  GitBranchIcon,
  InfoIcon,
  LaptopIcon,
  PlusIcon,
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { modKey } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { fname } from '@/lib/format';
import { cn } from '@/lib/utils';
import { addWorkFolder, addProject, selectProject, send, setWorkFolder, stop } from '@/store/actions';
import { modelName, setApp, setPref, useApp, useCurrent } from '@/store/app';
import { useDrafts } from '@/store/drafts';
import { bashRunning } from '@/store/transcript';
import { Clawd, moodOf, PET_GROUND } from './Clawd';
import { ComposerInput, pickAttachments, type ComposerHandle } from './ComposerInput';
import { ContextRing, EffortMenu, FootButton, ModeMenu, ModelMenu } from './Menus';
import { PrBar } from './PrBar';

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

function Chip({ children, className, ...props }: React.ComponentProps<'button'>) {
  return (
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
}

/** Where a new session runs: environment, project, branch / worktree. */
function NewSessionChips() {
  const t = useT();
  const projects = useApp((st) => st.projects);
  const project = useApp((st) => st.prefs.project);
  const worktree = useApp((st) => st.prefs.worktree);
  const branch = useApp((st) => st.projectBranch);
  const branches = useApp((st) => st.projectBranches);
  const baseRef = useApp((st) => st.baseRef);
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
          <Chip title={project ?? t('composer.chooseProject')}>
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
          {branch && worktree ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex h-full items-center gap-1.5 rounded-l-lg pr-2 pl-2.5 hover:bg-accent data-[state=open]:bg-accent"
                  title={t('composer.worktreeBase', { ref: baseRef ?? branch })}
                >
                  <GitBranchIcon className="size-4 shrink-0" />
                  <span className="max-w-32 truncate">{baseRef ?? branch}</span>
                  <ChevronDownIcon className="size-3 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="max-h-80 w-64 overflow-y-auto">
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  {t('composer.worktreeBaseLabel')}
                </DropdownMenuLabel>
                <DropdownMenuItem
                  onSelect={() => setApp((st) => void (st.baseRef = null))}
                  className={cn(!baseRef && 'font-medium')}
                >
                  <GitBranchIcon className="size-3.5" />
                  <span className="truncate">{branch}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{t('composer.current')}</span>
                </DropdownMenuItem>
                {branches
                  .filter((b) => b !== branch)
                  .map((b) => (
                    <DropdownMenuItem
                      key={b}
                      onSelect={() => setApp((st) => void (st.baseRef = b))}
                      className={cn(b === baseRef && 'font-medium')}
                    >
                      <GitBranchIcon className="size-3.5" />
                      <span className="truncate">{b}</span>
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span
              className="flex items-center gap-1.5 pr-2 pl-2.5"
              title={branch ? t('composer.currentBranch', { branch }) : t('composer.notGit')}
            >
              <GitBranchIcon className="size-4 shrink-0" />
              <span className="max-w-32 truncate">{branch ?? t('composer.noGit')}</span>
            </span>
          )}
          {branch && (
            <>
              <span className="h-3.5 w-px bg-border" />
              <Label
                className="h-full cursor-pointer gap-1.5 rounded-r-lg pr-2.5 pl-2 font-normal hover:bg-accent"
                title={t('composer.worktreeTip')}
              >
                <Checkbox
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

/** The Code composer, also used inside every running thread (Code and Work). */
export function CodeComposer() {
  const t = useT();
  const { s, ready, busy, stopMode } = useSendState();
  const prefs = useApp((st) => st.prefs);
  const levels = useApp((st) => st.levels);
  const input = useRef<ComposerHandle>(null);
  const [drag, setDrag] = useState(false);
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
      {/* The composer shell handles drag and drop; the textarea and buttons inside are keyboard accessible. */}
      {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className={cn(
          'relative rounded-xl border bg-card px-3.5 py-2 transition-colors focus-within:border-muted-foreground/50',
          drag && 'ring-2 ring-primary/50',
        )}
        onClick={(e) => !(e.target as HTMLElement).closest('button') && input.current?.focus()}
      >
        <Clawd mood={moodOf(s)} />
        <div className="flex items-end gap-2">
          <ComposerInput
            ref={input}
            placeholder={placeholder}
            className="min-w-0 flex-1 py-0.5"
            onDragState={setDrag}
          />
          <button
            disabled={busy}
            onClick={() => (stopMode ? void stop(s!.meta.id) : void send(false))}
            title={t(stopMode ? 'composer.stop' : 'composer.sendEnter')}
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-40',
              stopMode
                ? 'text-foreground hover:bg-accent'
                : ready
                  ? 'text-foreground hover:bg-accent'
                  : 'text-muted-foreground/70',
            )}
          >
            {stopMode ? <CircleStopIcon className="size-[18px]" /> : <CornerDownLeftIcon className="size-4" />}
          </button>
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-0.5">
        <FootButton title={t('composer.addFilesRef')} className="w-7 justify-center px-0" onClick={pickAttachments}>
          <PlusIcon className="size-4" />
        </FootButton>
        <ModeMenu mode={s ? s.meta.mode : prefs.mode} />
        <span className="flex-1" />
        <ModelMenu
          model={s ? s.model : prefs.model}
          trigger={
            <FootButton>
              <ModelLabel id={s ? s.model : prefs.model} />
            </FootButton>
          }
        />
        <EffortMenu levels={s ? s.levels : levels} effort={s ? s.thinking : prefs.effort} />
        <ContextRing
          pct={s?.ctxPct ?? null}
          cacheRate={s?.cacheRate ?? null}
          cost={s?.cost ?? null}
          busy={!!(s?.running || s?.compacting)}
          sid={s?.meta.id}
        />
      </div>
    </div>
  );
}

function ModelLabel({ id }: { id: string | null }) {
  const models = useApp((st) => st.models);
  return <span className="truncate">{models.length ? modelName(models, id) : '…'}</span>;
}

/** Work's welcome composer: bigger box, model chip inside, folder tray underneath. */
export function WorkComposer() {
  const t = useT();
  const { ready, busy } = useSendState();
  const prefs = useApp((st) => st.prefs);
  const levels = useApp((st) => st.levels);
  const folders = useApp((st) => st.workFolders);
  const input = useRef<ComposerHandle>(null);
  const [drag, setDrag] = useState(false);
  const folder = prefs.workFolder;
  return (
    <div className="w-full">
      {/* The composer shell handles drag and drop; the textarea and buttons inside are keyboard accessible. */}
      {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className={cn(
          'relative rounded-2xl border bg-card p-3 shadow-sm transition-shadow focus-within:shadow-md',
          drag && 'ring-2 ring-primary/50',
        )}
        onClick={(e) => !(e.target as HTMLElement).closest('button') && input.current?.focus()}
      >
        <Clawd mood="idle" />
        <ComposerInput
          ref={input}
          placeholder={t('composer.workPlaceholder')}
          minRows={2}
          maxHeight={240}
          className="px-1"
          onDragState={setDrag}
        />
        <div className="mt-2 flex items-center gap-1">
          <button
            className="rounded-lg border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title={t('composer.addFiles')}
            onClick={pickAttachments}
          >
            <PlusIcon className="size-4" />
          </button>
          <span className="flex-1" />
          <ModelMenu
            model={prefs.model}
            trigger={
              <FootButton className="text-sm">
                <ModelLabel id={prefs.model} />
              </FootButton>
            }
          />
          <EffortMenu levels={levels} effort={prefs.effort} />
          <button
            disabled={!ready || busy}
            onClick={() => void send(false)}
            title={t('composer.send')}
            className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40"
          >
            <ArrowUpIcon className="size-4" />
          </button>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <FootButton className="text-sm" title={folder || t('composer.tempWorkspaceTip')}>
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
