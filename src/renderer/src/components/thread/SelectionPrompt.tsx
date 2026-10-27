import { useEffect, useRef, useState } from 'react';
import { ArrowUpIcon, MessageCircleQuestionIcon, QuoteIcon, ReplyIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDrag } from '@/lib/drag';
import { cn } from '@/lib/utils';

export type PromptMode = 'side' | 'reply';

const WIDTH = 360;

/**
 * A small draggable window for what to say about a selected passage. Both modes type
 * here; they differ in where Enter sends it: a side chat question, or a card in the composer.
 */
export function SelectionPrompt({ mode, quote, x, y, onSubmit, onClose }: {
  mode: PromptMode;
  quote: string;
  x: number;
  y: number;
  /** Rejecting keeps the popup (and the text) open. */
  onSubmit: (text: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const drag = useDrag();
  const input = useRef<HTMLTextAreaElement>(null);
  const side = mode === 'side';
  const Icon = side ? MessageCircleQuestionIcon : ReplyIcon;
  // A reply may be just the quote; a side chat needs a question.
  const ready = side ? !!text.trim() : true;

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      await onSubmit(text.trim());
    } catch {
      setBusy(false);
    }
  };
  const left = Math.min(Math.max(x - WIDTH / 2, 8), Math.max(8, window.innerWidth - WIDTH - 8));
  const top = Math.min(Math.max(y, 8), Math.max(8, window.innerHeight - 220));

  return (
    <div
      role="dialog"
      aria-label={side ? 'Side chat question' : 'Reply to selection'}
      data-testid="selection-prompt"
      data-mode={mode}
      style={{ ...drag.style, left, top, width: WIDTH }}
      className="fixed z-50 flex max-w-[calc(100vw-1rem)] flex-col rounded-xl border bg-popover shadow-xl"
    >
      <header {...drag.handle} className={cn(drag.handle.className, 'flex items-center gap-1.5 border-b py-1.5 pr-1.5 pl-3 text-sm font-medium')}>
        <Icon className="size-3.5 text-muted-foreground" />
        <span className="flex-1">{side ? 'Side chat' : 'Reply'}</span>
        <Button variant="ghost" size="icon" className="size-6 text-muted-foreground" aria-label="关闭" onClick={onClose}>
          <XIcon className="size-3.5" />
        </Button>
      </header>
      <div className="flex flex-col gap-2 p-2.5">
        <div className="flex items-start gap-1.5 rounded-md bg-muted/60 px-2 py-1.5 text-xs">
          <QuoteIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
          <div data-selectable className="line-clamp-4 min-w-0 flex-1 whitespace-pre-wrap text-muted-foreground">{quote}</div>
        </div>
        <div className="flex items-end gap-1.5 rounded-lg border bg-background px-2.5 py-1.5">
          <textarea
            ref={input}
            rows={2}
            value={text}
            aria-label={side ? 'Side chat message' : 'Reply message'}
            placeholder={side ? '问问这段内容…（不会写入会话）' : '写下你的回复…（添加到输入框）'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
            className="max-h-32 min-h-12 flex-1 resize-none bg-transparent text-sm leading-6 outline-none placeholder:text-muted-foreground [field-sizing:content]"
          />
          <Button size="icon" className="size-7 shrink-0 rounded-full" disabled={!ready || busy} aria-label={side ? 'Ask' : 'Add reply'} onClick={() => void submit()}>
            <ArrowUpIcon className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
