import { MessageSquareIcon, XIcon } from 'lucide-react';
import { referenceLocation, type ContextReference } from '@shared/context-reference';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { sessionDraftKey } from '@/store/actions';
import { drafts } from '@/store/drafts';

/** A comment waiting in the composer, drawn under the lines it is about; removing it takes it out of the message too. */
export function PendingCommentCard({ sid, reference }: { sid: string; reference: ContextReference }) {
  const t = useT();
  return (
    <div className="mx-3 my-1.5 overflow-hidden rounded-lg border border-info/40 bg-card font-sans text-xs shadow-sm">
      <div className="flex items-center gap-1.5 border-b bg-muted/40 py-0.5 pr-1 pl-2.5 text-muted-foreground">
        <MessageSquareIcon className="size-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{t('ctx.comment')}</span>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={t('ctx.remove', { name: referenceLocation(reference) })} onClick={() => drafts.removeReference(sessionDraftKey(sid), reference.id)}><XIcon /></Button>
      </div>
      <p className="px-2.5 py-1.5 text-[12.5px] leading-relaxed whitespace-pre-wrap break-words" data-selectable>{reference.comment}</p>
    </div>
  );
}
