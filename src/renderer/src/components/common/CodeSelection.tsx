import { Children, Fragment, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { SelectionComposer, type CodeReference } from './SelectionComposer';

interface Selection {
  anchor: number;
  first: number;
  last: number;
  reference: CodeReference;
}

/** Native text selection and line-gutter clicks share an inline comment editor. */
export function CodeSelection({ sid, path, children, className }: {
  sid?: string;
  path: string;
  children: ReactNode;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [commenting, setCommenting] = useState(false);
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
  const reset = () => { setSelection(null); setCommenting(false); };
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
            <SelectionComposer sid={sid} reference={selection.reference} commenting={commenting} onCommenting={setCommenting} onMouseUp={(event) => event.stopPropagation()} onDone={(attached) => { if (attached) window.getSelection()?.removeAllRanges(); reset(); }} />
          )}
        </Fragment>
      ))}
    </div>
  );
}
