import { useRef, useState } from 'react';
import { ArrowUpIcon, CircleStopIcon, CornerDownLeftIcon, FolderIcon, FolderPlusIcon, GitBranchIcon, InfoIcon, LaptopIcon, PlusIcon } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { modKey } from '@/lib/api';
import { fname } from '@/lib/format';
import { cn } from '@/lib/utils';
import { addCoworkFolder, addProject, selectProject, send, setCoworkFolder, stop } from '@/store/actions';
import { modelName, setPref, useApp, useCurrent } from '@/store/app';
import { useDrafts } from '@/store/drafts';
import { Clawd, moodOf } from './Clawd';
import { ComposerInput, pickAttachments, type ComposerHandle } from './ComposerInput';
import { ContextRing, EffortMenu, FootButton, ModeMenu, ModelMenu } from './Menus';
import { PrBar } from './PrBar';

function useSendState() {
  const s = useCurrent();
  const draft = useDrafts((st) => (st.active ? st.drafts[st.active] : undefined));
  const ready = !!(draft?.text.trim() || draft?.attachments.length || draft?.references.length);
  return { s, ready, busy: !!(draft?.sending || draft?.preparing || s?.stopping || s?.historyBusy), stopMode: !!s?.running && !ready };
}

function Chip({ children, className, ...props }: React.ComponentProps<'button'>) {
  return (
    <button {...props} className={cn('flex h-8 max-w-60 items-center gap-1.5 rounded-lg bg-muted/80 px-2.5 text-sm text-foreground/85 hover:bg-accent hover:text-foreground data-[state=open]:bg-accent', className)}>
      {children}
    </button>
  );
}

/** Where a new session runs: environment, project, branch / worktree. */
function NewSessionChips() {
  const projects = useApp((st) => st.projects);
  const project = useApp((st) => st.prefs.project);
  const worktree = useApp((st) => st.prefs.worktree);
  const branch = useApp((st) => st.projectBranch);
  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Chip title="Environment"><LaptopIcon className="size-4 shrink-0" />Local</Chip>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-60">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Environment</DropdownMenuLabel>
          <DropdownMenuItem className="flex-col items-start gap-0"><b className="font-medium">Local</b><span className="text-xs text-muted-foreground">在这台电脑上运行</span></DropdownMenuItem>
          <DropdownMenuItem disabled className="flex-col items-start gap-0"><b className="font-medium">Cloud</b><span className="text-xs text-muted-foreground">即将推出</span></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Chip title={project ?? 'Choose a project'}><FolderIcon className="size-4 shrink-0" /><span className="truncate">{project ? fname(project) : 'Choose a project'}</span></Chip>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-64">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Project</DropdownMenuLabel>
          {projects.map((p) => (
            <DropdownMenuItem key={p.path} onSelect={() => selectProject(p.path)} title={p.path} className={cn(p.path === project && 'font-medium')}>
              <FolderIcon className="size-3.5" />{p.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void addProject()}>
            <PlusIcon className="size-3.5" />Open folder…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {project && (
        <div className="flex h-8 items-center rounded-lg bg-muted/80 text-sm text-foreground/85">
          <span className="flex items-center gap-1.5 pr-2 pl-2.5" title={branch ? `Current branch: ${branch}` : 'Not a git repository'}>
            <GitBranchIcon className="size-4 shrink-0" />
            <span className="max-w-32 truncate">{branch ?? 'no git'}</span>
          </span>
          {branch && (
            <>
              <span className="h-3.5 w-px bg-border" />
              <label className="flex h-full cursor-pointer items-center gap-1.5 rounded-r-lg pr-2.5 pl-2 hover:bg-accent" title="在独立的 git worktree 和分支里工作，不影响当前工作区">
                <input type="checkbox" checked={worktree} onChange={(e) => setPref('worktree', e.target.checked)} className="size-3.5 accent-[var(--info)]" />
                worktree
              </label>
            </>
          )}
        </div>
      )}
      <Chip title="Open folder…" className="w-8 justify-center px-0" onClick={() => void addProject()}>
        <FolderPlusIcon className="size-4" />
      </Chip>
    </div>
  );
}

/** The Code composer, also used inside every running thread (Code and Cowork). */
export function CodeComposer() {
  const { s, ready, busy, stopMode } = useSendState();
  const prefs = useApp((st) => st.prefs);
  const levels = useApp((st) => st.levels);
  const input = useRef<ComposerHandle>(null);
  const [drag, setDrag] = useState(false);
  const placeholder = s?.running
    ? `↵ to send, ${modKey}↵ to queue for later`
    : s ? (s.meta.kind === 'cowork' ? 'Reply to Claude, or type / for commands' : 'Type / for commands') : 'Describe a task or ask a question';
  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-3">
      {!s && <NewSessionChips />}
      {/* The pet walks on whatever is topmost: the PR bar when shown, else the input box. */}
      <div className="relative">
      <Clawd mood={moodOf(s)} from={s ? 0 : 0.6} />
      {s && <PrBar s={s} />}
      <div
        className={cn('relative rounded-xl border bg-card px-4 py-2.5 transition-colors focus-within:border-muted-foreground/50', drag && 'ring-2 ring-primary/50')}
        onClick={(e) => !(e.target as HTMLElement).closest('button') && input.current?.focus()}
      >
        <div className="flex items-end gap-2">
          <ComposerInput ref={input} placeholder={placeholder} className="min-w-0 flex-1 py-0.5" onDragState={setDrag} />
          <button
            disabled={busy}
            onClick={() => (stopMode ? void stop(s!.meta.id) : void send(false))}
            title={stopMode ? 'Stop (Esc)' : 'Send (↵)'}
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-40',
              stopMode ? 'text-foreground hover:bg-accent' : ready ? 'text-foreground hover:bg-accent' : 'text-muted-foreground/70',
            )}
          >
            {stopMode ? <CircleStopIcon className="size-[18px]" /> : <CornerDownLeftIcon className="size-4" />}
          </button>
        </div>
      </div>
      </div>
      <div className="mt-1.5 flex items-center gap-0.5">
        <FootButton title="Add files (type @ to reference a project file)" className="w-7 justify-center px-0" onClick={pickAttachments}>
          <PlusIcon className="size-4" />
        </FootButton>
        <ModeMenu mode={s ? s.meta.mode : prefs.mode} />
        <span className="flex-1" />
        <ModelMenu model={s ? s.model : prefs.model} trigger={<FootButton><ModelLabel id={s ? s.model : prefs.model} /></FootButton>} />
        <EffortMenu levels={s ? s.levels : levels} effort={s ? s.thinking : prefs.effort} />
        <ContextRing pct={s?.ctxPct ?? null} busy={s?.running} sid={s?.meta.id} />
      </div>
    </div>
  );
}

