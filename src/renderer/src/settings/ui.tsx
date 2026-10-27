// The building blocks every Settings section is made of. Keep the visible text short:
// anything longer goes in `tip`, shown on hover next to the title.
import type { ReactNode } from 'react';
import { Tip } from '@/components/common/Tip';
import { cn } from '@/lib/utils';

const Title = ({ children, tip, className }: { children: ReactNode; tip?: string; className?: string }) => (
  <div className={cn('flex items-center gap-1.5', className)}>{children}{tip && <Tip>{tip}</Tip>}</div>
);

export function Heading({ title, sub, tip }: { title: string; sub: string; tip?: string }) {
  return (
    <div className="mb-5">
      <Title className="text-xl font-semibold" tip={tip}><h2>{title}</h2></Title>
      <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
    </div>
  );
}

export const Panel = ({ children }: { children: ReactNode }) => <div className="divide-y rounded-xl border bg-card">{children}</div>;

export function Row({ title, hint, tip, children, col }: { title: ReactNode; hint?: ReactNode; tip?: string; children?: ReactNode; col?: boolean }) {
  return (
    <div className={cn('flex gap-4 px-4 py-3.5', col ? 'flex-col' : 'items-center')}>
      <div className="min-w-0 flex-1">
        <Title className="text-sm font-medium" tip={tip}>{title}</Title>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

/** DOM id of a group, which the Settings sidebar tree scrolls to. */
export const groupDomId = (id: string) => `group-${id}`;

/** A titled settings group: a small heading (and optional note) above its content; `action` sits at the heading's right. */
export function Group({ id, title, sub, tip, action, children }: { id?: string; title: string; sub?: string; tip?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section id={id && groupDomId(id)} className="mt-7 scroll-mt-2 first:mt-0">
      <div className="flex items-end justify-between gap-3 px-1">
        <div>
          <Title className="text-sm font-semibold" tip={tip}><h3>{title}</h3></Title>
          {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
        </div>
        {action}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}
