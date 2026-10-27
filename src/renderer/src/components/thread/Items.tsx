import { memo, useState } from 'react';
import { ArrowUpRightIcon, BookmarkIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, CircleAlertIcon, GitForkIcon, GitMergeIcon, LightbulbIcon, LoaderCircleIcon, MessageCircleQuestionIcon, MessagesSquareIcon, RotateCcwIcon, TerminalIcon, XIcon } from 'lucide-react';
import { PLAN_CHOICES } from '@shared/protocol';
import type { MessageKey } from '@shared/i18n';
import { BUILTIN_COMMAND_INFO, commandLabel, decodeCommandMessage, type CommandMessage } from '@shared/command-message';
import { decodePeerMessage, type PeerMessage } from '@shared/peer-message';
import * as previews from '@shared/tool-previews';
import { Markdown } from '@/components/common/Markdown';
import { CopyGlyph, useCopy } from '@/components/common/Copy';
import { AttachmentTiles } from '@/components/common/Attachments';
import { ContextCards } from '@/components/composer/ContextCards';
import { decodeReferencePrompt } from '@shared/context-reference';
import { DiffRows, TermOutput, ToolPreviewView } from '@/components/common/CodeView';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Kbd } from '@/components/ui/kbd';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { QuestionsItem } from './Questions';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { call } from '@/lib/api';
import { t as tr, useT } from '@/lib/i18n';
import { ago, fmtTok } from '@/lib/format';
import { bareName, groupStats, groupSummary, isFileTool, toolLabel, toolScope, type ToolState } from '@/lib/tools';
import { cn } from '@/lib/utils';
import { useApp, updateSession } from '@/store/app';
import { forgeName, forgeOfUrl } from '@shared/forge';
import {
  answerUi, dismissSuggested, doSuggestedHere, forkSession, openAgent, openContextReference, openDiffRef, openFileRef, openPlan, openSession, sessionDraftKey, startSuggested, userMessageAction,
} from '@/store/actions';
import { drafts } from '@/store/drafts';
import { findByKey, findTool, permissionTitle } from '@/store/transcript';
import type { Item, ItemOf } from '@/store/types';

// ------------------------------------------------------------ user

/** `quoted`: for each reference of the message, the transcript item it replies to (see lib/quote-links). */
export const UserItem = memo(function UserItem({ sid, item, quoted }: { sid: string; item: ItemOf<'user'>; quoted?: (string | null)[] }) {
  const t = useT();
  const { copied, copy } = useCopy();
  const busy = useApp((state) => !!(state.sessions[sid]?.running || state.sessions[sid]?.historyBusy || state.sessions[sid]?.pendingUser.length));
  const peer = decodePeerMessage(item.text);
  if (peer) return <PeerMessageCard peer={peer} />;
  const command = decodeCommandMessage(item.text);
  if (command) return <CommandMessageChip sid={sid} command={command}queued={item.queued} />;
  // Context the user attached is shown as cards, like in the composer; only what they typed stays text.
  const attached = decodeReferencePrompt(item.text);
  const typed = attached ? attached.text : item.text;
  return (
    <div className={cn('flex flex-col items-end gap-1.5', item.queued && 'opacity-60')} title={item.queued ? t('thread.queued') : undefined}>
      <AttachmentTiles attachments={item.attachments} />
      {attached && <div className="flex max-w-[85%] justify-end"><ContextCards references={attached.references} onOpen={(reference) => openContextReference(reference, quoted?.[attached.references.indexOf(reference)] ?? null)} /></div>}
      {typed && (
        <div data-selectable className="max-w-[85%] rounded-2xl bg-user-bubble px-4 py-2.5 whitespace-pre-wrap break-words">
          {typed.split(/(@[\w./-]+)/g).map((part, i) => (part.startsWith('@') ? <span key={i} className="text-primary">{part}</span> : part))}
        </div>
      )}
      {item.delivered && !item.queued && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {item.timestamp && <span className="mr-1" title={new Date(item.timestamp).toLocaleString()}>{ago(item.timestamp, true)}</span>}
          <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={t(copied ? 'thread.copiedMessage' : 'thread.copyMessage')} title={t(copied ? 'thread.copied' : 'thread.copyMessage')} onClick={() => copy(item.text)}>
            <CopyGlyph copied={copied} />
          </Button>
          {item.entryId && <>
            <Tooltip><TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="size-7" disabled={busy} aria-label={t('thread.rewind')} onClick={() => void userMessageAction(sid, item.entryId!, 'rewind')}>
                <RotateCcwIcon data-icon="inline-start" />
              </Button>
            </TooltipTrigger><TooltipContent>{t('thread.rewind.tip')}</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="size-7" disabled={busy} aria-label={t('thread.fork')} onClick={() => void userMessageAction(sid, item.entryId!, 'fork')}>
                <GitForkIcon data-icon="inline-start" />
              </Button>
            </TooltipTrigger><TooltipContent>{t('thread.fork.tip')}</TooltipContent></Tooltip>
          </>}
        </div>
      )}
      {item.notice && <div className="text-xs text-muted-foreground">{item.notice}</div>}
      {item.failed && (
        <div className="flex items-center gap-2 text-xs text-destructive">
          {t('thread.deliveryFailed')}
          <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => item.submission && drafts.recover(sessionDraftKey(sid), item.submission)}>
            {t('thread.restoreDraft')}
          </Button>
        </div>
      )}
    </div>
  );
});

