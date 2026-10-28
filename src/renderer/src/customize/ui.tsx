// Small layout pieces shared by the Customize sections.
import type { ReactNode } from 'react';
import { ArrowLeftIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Tip } from '@/components/common/Tip';
import { cn } from '@/lib/utils';

export const Heading = ({ title, sub, tip, action }: { title: string; sub: string; tip?: string; action?: ReactNode }) => (
  <div className="mb-5 flex items-start gap-3">
    <div className="min-w-0 flex-1">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">{sub}{tip && <Tip>{tip}</Tip>}</p>
    </div>
    {action}
  </div>
);

export const Panel = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn('divide-y rounded-xl border bg-card', className)}>{children}</div>
);

export const Field = ({ label, hint, tip, children }: { label: string; hint?: string; tip?: string; children: ReactNode }) => (
  <Label className="flex-col items-stretch gap-1.5 leading-normal">
    <span className="flex items-center gap-1.5">{label}{tip && <Tip>{tip}</Tip>}</span>
    {children}
    {hint && <span className="block text-xs font-normal text-muted-foreground">{hint}</span>}
  </Label>
);

export const Empty = ({ children }: { children: ReactNode }) => <div className="px-4 py-6 text-center text-sm text-muted-foreground">{children}</div>;

export const BackButton = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <Button variant="ghost" size="sm" className="-ml-2 mb-3 text-muted-foreground" onClick={onClick}>
    <ArrowLeftIcon className="size-4" />{children}
  </Button>
);

export { Segmented } from '@/components/common/Segmented';

/** Strip the `---` frontmatter block off a Markdown file. */
export const stripFrontmatter = (text: string) => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
