import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpIcon,
  ExternalLinkIcon,
  PanelBottomCloseIcon,
  PinIcon,
  PinOffIcon,
  QuoteIcon,
  RotateCcwIcon,
  SquareIcon,
  XIcon,
} from 'lucide-react';
import type { SideTurn } from '@shared/protocol';
import { Markdown } from '@/components/common/Markdown';
import { Button } from '@/components/ui/button';
import { call, errText } from '@/lib/api';
import { useDrag } from '@/lib/drag';
import { t as tr, useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { askSide, dockSide, hideSide, popOutSide, useSide, useSideChat } from '@/store/side';

function Turn({ turn }: { turn: SideTurn }) {
  if (turn.role === 'assistant') return <Markdown text={turn.text} className="text-sm" />;
  return (
    <div className="ml-auto flex max-w-[92%] flex-col gap-1.5 rounded-xl bg-muted px-3 py-2 text-sm">
      {turn.quote && (
        <div data-selectable className="line-clamp-4 border-l-2 pl-2 text-xs whitespace-pre-wrap text-muted-foreground">
          {turn.quote}
        </div>
      )}
      <div data-selectable className="break-words whitespace-pre-wrap">
        {turn.text}
      </div>
    </div>
  );
}

/**
 * A question about the session that never enters it (/btw). It shows inside the session
 * by default, can be popped out to a window of its own and pinned above other windows.
 */
export function SideChatView({ sid, mode }: { sid: string; mode: 'embedded' | 'window' }) {
  const t = useT();
  const chat = useSideChat(sid);
  const drag = useDrag();
  const pinned = useSide((s) => s.windows[sid]?.pinned ?? false);
  const [text, setText] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const lastTurn = chat.turns.length;

  useEffect(() => {
    const el = body.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastTurn, chat.busy, chat.error]);
  useEffect(() => {
    input.current?.focus();
  }, [sid, chat.quote]);
  useEffect(() => {
    if (mode === 'window' && chat.title) document.title = `${tr('side.title')} · ${chat.title}`;
  }, [mode, chat.title]);

  const send = () => {
    const value = text.trim();
    if (!value || chat.busy) return;
    setText('');
    setFailed(null);
    askSide(sid, value).catch((err) => {
      setText(value);
      setFailed(errText(err));
    });
  };
  const error = failed ?? chat.error;
  const icon = 'size-7 text-muted-foreground';

  return (
    <div
      className={cn(
        'flex min-h-0 flex-col bg-card',
        mode === 'embedded' ? 'h-full rounded-xl border shadow-xl' : 'h-screen',
      )}
      data-testid="side-chat"
      data-mode={mode}
      style={mode === 'embedded' ? drag.style : undefined}
    >
      <header
        {...(mode === 'embedded' ? drag.handle : {})}
        className={cn(
          'flex shrink-0 items-center gap-1 border-b py-1.5 pr-1.5 pl-3',
          mode === 'embedded' && drag.handle.className,
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{t('side.title')}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {t('side.notSaved')}
            {chat.title ? ` · ${chat.title}` : ''}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className={icon}
          title={t('side.reset')}
          disabled={!chat.turns.length && !chat.busy}
          onClick={() => void call('sessions:sideReset', sid)}
        >
          <RotateCcwIcon className="size-3.5" />
        </Button>
        {mode === 'window' ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              className={cn(icon, pinned && 'bg-accent text-foreground')}
              title={t(pinned ? 'side.unpin' : 'side.pin')}
              aria-pressed={pinned}
              onClick={() => void call('side:pin', sid, !pinned)}
            >
              {pinned ? <PinOffIcon className="size-3.5" /> : <PinIcon className="size-3.5" />}
            </Button>
            <Button variant="ghost" size="icon" className={icon} title={t('side.dock')} onClick={() => dockSide(sid)}>
              <PanelBottomCloseIcon className="size-3.5" />
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon"
              className={icon}
              title={t('side.popOut')}
              onClick={() => popOutSide(sid)}
            >
              <ExternalLinkIcon className="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className={icon} title={t('side.close')} onClick={() => hideSide(sid)}>
              <XIcon className="size-3.5" />
            </Button>
          </>
        )}
      </header>

      <div ref={body} className="space-y-3 min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {!chat.turns.length && !chat.busy && (
          <p className="py-6 text-center text-xs text-muted-foreground">
            {t('side.empty')}
            <br />
            {t('side.empty2')}
          </p>
        )}
        {chat.turns.map((turn, i) => (
          <Turn key={i} turn={turn} />
        ))}
        {chat.busy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="spark spin" />
            {t('side.thinking')}
            <button
              className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
              onClick={() => void call('sessions:sideAbort', sid)}
            >
              <SquareIcon className="size-3" />
              {t('side.stop')}
            </button>
          </div>
        )}
        {error && (
          <div role="alert" className="rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs break-words text-destructive">
            {error}
          </div>
        )}
      </div>

      <footer className="shrink-0 border-t p-2">
        {chat.quote && (
          <div className="mb-1.5 flex items-start gap-1.5 rounded-md bg-muted/60 px-2 py-1.5 text-xs">
            <QuoteIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
            <div className="line-clamp-3 min-w-0 flex-1 whitespace-pre-wrap text-muted-foreground">{chat.quote}</div>
            <button
              aria-label={t('side.removeQuote')}
              className="text-muted-foreground hover:text-foreground"
              onClick={() => void call('sessions:sideStage', sid, null)}
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-1.5 rounded-lg border bg-background px-2.5 py-1.5">
          <textarea
            ref={input}
            rows={1}
            value={text}
            aria-label={t('side.message')}
            placeholder={t(chat.quote ? 'side.askQuote' : 'side.askSide')}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            className="[field-sizing:content] max-h-32 min-h-6 flex-1 resize-none bg-transparent text-sm leading-6 outline-none placeholder:text-muted-foreground"
          />
          <Button
            size="icon"
            className="size-7 shrink-0 rounded-full"
            disabled={!text.trim() || chat.busy}
            aria-label={t('side.send')}
            onClick={send}
          >
            <ArrowUpIcon className="size-4" />
          </Button>
        </div>
      </footer>
    </div>
  );
}
