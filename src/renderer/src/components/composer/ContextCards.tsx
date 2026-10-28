import { MessageSquareIcon, QuoteIcon, FolderIcon, ReplyIcon, XIcon } from 'lucide-react';
import { referenceLocation, type ContextReference } from '@shared/context-reference';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export function ContextCards({ references, disabled, onRemove, onOpen }: {
  references: ContextReference[];
  disabled?: boolean;
  /** Omit it to show the cards read-only, as in a sent message. */
  onRemove?: (id: string) => void;
  /** Makes each card a link to what it refers to (a sent message's cards). */
  onOpen?: (reference: ContextReference) => void;
}) {
  const t = useT();
  if (!references.length) return null;
  return (
    <div className="flex max-h-60 flex-wrap gap-2 overflow-auto" aria-label={t('ctx.attached')}>
      {references.map((reference) => {
        const Icon = reference.kind === 'quote' ? ReplyIcon : reference.kind === 'comment' ? MessageSquareIcon : reference.directory ? FolderIcon : QuoteIcon;
        return (
          <div
            key={reference.id}
            className={cn('relative flex w-52 flex-col gap-2 rounded-lg border bg-muted/20 p-2.5', onOpen && 'cursor-pointer transition-colors hover:bg-accent/60')}
            {...(onOpen ? { role: 'link', tabIndex: 0, title: t('ctx.jump'), onClick: () => onOpen(reference), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') onOpen(reference); } } : {})}
          >
            <div className="flex items-center gap-1.5">
              <Icon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={referenceLocation(reference)}>{referenceLocation(reference)}</span>
              {onRemove && <Button type="button" variant="ghost" size="icon" className="size-5" disabled={disabled} aria-label={t('ctx.remove', { name: referenceLocation(reference) })} onClick={(e) => { e.stopPropagation(); onRemove(reference.id); }}><XIcon /></Button>}
            </div>
            {reference.text && <pre data-selectable className="max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">{reference.text}</pre>}
            {reference.comment && <p data-selectable className="max-h-28 overflow-auto whitespace-pre-wrap break-words text-sm">{reference.comment}</p>}
            <span className="text-[10px] text-muted-foreground">{t(reference.kind === 'quote' ? 'ctx.reply' : reference.kind === 'comment' ? 'ctx.comment' : reference.kind === 'excerpt' ? 'ctx.excerpt' : reference.directory ? 'ctx.folder' : 'ctx.file')}</span>
          </div>
        );
      })}
    </div>
  );
}
