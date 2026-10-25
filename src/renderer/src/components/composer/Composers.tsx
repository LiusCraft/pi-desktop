import { useRef, useState } from 'react';
import { ArrowUpIcon, CornerDownLeftIcon, FolderIcon, InfoIcon, LaptopIcon, PlusIcon, SquareIcon } from 'lucide-react';
import { toast } from 'sonner';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { call, modKey } from '@/lib/api';
import { fname } from '@/lib/format';
import { cn } from '@/lib/utils';
import { addCoworkFolder, addProject, fail, selectProject, send, setCoworkFolder, stop } from '@/store/actions';
import { modelName, useApp, useCurrent } from '@/store/app';
import { useDrafts } from '@/store/drafts';
import { ComposerInput, pickAttachments, type ComposerHandle } from './ComposerInput';
import { ContextRing, EffortMenu, FootButton, ModeMenu, ModelMenu } from './Menus';
import { PrBar } from './PrBar';

function useSendState() {
  const s = useCurrent();
  const draft = useDrafts((st) => (st.active ? st.drafts[st.active] : undefined));
  const ready = !!(draft?.text.trim() || draft?.attachments.length);
  return { s, ready, busy: !!(draft?.sending || draft?.preparing || s?.stopping), stopMode: !!s?.running && !ready };
}

/** Claude Code's pixel mascot; it bobs while the agent works. */
function Clawd({ busy }: { busy: boolean }) {
  return (
    <svg className={cn('clawd pointer-events-none absolute -top-[26px] left-5', busy && 'busy')} viewBox="0 0 22 14" width="38" height="24" shapeRendering="crispEdges" aria-hidden>
      <g fill="#d97757">
        <rect x="3" y="0" width="16" height="10" />
        <rect x="0" y="4" width="3" height="3" />
        <rect x="19" y="4" width="3" height="3" />
        <rect x="4" y="10" width="2" height="4" />
        <rect x="8" y="10" width="2" height="4" />
        <rect x="12" y="10" width="2" height="4" />
        <rect x="16" y="10" width="2" height="4" />
      </g>
      <g fill="#141413">
        <rect x="6" y="3" width="2" height="2" />
        <rect x="14" y="3" width="2" height="2" />
      </g>
    </svg>
  );
}

function ProjectButton() {
  const s = useCurrent();
  const projects = useApp((st) => st.projects);
  const project = useApp((st) => st.prefs.project);
  if (s) {
    const cowork = s.meta.kind === 'cowork';
    return (
      <FootButton
        title={s.meta.cwd}
        onClick={() => (cowork ? call('sessions:openPath', s.meta.id, '.', false).catch(fail) : toast(s.meta.cwd))}
      >
        {cowork ? <FolderIcon className="size-3.5" /> : <LaptopIcon className="size-3.5" />}
        <span className="truncate">{s.meta.scratch ? 'Temporary workspace' : fname(s.meta.projectPath)}</span>
      </FootButton>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <FootButton title="Project">
          <LaptopIcon className="size-3.5" />
          <span className="truncate">{project ? fname(project) : 'Choose a project'}</span>
        </FootButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Project</DropdownMenuLabel>
        {projects.map((p) => (
          <DropdownMenuItem key={p.path} onSelect={() => selectProject(p.path)} title={p.path} className={cn(p.path === project && 'font-medium')}>
            <LaptopIcon className="size-3.5" />{p.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void addProject()}>
          <PlusIcon className="size-3.5" />Open folder…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
    <div className="mx-auto w-full max-w-3xl px-6 pb-4">
      {s && <PrBar s={s} />}
      <div
        className={cn('relative rounded-2xl border bg-card px-3 pt-3 pb-2 shadow-sm transition-shadow focus-within:shadow-md', drag && 'ring-2 ring-primary/50')}
        onClick={(e) => !(e.target as HTMLElement).closest('button') && input.current?.focus()}
      >
        <Clawd busy={!!s?.running} />
        <div className="flex items-end gap-2">
          <button className="mb-0.5 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="Add files (type @ to reference a project file)" onClick={pickAttachments}>
            <PlusIcon className="size-4" />
          </button>
          <ComposerInput ref={input} placeholder={placeholder} className="min-w-0 flex-1 py-1" onDragState={setDrag} />
          <button
            disabled={busy}
            onClick={() => (stopMode ? void stop(s!.meta.id) : void send(false))}
            title={stopMode ? 'Stop (Esc)' : 'Send (↵)'}
            className={cn(
              'mb-0.5 flex size-8 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40',
              stopMode ? 'bg-foreground text-background' : ready ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
            )}
          >
            {stopMode ? <SquareIcon className="size-3 fill-current" /> : <CornerDownLeftIcon className="size-4" />}
          </button>
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-0.5">
        <ProjectButton />
        <ModeMenu mode={s ? s.meta.mode : prefs.mode} />
        <span className="flex-1" />
        <ModelMenu model={s ? s.model : prefs.model} trigger={<FootButton><ModelLabel id={s ? s.model : prefs.model} /></FootButton>} />
        <EffortMenu levels={s ? s.levels : levels} effort={s ? s.thinking : prefs.effort} />
        <ContextRing pct={s?.ctxPct ?? null} busy={s?.running} />
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
