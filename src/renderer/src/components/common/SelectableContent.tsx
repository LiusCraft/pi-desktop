import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { SelectionComposer, type CodeReference } from './SelectionComposer';

/** What a rendered preview lets the user pick: the chosen text, under the file it came from. */
/** `inPage`: watch this page's own selection; a framed page reports its selection through `pick` instead. */
export function useTextSelection(path: string, inPage = true) {
  const [reference, setReference] = useState<CodeReference | null>(null);
  const [commenting, setCommenting] = useState(false);
  const typing = useRef(false);
  typing.current = commenting;
  const reset = useCallback(() => {
    setReference(null);
    setCommenting(false);
  }, []);
  // An empty pick means the selection was cleared: that closes the bar, unless a comment is being written (focusing its box clears the selection too).
  const pick = useCallback(
    (text: string) => {
      const picked = text.trim();
      if (picked) setReference({ path, text: picked });
      else if (!typing.current) setReference(null);
    },
    [path],
  );
  // Selections made in this page itself.
  useEffect(() => {
    if (!inPage) return;
    const onChange = () => {
      if (window.getSelection()?.isCollapsed) pick('');
    };
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, [pick, inPage]);
  return { reference, commenting, setCommenting, pick, reset };
}

/** A rendered file whose text can be selected and attached to the chat, with or without a comment. */
export function SelectableContent({
  sid,
  path,
  children,
  className,
}: {
  sid: string;
  path: string;
  children: ReactNode;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const picker = useTextSelection(path);
  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div
        ref={root}
        data-selectable
        className="min-h-0 flex-1 overflow-y-auto"
        onMouseUp={(event) => {
          if (picker.commenting || (event.target as Element).closest('button,textarea,form')) return;
          const selected = window.getSelection();
          if (!selected || selected.isCollapsed || !selected.rangeCount) return;
          const range = selected.getRangeAt(0);
          if (root.current?.contains(range.startContainer) && root.current.contains(range.endContainer))
            picker.pick(selected.toString());
        }}
      >
        {children}
      </div>
      {picker.reference && (
        <SelectionComposer
          sid={sid}
          reference={picker.reference}
          commenting={picker.commenting}
          onCommenting={picker.setCommenting}
          onDone={(attached) => {
            if (attached) window.getSelection()?.removeAllRanges();
            picker.reset();
          }}
        />
      )}
    </div>
  );
}
