import { SquareArrowOutUpRightIcon, MessageSquareIcon } from 'lucide-react';
import type { PrThread } from '@shared/protocol';
import { call } from '@/lib/api';
import { ago } from '@/lib/format';
import { cn } from '@/lib/utils';

/** A PR review thread under the diff line it was written on; the jump from the PR bar focuses and flashes it. */
export function PrThreadCard({ thread, className }: { thread: PrThread; className?: string }) {
  const first = thread.comments[0];
  return (
    <div
      tabIndex={-1}
      data-thread-id={thread.id}
      onAnimationEnd={(e) => e.currentTarget.removeAttribute('data-flash')}
      className={cn('pr-thread mx-3 my-1.5 overflow-hidden rounded-lg border bg-card font-sans text-xs shadow-sm outline-none transition-colors hover:border-info/60 focus-visible:border-info', className)}
    >
      <div className="flex items-center gap-1.5 border-b bg-muted/40 px-2.5 py-1 text-muted-foreground">
        <MessageSquareIcon className="size-3 shrink-0" />
        <span className="truncate">{first.author}</span>
        {thread.outdated && <span className="shrink-0 rounded bg-warning/15 px-1 text-[10px] text-warning">outdated</span>}
        {thread.comments.length > 1 && <span className="shrink-0 tabular-nums">· {thread.comments.length} 条</span>}
        {first.url && (
          <button className="ml-auto shrink-0 rounded p-0.5 hover:bg-accent hover:text-foreground" title="在 GitHub 打开" onClick={() => call('app:openExternal', first.url)}>
            <SquareArrowOutUpRightIcon className="size-3" />
          </button>
        )}
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
    </div>
  );
}
