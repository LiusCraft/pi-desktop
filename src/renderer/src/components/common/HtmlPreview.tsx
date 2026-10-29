import { useEffect, useRef } from 'react';
import { SelectionComposer } from './SelectionComposer';
import { useTextSelection } from './SelectableContent';

/** The sandboxed page cannot be read from here, so a tiny script inside it reports what the user selects. */
const SELECTION_MESSAGE = 'pi-selection';
const REPORTER = `<script>document.addEventListener('selectionchange',function(){parent.postMessage({type:'${SELECTION_MESSAGE}',text:String(getSelection())},'*')})</script>`;

/** A rendered HTML file; selected text can be attached to the chat like a passage of code. */
export function HtmlPreview({ sid, path, html, title }: { sid: string; path: string; html: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const picker = useTextSelection(path, false);
  const { pick } = picker;
  useEffect(() => {
    // Reports every change, so an emptied selection arrives as empty text.
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== SELECTION_MESSAGE) return;
      pick(String(event.data.text ?? ''));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [pick]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <iframe
        ref={frame}
        key={path}
        srcDoc={html + REPORTER}
        title={title}
        className="min-h-0 flex-1 border-0 bg-white"
        sandbox="allow-scripts"
      />
      {picker.reference && (
        <SelectionComposer
          sid={sid}
          reference={picker.reference}
          commenting={picker.commenting}
          onCommenting={picker.setCommenting}
          onDone={picker.reset}
        />
      )}
    </div>
  );
}
