import { Children, Fragment, useId, useRef, useState, type ReactNode } from 'react';
import { MessageSquarePlusIcon, PaperclipIcon, XIcon } from 'lucide-react';
import { referenceLocation, type ContextReference } from '@shared/context-reference';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { sessionDraftKey } from '@/store/actions';
import { drafts } from '@/store/drafts';

interface Selection {
  anchor: number;
  first: number;
  last: number;
  reference: Omit<ContextReference, 'id' | 'kind'>;
}

/** Native text selection and line-gutter clicks share an inline comment editor. */
export function CodeSelection({ sid, path, children, className }: {
  sid?: string;
  path: string;
  children: ReactNode;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const commentId = useId();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [commenting, setCommenting] = useState(false);
  const [comment, setComment] = useState('');
  const entries = Children.toArray(children);
  const capture = (first: number, last: number, anchor = first) => {
    if (!root.current) return;
    const lines = [...root.current.querySelectorAll<HTMLElement>('[data-code-entry]')]
      .filter((element) => Number(element.dataset.codeEntry) >= first && Number(element.dataset.codeEntry) <= last)
      .map((element) => {
        const row = element.querySelector<HTMLElement>('[data-source-line]');
        return row ? { line: Number(row.dataset.sourceLine), side: row.dataset.side, text: row.querySelector('[data-code-text]')?.textContent ?? '' } : null;
      });
    const actual = lines.filter((line) => line !== null);
    if (!actual.length) return;
    const side = actual.every((line) => line.side === 'old') ? 'old' : actual.every((line) => line.side === 'new') ? 'new' : 'mixed';
    const text = lines.map((line) => !line ? '… unchanged lines …' : side === 'mixed' ? `${line.side === 'old' ? '-' : '+'} L${line.line}: ${line.text}` : line.text).join('\n');
    setSelection({ anchor, first, last, reference: { path, startLine: actual[0].line, endLine: actual.at(-1)!.line, side, text } });
  };
  const reset = () => { setSelection(null); setCommenting(false); setComment(''); };
  const attach = (kind: 'excerpt' | 'comment') => {
    if (!sid || !selection || (kind === 'comment' && !comment.trim())) return;
    if (drafts.addReference(sessionDraftKey(sid), { ...selection.reference, id: crypto.randomUUID(), kind, comment: kind === 'comment' ? comment.trim() : undefined })) {
      window.getSelection()?.removeAllRanges();
      reset();
    }
  };
  return (
    <div ref={root} data-selectable className={className} onMouseUp={(event) => {
      if (!sid || commenting || (event.target as Element).closest('button,textarea,form')) return;
      const selected = window.getSelection();
      if (!selected || selected.isCollapsed || !selected.rangeCount) return;
      const range = selected.getRangeAt(0);
      if (!root.current?.contains(range.startContainer) || !root.current.contains(range.endContainer)) return;
      const matched = [...root.current.querySelectorAll<HTMLElement>('[data-code-entry]')].filter((element) => {
        const code = element.querySelector('[data-code-text]');
        return code && range.intersectsNode(code);
      });
      if (matched.length) capture(Number(matched[0].dataset.codeEntry), Number(matched.at(-1)!.dataset.codeEntry));
    }} onClick={(event) => {
      if (!sid) return;
      if ((event.target as Element).closest('.hunk-gap')) return reset();
      const button = (event.target as Element).closest('[data-select-line]');
      const entry = button?.closest<HTMLElement>('[data-code-entry]');
      if (!entry) return;
      const index = Number(entry.dataset.codeEntry);
      const anchor = event.shiftKey && selection ? selection.anchor : index;
      capture(Math.min(anchor, index), Math.max(anchor, index), anchor);
      setCommenting(true);
    }}>
      {entries.map((child, index) => (
        <Fragment key={index}>
          <div data-code-entry={index} className={cn(selection && index >= selection.first && index <= selection.last && '[&_.code-row]:bg-info/20!')}>{child}</div>
          {sid && selection?.last === index && (
            <div className="flex flex-col gap-2 border-y bg-card p-3 font-sans text-sm" onMouseUp={(event) => event.stopPropagation()}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={referenceLocation({ ...selection.reference, id: '', kind: 'excerpt' })}>{referenceLocation({ ...selection.reference, id: '', kind: 'excerpt' })}</span>
                <Button type="button" variant="outline" size="sm" onMouseDown={(event) => event.preventDefault()} onClick={() => attach('excerpt')}><PaperclipIcon data-icon="inline-start" />附加为上下文</Button>
                {!commenting && <Button type="button" variant="outline" size="sm" onClick={() => setCommenting(true)}><MessageSquarePlusIcon data-icon="inline-start" />添加评论</Button>}
                <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="取消选区" onClick={reset}><XIcon /></Button>
              </div>
              {commenting && (
                <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); attach('comment'); }}>
                  <Field>
                    <FieldLabel className="sr-only" htmlFor={commentId}>选区评论</FieldLabel>
                    <Textarea id={commentId} aria-label="选区评论" autoFocus value={comment} onChange={(event) => setComment(event.target.value)} placeholder="针对这些代码写下评论…" rows={3} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); attach('comment'); } }} />
                  </Field>
                  <div className="flex justify-end"><Button type="submit" size="sm" disabled={!comment.trim()}>添加到输入框</Button></div>
                </form>
              )}
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}
