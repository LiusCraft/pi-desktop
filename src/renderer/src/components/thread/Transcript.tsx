import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CheckIcon, ChevronDownIcon, CircleAlertIcon, PinIcon } from 'lucide-react';
import { findRange, markQuoted, quoteLinks, revealItem, type QuotePin } from '@/lib/quote-links';
import type { SetupStep } from '@shared/protocol';
import { fmtDur, fmtTok } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { PET_PERCH } from '@/components/composer/Clawd';
import { runningTasks } from '@/components/workspace/Panels';
import { togglePanel } from '@/store/actions';
import { useApp } from '@/store/app';
import { rememberScroll, savedScroll } from '@/store/scroll';
import type { Item, ItemOf, SessionView } from '@/store/types';
import { SelectionMenu } from './SelectionMenu';
import { AskCard, FootItem, GroupItem, isPendingAsk, NoteItem, PermItem, PlanItem, PrEventItem, SuggestItem, TextItem, TodosItem, UserItem } from './Items';

/** Under a passage that was replied to: a pin per reply, which jumps to the message that quoted it. */
function QuotePins({ pins }: { pins?: QuotePin[] }) {
  const t = useT();
  if (!pins?.length) return null;
  return (
    <div data-quote-pins className="mt-1 flex flex-wrap gap-1.5">
      {pins.map((pin) => (
        <button
          key={pin.userKey}
          type="button"
          onClick={() => revealItem(pin.userKey)}
          title={pin.comment ? t('transcript.pinTip', { comment: pin.comment }) : t('transcript.pinTipClick')}
          className="flex max-w-64 items-center gap-1 rounded-full border bg-muted/30 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <PinIcon className="size-3 shrink-0" />
          <span className="truncate">{pin.comment || t('transcript.pinLabel')}</span>
        </button>
      ))}
    </div>
  );
}

function renderItem(sid: string, item: Item, items: Item[], index: number, view: string, quoted?: (string | null)[]) {
  switch (item.kind) {
    case 'user': return <UserItem sid={sid} item={item} quoted={quoted} />;
    case 'text': return <TextItem item={item} />;
    case 'note': return <NoteItem item={item} />;
    case 'group': return <GroupItem sid={sid} item={item} view={view} />;
    case 'todos': return <TodosItem item={item} />;
    case 'perm': return <PermItem sid={sid} item={item} />;
    case 'ask': return <AskCard sid={sid} item={item} />;
    case 'plan': return <PlanItem sid={sid} item={item} />;
    case 'suggest': return <SuggestItem sid={sid} item={item} />;
    case 'prEvent': return <PrEventItem sid={sid} item={item} />;
    case 'foot': {
      let prev: string | undefined;
      for (let i = index - 1; i >= 0; i--) if (items[i].kind === 'text') { prev = (items[i] as any).text; break; }
      return <FootItem sid={sid} item={item} prevText={prev} />;
    }
  }
}

