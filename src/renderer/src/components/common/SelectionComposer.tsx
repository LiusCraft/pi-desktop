import { useId, useState } from 'react';
import { MessageSquarePlusIcon, PaperclipIcon, XIcon } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { referenceLocation, type ContextReference } from '@shared/context-reference';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { sessionDraftKey } from '@/store/actions';
import { drafts } from '@/store/drafts';

export type CodeReference = Omit<ContextReference, 'id' | 'kind'>;

/** Under a selected stretch of code: attach it to the chat as context, or with a comment. */
export function SelectionComposer({ sid, reference, commenting, onCommenting, onDone, onMouseUp }: {
  sid: string;
  reference: CodeReference;
  commenting: boolean;
  onCommenting: (on: boolean) => void;
  /** The reference went into the composer, or the user dismissed the selection. */
  onDone: (attached: boolean) => void;
  onMouseUp?: (event: React.MouseEvent) => void;
}) {
  const t = useT();
  const commentId = useId();
  const [comment, setComment] = useState('');
  const location = referenceLocation({ ...reference, id: '', kind: 'excerpt' });
  const attach = (kind: 'excerpt' | 'comment') => {
    if (kind === 'comment' && !comment.trim()) return;
    if (drafts.addReference(sessionDraftKey(sid), { ...reference, id: crypto.randomUUID(), kind, comment: kind === 'comment' ? comment.trim() : undefined })) onDone(true);
  };
  return (
    <div className="flex flex-col gap-2 border-y bg-card p-3 font-sans text-sm" onMouseUp={onMouseUp}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={location}>{location}</span>
        <Button type="button" variant="outline" size="sm" onMouseDown={(event) => event.preventDefault()} onClick={() => attach('excerpt')}><PaperclipIcon data-icon="inline-start" />{t('selcomp.attach')}</Button>
        {!commenting && <Button type="button" variant="outline" size="sm" onClick={() => onCommenting(true)}><MessageSquarePlusIcon data-icon="inline-start" />{t('selcomp.addComment')}</Button>}
        <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={t('selcomp.cancel')} onClick={() => onDone(false)}><XIcon /></Button>
      </div>
      {commenting && (
        <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); attach('comment'); }}>
          <Field>
            <FieldLabel className="sr-only" htmlFor={commentId}>{t('selcomp.commentLabel')}</FieldLabel>
            <Textarea id={commentId} aria-label={t('selcomp.commentLabel')} autoFocus value={comment} onChange={(event) => setComment(event.target.value)} placeholder={t('selcomp.commentPh')} rows={3} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); attach('comment'); } }} />
          </Field>
          <div className="flex justify-end"><Button type="submit" size="sm" disabled={!comment.trim()}>{t('selcomp.addToInput')}</Button></div>
        </form>
      )}
    </div>
  );
}
