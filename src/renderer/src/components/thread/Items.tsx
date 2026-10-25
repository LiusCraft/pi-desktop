import { memo, useState } from 'react';
import { BookmarkIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, GitForkIcon, XIcon } from 'lucide-react';
import { PLAN_CHOICES } from '@shared/protocol';
import * as previews from '@shared/tool-previews';
import { Markdown } from '@/components/common/Markdown';
import { CopyGlyph, useCopy } from '@/components/common/Copy';
import { AttachmentTiles } from '@/components/common/Attachments';
import { DiffRows, TermOutput, ToolPreviewView } from '@/components/common/CodeView';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Textarea } from '@/components/ui/textarea';
import { ago, fmtTok } from '@/lib/format';
import { groupStats, groupSummary, isFileTool, toolLabel, type ToolState } from '@/lib/tools';
import { cn } from '@/lib/utils';
import { useApp, updateSession } from '@/store/app';
import { answerUi, forkSession, openAgent, openDiffRef, openFileRef, openPlan, sessionDraftKey } from '@/store/actions';
import { drafts } from '@/store/drafts';
import { findByKey, findTool, permissionTitle } from '@/store/transcript';
import type { ItemOf } from '@/store/types';

// ------------------------------------------------------------ user

export const UserItem = memo(function UserItem({ sid, item }: { sid: string; item: ItemOf<'user'> }) {
  return (
    <div className={cn('flex flex-col items-end gap-1.5', item.queued && 'opacity-60')} title={item.queued ? '排队中：Claude 完成当前步骤后处理' : undefined}>
      <AttachmentTiles attachments={item.attachments} />
      {item.text && (
        <div data-selectable className="max-w-[85%] rounded-2xl bg-user-bubble px-4 py-2.5 whitespace-pre-wrap break-words">
          {item.text.split(/(@[\w./-]+)/g).map((part, i) => (part.startsWith('@') ? <span key={i} className="text-primary">{part}</span> : part))}
        </div>
      )}
      {item.notice && <div className="text-xs text-muted-foreground">{item.notice}</div>}
      {item.failed && (
        <div className="flex items-center gap-2 text-xs text-destructive">
          Delivery not confirmed. Check the conversation before retrying.
          <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => item.submission && drafts.recover(sessionDraftKey(sid), item.submission)}>
            Restore draft
          </Button>
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
  const { copied, copy } = useCopy();
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <Button variant="ghost" size="icon" className="size-7" title={copied ? 'Copied' : 'Copy'} onClick={() => copy(prevText ?? '')}>
        <CopyGlyph copied={copied} />
      </Button>
      <Button variant="ghost" size="icon" className="size-7" title="Fork session" onClick={() => void forkSession(sid)}>
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

function ToolDetail({ sid, tool }: { sid: string; tool: ToolState }) {
  if (tool.preview) return <ToolPreviewView preview={tool.preview} path={tool.path ?? ''} sid={sid} onOpenImage={(src) => void openFileRef(tool.path!, undefined, src)} />;
  if (tool.kind === 'bash') return <TermOutput cmd={tool.cmd} out={tool.output ?? ''} />;
  if (tool.output) return <pre className="max-h-80 overflow-auto px-3 py-2 font-mono text-xs whitespace-pre-wrap">{tool.output}</pre>;
  return <div className="px-3 py-2 text-xs text-muted-foreground">{tool.status === 'running' ? 'Running…' : 'No output'}</div>;
}

/** "Ran" + "npm test": the verb stays muted, the subject is brighter (like Claude Code's tool list). */
function splitLabel(tool: ToolState): [string, string] {
  if (tool.kind === 'agent') return [tool.status === 'running' ? 'Running agent' : 'Ran agent', tool.desc];
  if (tool.kind === 'other') return [toolLabel(tool), ''];
  const label = toolLabel(tool);
  const cut = label.indexOf(' ');
  return cut < 0 ? [label, ''] : [label.slice(0, cut), label.slice(cut + 1)];
}

const Chevron = ({ open }: { open: boolean }) => (
  <ChevronRightIcon className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
);

const ToolRow = memo(function ToolRow({ sid, tool }: { sid: string; tool: ToolState }) {
  const running = tool.status === 'running';
  const err = tool.status === 'err', denied = tool.status === 'denied';
  const [verb, subject] = splitLabel(tool);
  const toggle = () => (tool.kind === 'agent' ? openAgent(sid, tool.id) : toggleTool(sid, tool.id));
  const extra = tool.kind === 'agent' && (
    <>
      {tool.sub ? (
        <span className="shrink-0">
          {tool.sub.toolUses} tool use{tool.sub.toolUses === 1 ? '' : 's'} · {fmtTok(tool.sub.tokens)} tokens{running && tool.sub.activity ? ` · ${tool.sub.activity}` : ''}
        </span>
      ) : tool.summary && <span className="truncate">{tool.summary}</span>}
      {err && <span className="shrink-0 text-destructive">Failed</span>}
      {denied && <span className="shrink-0 text-foreground/80">Blocked</span>}
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
            title={`Open current file: ${tool.path}`}
            onClick={(e) => { e.stopPropagation(); void openFileRef(tool.path!, tool.kind === 'read' ? tool.args?.offset : tool.firstChangedLine, readImageSrc(tool)); }}
          >
            {subject}
          </button>
        ) : <span className={cn('min-w-0 truncate text-foreground/90', err && 'text-destructive', denied && 'line-through')}>{subject}</span>)}
        {extra}
        <Stat add={tool.add} del={tool.del} />
        <Chevron open={tool.open && tool.kind !== 'agent'} />
      </div>
      {tool.open && tool.kind !== 'agent' && (
        <div className="px-3 pb-3">
          <div className="overflow-hidden rounded-lg border bg-code">
            <ToolDetail sid={sid} tool={tool} />
            {isFileTool(tool) && tool.status === 'done' && tool.kind !== 'read' && (
              <button className="w-full border-t px-3 py-1 text-left text-xs text-primary hover:bg-accent" onClick={() => openDiffRef(tool.path!)}>
                View diff
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export const GroupItem = memo(function GroupItem({ sid, item, view }: { sid: string; item: ItemOf<'group'>; view: string }) {
  const thoughts = view === 'normal' ? [] : item.thoughts;
  if (!item.tools.length && !thoughts.length) return null;
  const running = item.tools.find((t) => t.status === 'running');
  const { add, del } = groupStats(item.tools);
  const label = running ? `${toolLabel(running)}…` : groupSummary(item.tools);
  return (
    <div className="space-y-1">
      {thoughts.map((step, i) => (
        <details key={i} open={step.open} onToggle={(e) => (e.currentTarget.open !== step.open ? toggleThought(sid, item.key, i, e.currentTarget.open) : undefined)} className="group/think">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-sm text-muted-foreground select-none hover:text-foreground">
            {step.done ? <span>{step.secs ? `Thought for ${step.secs}s` : 'Thought'}</span> : <span className="shimmer">Thinking…</span>}
            <ChevronRightIcon className="size-3.5 transition-transform group-open/think:rotate-90" />
          </summary>
          <div data-selectable className="mt-1 border-l-2 pl-3 text-sm whitespace-pre-wrap text-muted-foreground">{step.text}</div>
        </details>
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
              {item.tools.map((t) => <ToolRow key={t.id} sid={sid} tool={t} />)}
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

const RESOLVED_LABEL: Record<string, string> = { Allow: 'Allowed', 'Always allow': 'Always allowed', Deny: 'Denied', cancelled: 'Cancelled' };

export const PermItem = memo(function PermItem({ sid, item }: { sid: string; item: ItemOf<'perm'> }) {
  const tool = useApp((s) => findTool(s.sessions[sid], item.toolCallId)?.tool);
  const subject = tool?.kind === 'bash' ? tool.cmd : tool?.path || item.title;
  if (item.resolved) return <Resolved label={RESOLVED_LABEL[item.resolved] ?? item.resolved} subject={subject} denied={item.resolved === 'Deny' || item.resolved === 'cancelled'} />;
  const prefix = tool?.kind === 'bash' ? tool.cmd.split(/\s+/).slice(0, 2).join(' ') : '';
  const always = tool?.kind === 'bash' ? <>Always allow <span className="font-mono">{prefix}</span></> : tool?.kind === 'edit' || tool?.kind === 'write' ? 'Allow all edits this session' : 'Always allow';
  let preview: React.ReactNode = null;
  if (tool?.kind === 'bash') preview = <TermOutput cmd={tool.cmd} out="" />;
  else if (tool?.kind === 'edit') preview = (tool.args?.edits ?? []).slice(0, 6).map((e: any, i: number) => <DiffRows key={i} before={e.oldText} after={e.newText} path={tool.path ?? ''} context={2} />);
  else if (tool?.kind === 'write') preview = <ToolPreviewView preview={{ ...(previews.write(tool.args) as any), note: 'Content to write · previous version unavailable' }} path={tool.path ?? ''} />;
  else if (tool?.args) preview = <pre className="max-h-60 overflow-auto px-3 py-2 font-mono text-xs">{JSON.stringify(tool.args, null, 2).slice(0, 2000)}</pre>;
  const answer = (v: string) => answerUi(sid, item.key, { value: v }, v);
  return (
    <div className="rounded-xl border border-primary/40 bg-card p-3.5 shadow-sm">
      <div className="mb-2 text-sm font-medium">{permissionTitle(tool, item.title)}</div>
      {preview && <div className="mb-3 max-h-72 overflow-auto rounded-lg border bg-code">{preview}</div>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => answer('Allow')}>Allow <Kbd className="ml-1">1</Kbd></Button>
        <Button size="sm" variant="outline" onClick={() => answer('Always allow')}>{always} <Kbd className="ml-1">2</Kbd></Button>
        <Button size="sm" variant="outline" onClick={() => answer('Deny')}>Deny <Kbd className="ml-1">3</Kbd></Button>
      </div>
    </div>
  );
});

export const AskItem = memo(function AskItem({ sid, item }: { sid: string; item: ItemOf<'ask'> }) {
  const r = item.request;
  const [value, setValue] = useState(r.kind === 'input' || r.kind === 'editor' ? (r.prefill ?? '') : '');
  if (item.resolved) return <Resolved label={r.title.split('\n')[0]} subject={item.resolved} denied={item.resolved === 'cancelled'} />;
  const answer = (response: Parameters<typeof answerUi>[2], label: string) => answerUi(sid, item.key, response, label);
  // Question tools fold optional previews into the dialog title.
  const [question, ...extra] = r.title.split(/\n\n(?=--- \d+\. [^\n]+ preview ---\n)/);
  return (
    <div className="rounded-xl border border-primary/40 bg-card p-3.5 shadow-sm">
      <div data-selectable className="mb-2 text-sm font-medium whitespace-pre-wrap">{question}</div>
      {extra.map((p, i) => {
        const nl = p.indexOf('\n');
        return (
          <details key={i} className="mb-2 text-sm">
            <summary className="cursor-pointer text-muted-foreground">{p.slice(0, nl).replace(/^--- | ---$/g, '')}</summary>
            <pre className="mt-1 max-h-60 overflow-auto rounded bg-code p-2 font-mono text-xs">{p.slice(nl + 1)}</pre>
          </details>
        );
      })}
      {r.kind === 'select' && (
        <div className="flex flex-col gap-1.5">
          {r.options.map((o, i) => {
            const split = o.indexOf(' — ');
            return (
              <Button key={o} variant={i === 0 ? 'default' : 'outline'} className="h-auto justify-start py-1.5 text-left whitespace-normal" onClick={() => answer({ value: o }, o)}>
                <span>{split < 0 ? o : o.slice(0, split)}</span>
                {split >= 0 && <span className="ml-2 text-xs opacity-70">{o.slice(split + 3)}</span>}
              </Button>
            );
          })}
          <Button variant="ghost" size="sm" className="self-start" onClick={() => answer({ cancelled: true }, 'cancelled')}>Cancel</Button>
        </div>
      )}
      {r.kind === 'confirm' && (
        <>
          <div className="mb-3 text-sm text-muted-foreground">{r.message}</div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => answer({ confirmed: true }, 'Yes')}>Yes</Button>
            <Button size="sm" variant="outline" onClick={() => answer({ confirmed: false }, 'No')}>No</Button>
          </div>
        </>
      )}
      {(r.kind === 'input' || r.kind === 'editor') && (
        <>
          <Textarea rows={r.kind === 'editor' ? 6 : 1} placeholder={r.placeholder} value={value} onChange={(e) => setValue(e.target.value)} className="mb-2" />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => answer({ value }, 'OK')}>OK</Button>
            <Button size="sm" variant="outline" onClick={() => answer({ cancelled: true }, 'cancelled')}>Cancel</Button>
          </div>
        </>
      )}
    </div>
  );
});

export function PlanActions({ sid, itemKey }: { sid: string; itemKey: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {PLAN_CHOICES.map((o, i) => (
        <Button key={o} size="sm" variant={i === 0 ? 'default' : 'outline'} onClick={() => answerUi(sid, itemKey, { value: o }, o)}>
          {o}
        </Button>
      ))}
    </div>
  );
}

export const PlanItem = memo(function PlanItem({ sid, item }: { sid: string; item: ItemOf<'plan'> }) {
  const status = item.resolved === 'Keep planning' ? 'Revising plan' : item.resolved === 'cancelled' ? 'Cancelled' : item.resolved ? '✓ Plan approved' : null;
  return (
    <div className="rounded-xl border bg-card">
      <button className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm" onClick={() => openPlan(sid, item.key)}>
        <BookmarkIcon className="size-4 text-primary" />
        <span className="flex-1 truncate font-medium">{item.title}</span>
        <span className="text-xs text-muted-foreground">Open plan</span>
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

