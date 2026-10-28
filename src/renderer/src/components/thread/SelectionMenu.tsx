import { useEffect, useRef, useState, type RefObject } from 'react';
import { CopyIcon, MessageCircleQuestionIcon, ReplyIcon } from 'lucide-react';
import { toast } from 'sonner';
import { copyText } from '@/components/common/Copy';
import { errText } from '@/lib/api';
import { replyWith } from '@/store/actions';
import { useT } from '@/lib/i18n';
import { askSide } from '@/store/side';
import { SelectionPrompt, type PromptMode } from './SelectionPrompt';

interface Picked {
  text: string;
  x: number;
  y: number;
}

/**
 * Selecting text in the conversation offers two things: ask about it in a side chat
 * (the session is not interrupted) or reply to it, which lands in the composer as a card.
 * Either one is typed in a small draggable popup.
 */
export function SelectionMenu({ sid, scope }: { sid: string; scope: RefObject<HTMLElement | null> }) {
  const t = useT();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [prompt, setPrompt] = useState<(Picked & { mode: PromptMode }) | null>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scope.current;
    if (!el) return;
    const read = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (!sel || sel.isCollapsed || !text || !sel.rangeCount) return setPicked(null);
      const range = sel.getRangeAt(0);
      const within = (node: Node) => !!(node instanceof Element ? node : node.parentElement)?.closest('.prose-chat') && el.contains(node);
      if (!within(range.startContainer) || !within(range.endContainer)) return setPicked(null);
      const rect = range.getBoundingClientRect();
      setPicked({ text, x: rect.left + rect.width / 2, y: rect.top });
    };
    // Read after the browser has finished the selection this click made.
    const onUp = (e: MouseEvent) => {
      if (menu.current?.contains(e.target as Node)) return;
      setTimeout(read, 0);
    };
    const hide = () => setPicked(null);
    const onChange = () => {
      if (window.getSelection()?.isCollapsed) setPicked(null);
    };
    el.addEventListener('mouseup', onUp);
    el.addEventListener('scroll', hide, { capture: true, passive: true });
    document.addEventListener('selectionchange', onChange);
    return () => {
      el.removeEventListener('mouseup', onUp);
      el.removeEventListener('scroll', hide, { capture: true });
      document.removeEventListener('selectionchange', onChange);
    };
  }, [scope, sid]);
  useEffect(() => {
    setPicked(null);
    setPrompt(null);
  }, [sid]);

  if (prompt) {
    const close = () => setPrompt(null);
    return (
      <SelectionPrompt
        mode={prompt.mode}
        quote={prompt.text}
        x={prompt.x}
        y={prompt.y + 32}
        onClose={close}
        onSubmit={async (text) => {
          try {
            if (prompt.mode === 'side') await askSide(sid, text, prompt.text);
            else replyWith(sid, prompt.text, text);
          } catch (err) {
            toast.error(errText(err));
            throw err;
          }
          close();
        }}
      />
    );
  }
  if (!picked) return null;
  const open = (mode: PromptMode) => {
    setPrompt({ ...picked, mode });
    window.getSelection()?.removeAllRanges();
    setPicked(null);
  };
  const left = Math.min(Math.max(picked.x, 130), window.innerWidth - 130);
  const above = picked.y > 56;
  return (
    <div
      ref={menu}
      role="menu"
      aria-label={t('selection.actions')}
      // Pressing a button must not collapse the selection it acts on.
      onMouseDown={(e) => e.preventDefault()}
      style={{ left, top: above ? picked.y - 8 : picked.y + 28, transform: above ? 'translate(-50%, -100%)' : 'translateX(-50%)' }}
      className="fixed z-50 flex items-center gap-0.5 rounded-lg border bg-popover p-1 text-sm shadow-lg"
    >
      <button
        role="menuitem"
        className="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-accent"
        onClick={() => { void copyText(picked.text); window.getSelection()?.removeAllRanges(); setPicked(null); }}
      >
        <CopyIcon className="size-3.5" />{t('selection.copy')}
      </button>
      <button
        role="menuitem"
        className="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-accent"
        onClick={() => open('side')}
      >
        <MessageCircleQuestionIcon className="size-3.5" />{t('selection.sideChat')}
      </button>
      <button
        role="menuitem"
        className="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-accent"
        onClick={() => open('reply')}
      >
        <ReplyIcon className="size-3.5" />{t('selection.reply')}
      </button>
    </div>
  );
}