/** What is happening while a session starts: the worktree, then the agent with its extensions and MCP servers. */
function SetupCard({ steps }: { steps: SetupStep[] }) {
  const t = useT();
  const failed = steps.some((x) => x.state === 'error');
  return (
    <div className="rounded-xl border bg-card px-4 py-3 text-sm">
      <div className="mb-2 flex items-center gap-2 font-medium">
        {failed ? <CircleAlertIcon className="size-4 text-destructive" /> : <span className="spark spin" />}
        {t(failed ? 'transcript.setupFailed' : 'transcript.setupRunning')}
      </div>
      <ul className="space-y-1.5">
        {steps.map((step) => (
          <li key={step.id} className="flex items-start gap-2">
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
              {step.state === 'done' ? <CheckIcon className="size-3.5 text-success" />
                : step.state === 'error' ? <CircleAlertIcon className="size-3.5 text-destructive" />
                : step.state === 'running' ? <span className="size-3 animate-spin rounded-full border-[1.5px] border-primary border-t-transparent" />
                : <span className="size-2.5 rounded-full border-[1.5px] border-muted-foreground/40" />}
            </span>
            <span className="min-w-0">
              <span className={cn(step.state === 'pending' || step.state === 'done' ? 'text-muted-foreground' : 'text-foreground')}>{step.label}</span>
              {step.detail && <span className="block text-xs break-words text-destructive">{step.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
      {failed && <div className="mt-2 text-xs text-muted-foreground">{t('transcript.setupRetry')}</div>}
    </div>
  );
}

function StatusLine({ s }: { s: SessionView }) {
  const t = useT();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!s.running) return;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [s.running]);
  const tasks = runningTasks(s).length;
  if (s.setup) return null; // the start-up card says what is happening
  // Between turns, background tasks keep going: say so instead of showing a sleeping spark.
  if (!s.running && !tasks) return s.items.length ? <span className="spark opacity-60" /> : null;
  if (!s.running) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="spark opacity-60" />
        <button className="rounded-md bg-info/15 px-1.5 py-0.5 text-info hover:bg-info/25" title={t('transcript.showTasks')} onClick={() => togglePanel(s.meta.id, 'tasks', true)}>
          {t(tasks > 1 ? 'transcript.runningTasks' : 'transcript.runningTask', { n: tasks })}
        </button>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-sm text-muted-foreground">
      <span className="spark spin shrink-0" />
      <span className="shrink-0">{t('transcript.tokens', { dur: fmtDur(Date.now() - s.t0), tokens: fmtTok(s.tokens) })}</span>
      {tasks > 0 && (
        <button
          className="shrink-0 rounded-md bg-info/15 px-1.5 py-0.5 text-info hover:bg-info/25"
          title={t('transcript.showTasks')}
          onClick={() => togglePanel(s.meta.id, 'tasks', true)}
        >
          {t(tasks > 1 ? 'transcript.runningTasks' : 'transcript.runningTask', { n: tasks })}
        </button>
      )}
      <span className="min-w-0 flex-1 truncate">{s.waiting ? t('transcript.waitingYou') : s.statusText || t('status.thinking')}</span>
    </div>
  );
}

/** The question the agent is waiting on, docked right above the composer so it stays in view while the transcript scrolls. */
export function AskDock({ s }: { s: SessionView }) {
  const item = s.items.find((i): i is ItemOf<'ask'> => i.kind === 'ask' && !i.resolved && !!i.requestId);
  if (!item) return null;
  return (
    <div {...PET_PERCH} className="mx-auto max-h-[65%] w-full max-w-[786px] shrink-0 overflow-y-auto px-6 pb-2">
      <AskCard key={item.key} sid={s.meta.id} item={item} />
    </div>
  );
}

/** How close to the bottom still counts as "following the answer". */
const STICK_PX = 160;

const nearBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;

/** The conversation, kept pinned to the bottom while the user is near it. */
export function Transcript({ s }: { s: SessionView }) {
  const t = useT();
  const view = useApp((st) => st.prefs.viewMode);
  const scroller = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  /** A smooth jump is in flight: scroll events from the animation are not the user's. */
  const jumping = useRef(false);
  const [atBottom, setAtBottom] = useState(true);
  const sid = s.meta.id;
  const links = useMemo(() => quoteLinks(s.items), [s.items]);
  const quoted = useRef<{ range: Range; userKey: string }[]>([]);

  // The exact text that was replied to stays faintly marked.
  useLayoutEffect(() => {
    const root = scroller.current;
    if (!root || !links.pins.size) return;
    const marked: { range: Range; userKey: string }[] = [];
    for (const [key, pins] of links.pins) {
      const el = root.querySelector<HTMLElement>(`[data-item-key="${CSS.escape(key)}"]`);
      for (const pin of pins) {
        const range = el && findRange(el, pin.text);
        if (range) marked.push({ range, userKey: pin.userKey });
      }
    }
    quoted.current = marked;
    const unmark = markQuoted(marked.map((m) => m.range));
    return () => {
      quoted.current = [];
      unmark();
    };
  }, [links, s.items]);

  /** The reply that quoted the text under the pointer, if it is on a marked passage. */
  const replyAt = (x: number, y: number) => {
    const caret = document.caretRangeFromPoint?.(x, y);
    if (!caret) return undefined;
    return quoted.current.find(({ range }) => range.isPointInRange(caret.startContainer, caret.startOffset))?.userKey;
  };
  const onQuoteClick = (e: React.MouseEvent) => {
    if (!quoted.current.length || !window.getSelection()?.isCollapsed) return; // dragging a selection is not a click
    const userKey = replyAt(e.clientX, e.clientY);
    if (userKey) revealItem(userKey);
  };
  const hovering = useRef(false);
  const onQuoteHover = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!quoted.current.length) return;
    const on = !!replyAt(e.clientX, e.clientY);
    if (on !== hovering.current) {
      hovering.current = on;
      e.currentTarget.style.cursor = on ? 'pointer' : '';
    }
  };

  // Opening a session returns to where it was left, unless it was at the bottom (or moved on
  // while it was closed, in which case openSession dropped the remembered spot).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const saved = savedScroll(sid);
    const toBottom = !saved || saved.stick;
    el.scrollTop = toBottom ? el.scrollHeight : saved.top;
    // A spot inside the threshold counts as "following", exactly like a real scroll would.
    const near = toBottom || nearBottom(el);
    stick.current = near;
    setAtBottom(near);
    // Images and diagrams settle a frame later; restore once more so the view does not jump.
    const frame = requestAnimationFrame(() => {
      if (!stick.current && saved) el.scrollTop = saved.top;
    });
    return () => cancelAnimationFrame(frame);
  }, [sid]);

  // Follow along while the conversation grows, as long as the user is near the bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });

  const onScroll = () => {
    const el = scroller.current;
    if (!el || jumping.current) return;
    const near = nearBottom(el);
    stick.current = near;
    setAtBottom((was) => (was === near ? was : near));
    rememberScroll(sid, { top: el.scrollTop, stick: near });
  };

  const jumpToLatest = () => {
    const el = scroller.current;
    if (!el) return;
    jumping.current = true;
    stick.current = true;
    setAtBottom(true);
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    // The animation is short: a scroll event in the middle of it must not undo the intent.
    window.setTimeout(() => {
      jumping.current = false;
      rememberScroll(sid, { top: el.scrollTop, stick: true });
    }, 400);
  };

  return (
    <div ref={frame} className="relative min-h-0 flex-1">
      <SelectionMenu sid={sid} scope={frame} />
      <div ref={scroller} onScroll={onScroll} onClick={onQuoteClick} onMouseMove={onQuoteHover} className="h-full overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[786px] flex-col gap-4 px-6 pt-6 pb-4">
          {s.items.map((item, i) => (isPendingAsk(item) ? null : (
            <div key={item.key} data-item-key={item.key} className="transcript-item">
              {renderItem(s.meta.id, item, s.items, i, view, links.targets.get(item.key))}
              <QuotePins pins={links.pins.get(item.key)} />
            </div>
          )))}
          {s.setup && <SetupCard steps={s.setup} />}
          <StatusLine s={s} />
        </div>
      </div>
      {!atBottom && (
        <button
          type="button"
          onClick={jumpToLatest}
          title={t('transcript.jump')}
          aria-label={t('transcript.jump')}
          className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-card/95 px-3 py-1.5 text-xs text-muted-foreground shadow-md backdrop-blur transition-colors hover:bg-accent hover:text-foreground"
        >
          <ChevronDownIcon className="size-3.5" />
          Latest
        </button>
      )}
    </div>
  );
}
