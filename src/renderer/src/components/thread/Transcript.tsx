import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CheckIcon, ChevronDownIcon, CircleAlertIcon } from 'lucide-react';
import type { SetupStep } from '@shared/protocol';
import { fmtDur, fmtTok } from '@/lib/format';
import { cn } from '@/lib/utils';
import { runningTasks } from '@/components/workspace/Panels';
import { togglePanel } from '@/store/actions';
import { useApp } from '@/store/app';
import { rememberScroll, savedScroll } from '@/store/scroll';
import type { Item, SessionView } from '@/store/types';
import { AskItem, FootItem, GroupItem, NoteItem, PermItem, PlanItem, PrEventItem, SuggestItem, TextItem, TodosItem, UserItem } from './Items';

function renderItem(sid: string, item: Item, items: Item[], index: number, view: string) {
  switch (item.kind) {
    case 'user': return <UserItem sid={sid} item={item} />;
    case 'text': return <TextItem item={item} />;
    case 'note': return <NoteItem item={item} />;
    case 'group': return <GroupItem sid={sid} item={item} view={view} />;
    case 'todos': return <TodosItem item={item} />;
    case 'perm': return <PermItem sid={sid} item={item} />;
    case 'ask': return <AskItem sid={sid} item={item} />;
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
  const failed = steps.some((x) => x.state === 'error');
  return (
    <div className="rounded-xl border bg-card px-4 py-3 text-sm">
      <div className="mb-2 flex items-center gap-2 font-medium">
        {failed ? <CircleAlertIcon className="size-4 text-destructive" /> : <span className="spark spin" />}
        {failed ? '会话启动失败' : '正在启动会话…'}
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
      {failed && <div className="mt-2 text-xs text-muted-foreground">再发一条消息会重试；不需要这个会话时可以删除它。</div>}
    </div>
  );
}

function StatusLine({ s }: { s: SessionView }) {
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
        <button className="rounded-md bg-info/15 px-1.5 py-0.5 text-info hover:bg-info/25" title="Show background tasks" onClick={() => togglePanel(s.meta.id, 'tasks', true)}>
          {tasks} running task{tasks > 1 ? 's' : ''}
        </button>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-sm text-muted-foreground">
      <span className="spark spin shrink-0" />
      <span className="shrink-0">{fmtDur(Date.now() - s.t0)} · {fmtTok(s.tokens)} tokens</span>
      {tasks > 0 && (
        <button
          className="shrink-0 rounded-md bg-info/15 px-1.5 py-0.5 text-info hover:bg-info/25"
          title="Show background tasks"
          onClick={() => togglePanel(s.meta.id, 'tasks', true)}
        >
          {tasks} running task{tasks > 1 ? 's' : ''}
        </button>
      )}
      <span className="min-w-0 flex-1 truncate">{s.waiting ? 'Waiting for you…' : s.statusText || 'Thinking…'}</span>
    </div>
  );
}

/** How close to the bottom still counts as "following the answer". */
const STICK_PX = 160;

const nearBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;

/** The conversation, kept pinned to the bottom while the user is near it. */
export function Transcript({ s }: { s: SessionView }) {
  const view = useApp((st) => st.prefs.viewMode);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  /** A smooth jump is in flight: scroll events from the animation are not the user's. */
  const jumping = useRef(false);
  const [atBottom, setAtBottom] = useState(true);
  const sid = s.meta.id;

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
    <div className="relative min-h-0 flex-1">
      <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 pt-6 pb-4">
          {s.items.map((item, i) => (
            <div key={item.key} className="transcript-item">{renderItem(s.meta.id, item, s.items, i, view)}</div>
          ))}
          {s.setup && <SetupCard steps={s.setup} />}
          <StatusLine s={s} />
        </div>
      </div>
      {!atBottom && (
        <button
          type="button"
          onClick={jumpToLatest}
          title="Jump to the newest message"
          aria-label="Jump to the newest message"
          className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-card/95 px-3 py-1.5 text-xs text-muted-foreground shadow-md backdrop-blur transition-colors hover:bg-accent hover:text-foreground"
        >
          <ChevronDownIcon className="size-3.5" />
          Latest
        </button>
      )}
    </div>
  );
}