/** A button of Pi Desktop's own (Commit, Create PR, ...) shown as the command it ran; click to read the instruction it expanded to. */
function CommandMessageChip({ sid, command, queued }: { sid: string; command: CommandMessage; queued?: boolean }) {
  const t = useT();
  const userCommands = useApp((st) => st.sessions[sid]?.commands);
  const label = commandLabel(command.name, (userCommands ?? []).map((c) => c.name));
  return (
    <div className={cn('flex justify-end', queued && 'opacity-60')}>
      <Popover>
        <PopoverTrigger asChild>
          <button className="flex items-center gap-1.5 rounded-2xl bg-user-bubble px-3.5 py-2 font-mono text-sm transition-colors hover:bg-accent data-[state=open]:bg-accent" title={t('thread.commandTip')}>
            <TerminalIcon className="size-3.5 text-muted-foreground" />/{label}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-96 p-0">
          <div className="border-b px-3 py-2">
            <div className="font-mono text-xs font-medium">/{label}</div>
            <div className="text-xs text-muted-foreground">{t(BUILTIN_COMMAND_INFO[command.name])}</div>
          </div>
          <div data-selectable className="max-h-72 overflow-y-auto px-3 py-2 text-xs whitespace-pre-wrap break-words">{command.prompt}</div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** A message another session of the project sent: shown as theirs, with a way back to them. */
function PeerMessageCard({ peer }: { peer: PeerMessage }) {
  const t = useT();
  const known = useApp((st) => !!st.sessions[peer.fromId]);
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-xl border bg-card px-3.5 py-2.5 text-sm">
        <button
          disabled={!known}
          className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground enabled:hover:text-foreground"
          title={t(known ? 'thread.peerOpen' : 'thread.peerGone')}
          onClick={() => void openSession(peer.fromId)}
        >
          <MessagesSquareIcon className="size-3.5" />{t('thread.fromSession', { title: peer.fromTitle })}{known && <ArrowUpRightIcon className="size-3" />}
        </button>
        <div data-selectable className="break-words whitespace-pre-wrap">{peer.text}</div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ PR events

/**
 * A turn Pi Desktop started because something happened on the pull request. It belongs to
 * the agent side of the conversation: no user bubble, and it says what it is doing now.
 */
export const PrEventItem = memo(function PrEventItem({ sid, item }: { sid: string; item: ItemOf<'prEvent'> }) {
  const t = useT();
  const running = useApp((st) => !!st.sessions[sid]?.running);
  const waiting = useApp((st) => !!st.sessions[sid]?.waiting);
  const [open, setOpen] = useState(false);
  const { event } = item;
  const look = {
    'ci-fail': { Icon: CircleAlertIcon, tone: 'text-destructive', label: t('prevent.ciFail') },
    notes: { Icon: MessagesSquareIcon, tone: 'text-info', label: t('prevent.notes') },
    merge: { Icon: GitMergeIcon, tone: 'text-success', label: t('prevent.merge') },
  }[event.kind];
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[85%] rounded-xl border border-dashed bg-card/60 px-3.5 py-2.5 text-sm">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <look.Icon className={cn('size-3.5 shrink-0', look.tone)} />
          <span className={cn('font-medium', look.tone)}>{look.label}</span>
          <span className="opacity-50">·</span>
          <button className="truncate hover:text-foreground" title={t('prevent.openOn', { forge: forgeName(forgeOfUrl(event.url)) })} onClick={() => void call('app:openExternal', event.url)}>PR #{event.num}</button>
          <span className="ml-auto shrink-0 tabular-nums">{ago(item.at)}</span>
        </div>
        <div className="mt-1.5 text-foreground">{event.summary}</div>
        {!!event.failed?.length && (
          <ul className="mt-1 space-y-0.5 text-xs">
            {event.failed.map((f) => (
              <li key={f.name} className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <span className="size-1.5 shrink-0 rounded-full bg-destructive" />
                {f.url ? (
                  <button className="truncate hover:text-foreground hover:underline" title={t('prevent.openLog')} onClick={() => void call('app:openExternal', f.url!)}>{f.name}</button>
                ) : (
                  <span className="truncate">{f.name}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {!!event.notes?.length && (
          <ul className="mt-1.5 space-y-1.5">
            {event.notes.map((n) => (
              <li key={n.id} className="rounded-lg bg-muted/50 px-2.5 py-1.5 text-xs">
                <span className="text-muted-foreground">@{n.author}</span>
                <div className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-foreground/90">{n.body}</div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex items-center gap-2 text-xs">
          {waiting ? (
            <span className="flex items-center gap-1.5 text-warning"><CircleAlertIcon className="size-3.5" />{t('prevent.waiting')}</span>
          ) : running ? (
            <span className="flex items-center gap-1.5 text-muted-foreground"><LoaderCircleIcon className="size-3.5 animate-spin" />{t('prevent.working')}</span>
          ) : (
            <span className="text-muted-foreground">{t('prevent.trigger')}</span>
          )}
          <button className="ml-auto flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground" onClick={() => setOpen(!open)}>
            {t(open ? 'prevent.collapse' : 'prevent.showInstruction')}
            <ChevronDownIcon className={cn('size-3 transition-transform', open && 'rotate-180')} />
          </button>
        </div>
        {open && (
          <div data-selectable className="mt-1.5 rounded-lg bg-muted/40 px-2.5 py-2 text-xs whitespace-pre-wrap text-muted-foreground">{event.instruction}</div>
        )}
      </div>
    </div>
  );
});

// ------------------------------------------------------------ suggested tasks

/** Work the agent noticed outside the current task: the user decides where (or whether) it runs. */
export const SuggestItem = memo(function SuggestItem({ sid, item }: { sid: string; item: ItemOf<'suggest'> }) {
  const t = useT();
  const decided = useApp((st) => st.sessions[sid]?.meta.suggestions);
  const [open, setOpen] = useState<number | null>(null);
  const open_ = (id: string) => void openSession(id);
  const waiting = item.tasks.map((task, index) => ({ task, index })).filter(({ index }) => !decided?.[`${item.toolCallId}:${index}`]);
  return (
    <div className="rounded-xl border bg-card px-4 py-3 text-sm shadow-sm">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <LightbulbIcon className="size-3.5" />{t('suggest.title')}<span className="font-normal">{t('suggest.sub')}</span>
      </div>
      <div className="divide-y">
        {item.tasks.map((task, index) => {
          const state = decided?.[`${item.toolCallId}:${index}`];
          return (
            <div key={index} className="py-2.5 first:pt-0 last:pb-0">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{task.title}</div>
                  <button className={cn('mt-0.5 text-left text-xs text-muted-foreground hover:text-foreground', open !== index && 'line-clamp-2')} onClick={() => setOpen(open === index ? null : index)} title={t('suggest.toggle')}>
                    {task.prompt}
                  </button>
                </div>
                {!state && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button size="sm" className="h-7" onClick={() => void startSuggested(sid, item, index, task)} title={t('suggest.startTip')}>{t('suggest.start')}</Button>
                    <Button size="sm" variant="outline" className="h-7" onClick={() => void doSuggestedHere(sid, item, index, task)} title={t('suggest.doHereTip')}>{t('suggest.doHere')}</Button>
                    <Button size="icon" variant="ghost" className="size-7" aria-label={t('suggest.dismiss')} title={t('suggest.dismiss')} onClick={() => void dismissSuggested(sid, item, index)}><XIcon className="size-3.5" /></Button>
                  </div>
                )}
              </div>
              {state && (
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  {state.state === 'started' && <><CheckIcon className="size-3.5 text-success" />{t('suggest.started')}{state.sessionId && <button className="text-primary hover:underline" onClick={() => open_(state.sessionId!)}>{t('suggest.open')}</button>}</>}
                  {state.state === 'here' && <><CheckIcon className="size-3.5 text-success" />{t('suggest.sentHere')}</>}
                  {state.state === 'dismissed' && <>{t('suggest.dismissed')}</>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {waiting.length > 1 && (
        <div className="mt-2.5 flex justify-end border-t pt-2.5">
          <Button size="sm" variant="outline" className="h-7" onClick={() => waiting.forEach(({ task, index }) => void startSuggested(sid, item, index, task))}>{t('suggest.startAll')}</Button>
        </div>
      )}
    </div>
  );
});

// ------------------------------------------------------------ assistant text and notes

export const TextItem = memo(function TextItem({ item }: { item: ItemOf<'text'> }) {
  return (
    <Markdown text={item.text}>
      {item.live && <span className="ml-0.5 inline-block size-2 animate-pulse rounded-full bg-primary align-middle" />}
    </Markdown>
  );
});

export const NoteItem = memo(function NoteItem({ item }: { item: ItemOf<'note'> }) {
  return <div className={cn('rounded-md px-3 py-1.5 text-xs whitespace-pre-wrap', item.level === 'error' ? 'bg-destructive/10 text-destructive' : 'text-muted-foreground')}>{item.text}</div>;
});

export const FootItem = memo(function FootItem({ sid, item, prevText }: { sid: string; item: ItemOf<'foot'>; prevText?: string }) {
  const t = useT();
  const { copied, copy } = useCopy();
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <Button variant="ghost" size="icon" className="size-7" title={t(copied ? 'foot.copied' : 'foot.copy')} onClick={() => copy(prevText ?? '')}>
        <CopyGlyph copied={copied} />
      </Button>
      <Button variant="ghost" size="icon" className="size-7" title={t('foot.fork')} onClick={() => void forkSession(sid)}>
        <GitForkIcon className="size-3.5" />
      </Button>
      <span>{ago(item.t, true)}</span>
      {item.usage && <span>· {item.usage}</span>}
    </div>
  );
});

// ------------------------------------------------------------ todos

export function TodoList({ items }: { items: ItemOf<'todos'>['items'] }) {
  return (
    <div className="space-y-1">
      {items.map((t, i) => (
        <div key={i} className={cn('flex items-start gap-2 text-sm', t.status === 'completed' && 'text-muted-foreground line-through', t.status === 'in_progress' && 'font-medium')}>
          <span className={cn('mt-[3px] flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border', t.status === 'completed' && 'border-primary bg-primary text-primary-foreground', t.status === 'in_progress' && 'border-primary')}>
            {t.status === 'completed' && <CheckIcon className="size-2.5" strokeWidth={3} />}
            {t.status === 'in_progress' && <span className="size-1.5 rounded-full bg-primary" />}
          </span>
          <span>{t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}</span>
        </div>
      ))}
    </div>
  );
}

export const TodosItem = memo(function TodosItem({ item }: { item: ItemOf<'todos'> }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <TodoList items={item.items} />
    </div>
  );
});

// ------------------------------------------------------------ tool groups

function toggleGroup(sid: string, key: string) {
  updateSession(sid, (v) => {
    const g = findByKey(v, key);
    if (g?.kind !== 'group') return;
    g.open = !g.open;
    g.userToggled = true;
  });
}
function toggleTool(sid: string, id: string) {
  updateSession(sid, (v) => {
    const found = findTool(v, id);
    if (found) found.tool.open = !found.tool.open;
  });
}
function toggleThought(sid: string, key: string, index: number, open: boolean) {
  updateSession(sid, (v) => {
    const g = findByKey(v, key);
    if (g?.kind !== 'group' || !g.thoughts[index]) return;
    g.thoughts[index].open = open;
    g.thoughts[index].userToggled = true;
  });
}

const Stat = ({ add, del }: { add?: number; del?: number }) => (
  <>
    {!!add && <span className="font-mono text-xs text-success">+{add}</span>}
    {!!del && <span className="font-mono text-xs text-destructive">−{del}</span>}
  </>
);

/** What a read tool returned for an image file, so the viewer can show files outside the session too. */
const readImageSrc = (tool: ToolState) => (tool.preview?.type === 'image' ? tool.preview.images[0]?.src : undefined);

/** Tool name and action of the call that saves an artifact; its result names the id in parentheses. */
const ARTIFACT_TOOL = 'artifact_manage';
const ARTIFACT_SAVE = 'save';
const ARTIFACT_RESULT_ID = /\(([a-z0-9][a-z0-9-]*)\)/;

function ArtifactPreviewButton({ tool }: { tool: ToolState }) {
  const t = useT();
  const id = ARTIFACT_RESULT_ID.exec(tool.output ?? '')?.[1];
  if (!id) return null;
  return (
    <button className="w-full border-t px-3 py-1 text-left text-xs text-primary hover:bg-accent" onClick={() => void call('artifacts:preview', id).catch(() => {})}>
      {t('tool.preview')}
    </button>
  );
}

function ToolDetail({ sid, tool }: { sid: string; tool: ToolState }) {
  if (tool.preview) return <ToolPreviewView preview={tool.preview} path={tool.path ?? ''} sid={sid} onOpenImage={(src) => void openFileRef(tool.path!, undefined, src)} />;
  if (tool.kind === 'bash') return <TermOutput cmd={tool.cmd} out={tool.output ?? ''} />;
  if (tool.output) return <pre className="max-h-80 overflow-auto px-3 py-2 font-mono text-xs whitespace-pre-wrap">{tool.output}</pre>;
  return <div className="px-3 py-2 text-xs text-muted-foreground">{tr(tool.status === 'running' ? 'tool.running' : 'tool.noOutput')}</div>;
}

/** "Ran" + "npm test": the verb stays muted, the subject is brighter (like Pi Desktop Code's tool list). */
function splitLabel(tool: ToolState): [string, string] {
  if (tool.kind === 'agent') return [tr(tool.status === 'running' ? 'tool.runningAgent' : 'tool.ranAgent'), tool.desc];
  if (tool.kind === 'other') return [toolLabel(tool), ''];
  const label = toolLabel(tool);
  const cut = label.indexOf(' ');
  return cut < 0 ? [label, ''] : [label.slice(0, cut), label.slice(cut + 1)];
}

const Chevron = ({ open }: { open: boolean }) => (
  <ChevronRightIcon className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
);

const ToolRow = memo(function ToolRow({ sid, tool }: { sid: string; tool: ToolState }) {
  const t = useT();
  const running = tool.status === 'running';
  const err = tool.status === 'err', denied = tool.status === 'denied';
  const [verb, subject] = splitLabel(tool);
  const scope = toolScope(tool);
  const toggle = () => (tool.kind === 'agent' ? openAgent(sid, tool.id) : toggleTool(sid, tool.id));
  const extra = tool.kind === 'agent' && (
    <>
      {tool.sub ? (
        <span className="shrink-0">
          {t(tool.sub.toolUses === 1 ? 'tool.use' : 'tool.uses', { n: tool.sub.toolUses, tokens: fmtTok(tool.sub.tokens) })}{running && tool.sub.activity ? ` · ${tool.sub.activity}` : ''}
        </span>
      ) : tool.summary && <span className="truncate">{tool.summary}</span>}
      {err && <span className="shrink-0 text-destructive">{t('tool.failed')}</span>}
      {denied && <span className="shrink-0 text-foreground/80">{t('tool.blocked')}</span>}
    </>
  );
  return (
    <div>
      <div
        className={cn('flex h-10 min-w-0 cursor-pointer items-center gap-1.5 px-3 text-sm text-muted-foreground hover:bg-accent/40', err && 'text-destructive')}
        role="button"
        tabIndex={0}
        aria-expanded={tool.open}
        title={toolLabel(tool)}
        onClick={toggle}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle())}
      >
        <span className={cn('shrink-0', running && 'shimmer')}>{verb}</span>
        {subject && (isFileTool(tool) ? (
          <button
            className={cn('min-w-0 truncate text-foreground/90 hover:underline', err && 'text-destructive', denied && 'line-through')}
            title={t('tool.openFile', { path: tool.path ?? '' })}
            onClick={(e) => { e.stopPropagation(); void openFileRef(tool.path!, tool.kind === 'read' ? tool.args?.offset : tool.firstChangedLine, readImageSrc(tool)); }}
          >
            {subject}
          </button>
        ) : <span className={cn('min-w-0 truncate text-foreground/90', err && 'text-destructive', denied && 'line-through')}>{subject}</span>)}
        {scope && <span className="min-w-0 shrink truncate text-xs" title={scope}>{scope}</span>}
        {extra}
        <Stat add={tool.add} del={tool.del} />
        <Chevron open={tool.open && tool.kind !== 'agent'} />
      </div>
      {tool.open && tool.kind !== 'agent' && (
        <div className="px-3 pb-3">
          <div className="overflow-hidden rounded-lg border bg-code">
            <ToolDetail sid={sid} tool={tool} />
            {bareName(tool.name) === ARTIFACT_TOOL && tool.args?.action === ARTIFACT_SAVE && tool.status === 'done' && <ArtifactPreviewButton tool={tool} />}
            {isFileTool(tool) && tool.status === 'done' && tool.kind !== 'read' && (
              <button className="w-full border-t px-3 py-1 text-left text-xs text-primary hover:bg-accent" onClick={() => openDiffRef(tool.path!)}>
                {t('tool.viewDiff')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export const GroupItem = memo(function GroupItem({ sid, item, view }: { sid: string; item: ItemOf<'group'>; view: string }) {
  const t = useT();
  const thoughts = view === 'normal' ? [] : item.thoughts;
  if (!item.tools.length && !thoughts.length) return null;
  const running = item.tools.find((tool) => tool.status === 'running');
  const { add, del } = groupStats(item.tools);
  const label = running ? `${toolLabel(running)}…` : groupSummary(item.tools);
  return (
    <div className="space-y-1">
      {thoughts.map((step, i) => (
        <Collapsible key={i} open={!!step.open} onOpenChange={(open) => (open !== !!step.open ? toggleThought(sid, item.key, i, open) : undefined)} className="group/think">
          <CollapsibleTrigger className="flex cursor-pointer items-center gap-1 text-sm text-muted-foreground select-none hover:text-foreground">
            {step.done ? <span>{step.secs ? t('tool.thoughtFor', { secs: step.secs }) : t('tool.thought')}</span> : <span className="shimmer">{t('tool.thinking')}</span>}
            <ChevronRightIcon className="size-3.5 transition-transform group-data-[state=open]/think:rotate-90" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div data-selectable className="mt-1 border-l-2 pl-3 text-sm whitespace-pre-wrap text-muted-foreground">{step.text}</div>
          </CollapsibleContent>
        </Collapsible>
      ))}
      {item.tools.length > 0 && (
        <>
          <button className="flex max-w-full items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" onClick={() => toggleGroup(sid, item.key)} title={label}>
            <span className={cn('truncate', running && 'shimmer')}>{label}</span>
            <Stat add={add} del={del} />
            {item.open ? <ChevronDownIcon className="size-3.5 shrink-0" /> : <ChevronRightIcon className="size-3.5 shrink-0" />}
          </button>
          {item.open && (
            <div className="mt-2 divide-y overflow-hidden rounded-[10px] border">
              {item.tools.map((tool) => <ToolRow key={tool.id} sid={sid} tool={tool} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
});

// ------------------------------------------------------------ prompts

function Resolved({ label, subject, denied }: { label: string; subject?: string; denied?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground" title={`${label} ${subject ?? ''}`}>
      {denied ? <XIcon className="size-3.5 shrink-0 text-destructive" /> : <CheckIcon className="size-3.5 shrink-0 text-success" />}
      <span className="truncate">
        {label} {subject && <span className="font-mono text-xs">{subject}</span>}
      </span>
    </div>
  );
}

const RESOLVED_LABEL: Record<string, MessageKey> = { Allow: 'perm.allowed', 'Always allow': 'perm.alwaysAllowed', Deny: 'perm.denied', cancelled: 'perm.cancelled' };

export const PermItem = memo(function PermItem({ sid, item }: { sid: string; item: ItemOf<'perm'> }) {
  const t = useT();
  const tool = useApp((s) => findTool(s.sessions[sid], item.toolCallId)?.tool);
  const subject = tool?.kind === 'bash' ? tool.cmd : tool?.path || item.title;
  if (item.resolved) return <Resolved label={RESOLVED_LABEL[item.resolved] ? t(RESOLVED_LABEL[item.resolved]) : item.resolved} subject={subject} denied={item.resolved === 'Deny' || item.resolved === 'cancelled'} />;
  const prefix = tool?.kind === 'bash' ? tool.cmd.split(/\s+/).slice(0, 2).join(' ') : '';
  const always = tool?.kind === 'bash' ? <>{t('perm.alwaysAllow')} <span className="font-mono">{prefix}</span></> : tool?.kind === 'edit' || tool?.kind === 'write' ? t('perm.allowAllEdits') : t('perm.alwaysAllow');
  let preview: React.ReactNode = null;
  if (tool?.kind === 'bash') preview = <TermOutput cmd={tool.cmd} out="" />;
  else if (tool?.kind === 'edit') preview = (tool.args?.edits ?? []).slice(0, 6).map((e: any, i: number) => <DiffRows key={i} before={e.oldText} after={e.newText} path={tool.path ?? ''} context={2} />);
  else if (tool?.kind === 'write') preview = <ToolPreviewView preview={{ ...(previews.write(tool.args) as any), note: t('perm.writeNote') }} path={tool.path ?? ''} />;
  else if (tool?.args) preview = <pre className="max-h-60 overflow-auto px-3 py-2 font-mono text-xs">{JSON.stringify(tool.args, null, 2).slice(0, 2000)}</pre>;
  const answer = (v: string) => answerUi(sid, item.key, { value: v }, v);
  return (
    <div className="rounded-xl border border-primary/40 bg-card p-3.5 shadow-sm">
      <div className="mb-2 text-sm font-medium">{permissionTitle(tool, item.title)}</div>
      {preview && <div className="mb-3 max-h-72 overflow-auto rounded-lg border bg-code">{preview}</div>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => answer('Allow')}>{t('perm.allow')} <Kbd className="ml-1">1</Kbd></Button>
        <Button size="sm" variant="outline" onClick={() => answer('Always allow')}>{always} <Kbd className="ml-1">2</Kbd></Button>
        <Button size="sm" variant="outline" onClick={() => answer('Deny')}>{t('perm.deny')} <Kbd className="ml-1">3</Kbd></Button>
      </div>
    </div>
  );
});

/** A question to the user: open ones are docked above the composer (`AskDock`), answered ones stay in the transcript. */
export const isPendingAsk = (item: Item) => item.kind === 'ask' && !item.resolved;

export const AskCard = memo(function AskCard({ sid, item }: { sid: string; item: ItemOf<'ask'> }) {
  return item.request.kind === 'questions' ? <QuestionsItem sid={sid} item={item} /> : <DialogItem sid={sid} item={item} />;
});

/** Dialogs from pi extensions (ctx.ui.select / confirm / input / editor). */
function DialogItem({ sid, item }: { sid: string; item: ItemOf<'ask'> }) {
  const t = useT();
  const r = item.request;
  const [value, setValue] = useState(r.kind === 'input' || r.kind === 'editor' ? (r.prefill ?? '') : '');
  if (item.resolved) return <Resolved label={r.title.split('\n')[0]} subject={item.resolved} denied={item.resolved === 'cancelled'} />;
  const answer = (response: Parameters<typeof answerUi>[2], label: string) => answerUi(sid, item.key, response, label);
  // Dialogs from question-style extensions fold optional previews into the title.
  const [question, ...extra] = r.title.split(/\n\n(?=--- \d+\. [^\n]+ preview ---\n)/);
  return (
    <div className="overflow-hidden rounded-xl border border-primary/40 bg-card shadow-sm">
      <div className="flex items-start gap-2 p-3.5 pb-2.5">
        <MessageCircleQuestionIcon className="mt-0.5 size-4 shrink-0 text-primary" />
        <div data-selectable className="min-w-0 flex-1 text-sm font-medium whitespace-pre-wrap">{question}</div>
      </div>
      <div className="space-y-2 px-3.5 pb-3.5">
        {extra.map((p, i) => {
          const nl = p.indexOf('\n');
          return (
            <Collapsible key={i} className="text-sm">
              <CollapsibleTrigger className="cursor-pointer text-left text-muted-foreground">{p.slice(0, nl).replace(/^--- | ---$/g, '')}</CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="mt-1 max-h-60 overflow-auto rounded-lg border bg-code p-2 font-mono text-xs">{p.slice(nl + 1)}</pre>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
        {r.kind === 'select' && (
          <div className="flex flex-col gap-1.5">
            {r.options.map((o) => {
              const split = o.indexOf(' — ');
              return (
                <button
                  key={o}
                  type="button"
                  className="cursor-pointer rounded-lg border px-3 py-2 text-left outline-none transition-colors hover:border-ring/60 hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  onClick={() => answer({ value: o }, o)}
                >
                  <span className="block text-sm font-medium">{split < 0 ? o : o.slice(0, split)}</span>
                  {split >= 0 && <span className="mt-0.5 block text-xs text-muted-foreground">{o.slice(split + 3)}</span>}
                </button>
              );
            })}
            <Button variant="ghost" size="sm" className="self-start" onClick={() => answer({ cancelled: true }, 'cancelled')}>{t('dialog.dismiss')}</Button>
          </div>
        )}
        {r.kind === 'confirm' && (
          <>
            <div className="text-sm text-muted-foreground">{r.message}</div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => answer({ confirmed: true }, 'Yes')}>{t('dialog.yes')}</Button>
              <Button size="sm" variant="outline" onClick={() => answer({ confirmed: false }, 'No')}>{t('dialog.no')}</Button>
            </div>
          </>
        )}
        {(r.kind === 'input' || r.kind === 'editor') && (
          <>
            <Textarea rows={r.kind === 'editor' ? 6 : 1} placeholder={r.placeholder} value={value} onChange={(e) => setValue(e.target.value)} />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => answer({ value }, 'OK')}>{t('dialog.ok')}</Button>
              <Button size="sm" variant="outline" onClick={() => answer({ cancelled: true }, 'cancelled')}>{t('dialog.cancel')}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const PLAN_LABEL: Record<(typeof PLAN_CHOICES)[number], MessageKey> = {
  'Approve & auto-accept edits': 'plan.approveAuto', 'Approve, ask for edits': 'plan.approveAsk', 'Keep planning': 'plan.keep',
};

export function PlanActions({ sid, itemKey }: { sid: string; itemKey: string }) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-2">
      {PLAN_CHOICES.map((o, i) => (
        <Button key={o} size="sm" variant={i === 0 ? 'default' : 'outline'} onClick={() => answerUi(sid, itemKey, { value: o }, o)}>
          {t(PLAN_LABEL[o])}
        </Button>
      ))}
    </div>
  );
}

export const PlanItem = memo(function PlanItem({ sid, item }: { sid: string; item: ItemOf<'plan'> }) {
  const t = useT();
  const status = item.resolved === 'Keep planning' ? t('plan.revising') : item.resolved === 'cancelled' ? t('plan.cancelled') : item.resolved ? t('plan.approved') : null;
  return (
    <div className="rounded-xl border bg-card">
      <button className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm" onClick={() => openPlan(sid, item.key)}>
        <BookmarkIcon className="size-4 text-primary" />
        <span className="flex-1 truncate font-medium">{item.title}</span>
        <span className="text-xs text-muted-foreground">{t('plan.open')}</span>
        <ChevronRightIcon className="size-3.5 text-muted-foreground" />
      </button>
      {status && <div className="border-t px-3.5 py-2 text-xs text-muted-foreground">{status}</div>}
      {!item.resolved && item.requestId && (
        <div className="border-t px-3.5 py-2.5">
          <PlanActions sid={sid} itemKey={item.key} />
        </div>
      )}
    </div>
  );
});

