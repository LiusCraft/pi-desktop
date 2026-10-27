import { MessageSquareIcon, QuoteIcon, FolderIcon, ReplyIcon, XIcon } from 'lucide-react';
import { referenceLocation, type ContextReference } from '@shared/context-reference';
import { Button } from '@/components/ui/button';

export function ContextCards({ references, disabled, onRemove }: {
  references: ContextReference[];
  disabled?: boolean;
  onRemove: (id: string) => void;
}) {
  if (!references.length) return null;
  return (
    <div className="flex max-h-60 flex-wrap gap-2 overflow-auto" aria-label="附加的上下文和评论">
      {references.map((reference) => {
        const Icon = reference.kind === 'quote' ? ReplyIcon : reference.kind === 'comment' ? MessageSquareIcon : reference.directory ? FolderIcon : QuoteIcon;
        return (
          <div key={reference.id} className="relative flex w-52 flex-col gap-2 rounded-lg border bg-muted/20 p-2.5">
            <div className="flex items-center gap-1.5">
              <Icon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={referenceLocation(reference)}>{referenceLocation(reference)}</span>
              <Button type="button" variant="ghost" size="icon" className="size-5" disabled={disabled} aria-label={`移除 ${referenceLocation(reference)}`} onClick={() => onRemove(reference.id)}><XIcon /></Button>
            </div>
            {reference.text && <pre data-selectable className="max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">{reference.text}</pre>}
            {reference.comment && <p data-selectable className="max-h-28 overflow-auto whitespace-pre-wrap break-words text-sm">{reference.comment}</p>}
            <span className="text-[10px] text-muted-foreground">{reference.kind === 'quote' ? 'Reply' : reference.kind === 'comment' ? 'Comment' : reference.kind === 'excerpt' ? 'Excerpt' : reference.directory ? 'Folder' : 'File'}</span>
          </div>
        );
      })}
    </div>
  );
}
