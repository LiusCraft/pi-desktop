import { useState } from 'react';
import { CheckIcon, CircleDotIcon, Loader2Icon, MessageSquareIcon, QuoteIcon, SquareArrowOutUpRightIcon } from 'lucide-react';
import type { PrThread } from '@shared/protocol';
import { call } from '@/lib/api';
import { ago } from '@/lib/format';
import { cn } from '@/lib/utils';
import { quotePrThread, replyPrThread, resolvePrThread } from '@/store/actions';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A PR review thread under the diff line it was written on; the jump from the PR bar focuses and flashes it. */
export function PrThreadCard({ thread, className }: { thread: PrThread; className?: string }) {
  const first = thread.comments[0];
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const act = async (job: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await job();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const submit = () => {
    const body = draft.trim();
    if (!body || busy) return;
    void act(async () => {
      await replyPrThread(thread.id, body);
      setDraft('');
      setReplying(false);
    });
  };
  const toComposer = () => {
    const body = draft.trim();
    if (!body || busy) return;
    try {
      quotePrThread(thread, body);
      setDraft('');
      setReplying(false);
      setError('');
    } catch (e) {
      setError(errText(e));
    }
  };
  const iconBtn ='shrink-0 rounded p-0.5 hover:bg-accent hover:text-foreground disabled:opacity-50';

  return (
    <div
      tabIndex={-1}
      data-thread-id={thread.id}
      onAnimationEnd={(e) => e.currentTarget.removeAttribute('data-flash')}
      className={cn('pr-thread mx-3 my-1.5 overflow-hidden rounded-lg border bg-card font-sans text-xs shadow-sm outline-none transition-colors hover:border-info/60 focus-visible:border-info', thread.resolved && 'opacity-70', className)}
    >
      <div className="flex items-center gap-1.5 border-b bg-muted/40 px-2.5 py-1 text-muted-foreground">
        <MessageSquareIcon className="size-3 shrink-0" />
        <span className="truncate">{first.author}</span>
        {thread.outdated && <span className="shrink-0 rounded bg-warning/15 px-1 text-[10px] text-warning">outdated</span>}
        {thread.resolved && <span className="shrink-0 rounded bg-success/15 px-1 text-[10px] text-success">已解决</span>}
        {thread.comments.length > 1 && <span className="shrink-0 tabular-nums">· {thread.comments.length} 条</span>}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <button className={iconBtn} title="引用到对话" onClick={() => { try { quotePrThread(thread); } catch (e) { setError(errText(e)); } }}>
            <QuoteIcon className="size-3" />
          </button>
          <button className={iconBtn} disabled={busy} title={thread.resolved ? '重新打开' : '标记为已解决'} onClick={() => void act(() => resolvePrThread(thread.id, !thread.resolved))}>
            {busy ? <Loader2Icon className="size-3 animate-spin" /> : thread.resolved ? <CircleDotIcon className="size-3" /> : <CheckIcon className="size-3" />}
          </button>
          {first.url && (
            <button className={iconBtn} title="在浏览器打开" onClick={() => call('app:openExternal', first.url)}>
              <SquareArrowOutUpRightIcon className="size-3" />
            </button>
          )}
        </div>
      </div>
      <div className="divide-y">
        {thread.comments.map((c, i) => (
          <div key={c.id} className="px-2.5 py-1.5">
            {i > 0 && <div className="mb-0.5 flex gap-1.5 text-[11px] text-muted-foreground"><span>{c.author}</span>{!!c.at && <span className="tabular-nums">{ago(c.at)}</span>}</div>}
            <p className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed" data-selectable>{c.body}</p>
            {i === 0 && !!c.at && <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground/80">{ago(c.at)}</div>}
          </div>
        ))}
      </div>
      <div className="border-t px-2.5 py-1.5">
        {replying ? (
          <div className="flex flex-col gap-1.5">
            <textarea
              autoFocus
              value={draft}
              disabled={busy}
              rows={3}
              placeholder="写下回复…（⌘/Ctrl+↵ 回复到 PR）"
              className="w-full resize-y rounded border bg-background px-2 py-1 text-[12.5px] outline-none focus-visible:border-info"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
                if (e.key === 'Escape') setReplying(false);
              }}
            />
            <div className="flex justify-end gap-1.5">
              <button className="rounded px-2 py-0.5 text-muted-foreground hover:bg-accent" disabled={busy} onClick={() => setReplying(false)}>取消</button>
              <button className="rounded border px-2 py-0.5 hover:bg-accent disabled:opacity-50" disabled={busy || !draft.trim()} onClick={toComposer}>添加到输入框</button>
              <button className="rounded bg-primary px-2 py-0.5 text-primary-foreground disabled:opacity-50" disabled={busy || !draft.trim()} onClick={submit}>{busy ? '发送中…' : '回复到 PR'}</button>
            </div>
          </div>
        ) : (
          <button className="text-muted-foreground hover:text-foreground" onClick={() => setReplying(true)}>回复…</button>
        )}
        {error && <p className="mt-1 break-words text-[11px] text-destructive">{error}</p>}
      </div>
    </div>
  );
}