function ModelLabel({ id }: { id: string | null }) {
  const models = useApp((st) => st.models);
  return <span className="truncate">{models.length ? modelName(models, id) : '…'}</span>;
}

/** Cowork's welcome composer: bigger box, model chip inside, folder tray underneath. */
export function CoworkComposer() {
  const { ready, busy } = useSendState();
  const prefs = useApp((st) => st.prefs);
  const levels = useApp((st) => st.levels);
  const folders = useApp((st) => st.coworkFolders);
  const input = useRef<ComposerHandle>(null);
  const [drag, setDrag] = useState(false);
  const folder = prefs.coworkFolder;
  return (
    <div className="w-full">
      <div className={cn('rounded-2xl border bg-card p-3 shadow-sm transition-shadow focus-within:shadow-md', drag && 'ring-2 ring-primary/50')} onClick={(e) => !(e.target as HTMLElement).closest('button') && input.current?.focus()}>
        <ComposerInput ref={input} placeholder="How can I help you today?" minRows={2} maxHeight={240} className="px-1" onDragState={setDrag} />
        <div className="mt-2 flex items-center gap-1">
          <button className="rounded-lg border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="Add files" onClick={pickAttachments}>
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
          <button disabled={!ready || busy} onClick={() => void send(false)} title="Send" className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40">
            <ArrowUpIcon className="size-4" />
          </button>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <FootButton className="text-sm" title={folder || '每个任务新建一个临时工作区'}>
              <FolderIcon className="size-4" />
              <span className="truncate">{folder ? fname(folder) : folder === null ? 'Temporary workspace' : 'Project or folder'}</span>
            </FootButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Work in a folder</DropdownMenuLabel>
            {folders.map((f) => (
              <DropdownMenuItem key={f.path} title={f.path} onSelect={() => setCoworkFolder(f.path)} className={cn(f.path === folder && 'font-medium')}>
                <FolderIcon className="size-3.5" />{f.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onSelect={() => void addCoworkFolder()}>
              <PlusIcon className="size-3.5" />Choose folder…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setCoworkFolder(null)} className={cn(folder === null && 'font-medium')}>Temporary workspace</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="p-1 text-muted-foreground"><InfoIcon className="size-4" /></span>
          </TooltipTrigger>
          <TooltipContent className="max-w-72">Cowork 会在你选择的文件夹里读写文件；删除、移动或往外发送数据前都会先问你。不选文件夹时会新建一个临时工作区。</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
