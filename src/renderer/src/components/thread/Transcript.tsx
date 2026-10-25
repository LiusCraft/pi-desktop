import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fmtDur, fmtTok } from '@/lib/format';
import { runningTasks } from '@/components/workspace/Panels';
import { togglePanel } from '@/store/actions';
import { useApp } from '@/store/app';
import type { Item, SessionView } from '@/store/types';
import { AskItem, FootItem, GroupItem, NoteItem, PermItem, PlanItem, TextItem, TodosItem, UserItem } from './Items';

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
    case 'foot': {
      let prev: string | undefined;
      for (let i = index - 1; i >= 0; i--) if (items[i].kind === 'text') { prev = (items[i] as any).text; break; }
      return <FootItem sid={sid} item={item} prevText={prev} />;
    }
  }
}

function StatusLine({ s }: { s: SessionView }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!s.running) return;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [s.running]);
  if (!s.running) return s.items.length ? <span className="spark opacity-60" /> : null;
  const tasks = runningTasks(s).length;
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

/** The conversation, kept pinned to the bottom while the user is near it. */
export function Transcript({ s }: { s: SessionView }) {
  const view = useApp((st) => st.prefs.viewMode);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const onScroll = () => {
    const el = scroller.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
  };
  useLayoutEffect(() => {
    stick.current = true;
  }, [s.meta.id]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });
  return (
    <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 pt-6 pb-4">
        {s.items.map((item, i) => (
          <div key={item.key}>{renderItem(s.meta.id, item, s.items, i, view)}</div>
        ))}
        <StatusLine s={s} />
      </div>
    </div>
  );
}
