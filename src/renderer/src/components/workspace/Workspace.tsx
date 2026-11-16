import { Fragment, type ReactNode } from 'react';
import { useDefaultLayout } from 'react-resizable-panels';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { canTerminal } from '@/lib/api';
import { expandCard, moveCard } from '@/store/actions';
import type { Arrangement, CardId, SessionView } from '@/store/types';
import { WorkPanel, DetailPanel, DiffPanel, FilesPanel, PreviewPanel, TasksPanel, type CardProps } from './Panels';
import { TerminalPanel } from './TerminalPanel';

/** Put the cards the user dragged where they left them; the rest keep their default column, after the placed ones. */
function arranged(defaults: Arrangement, saved: Arrangement): Arrangement {
  const open = new Set([...defaults.primary, ...defaults.secondary]);
  const placed = new Set<CardId>();
  const result: Arrangement = { primary: [], secondary: [] };
  for (const column of ['primary', 'secondary'] as const) {
    for (const id of saved[column]) {
      if (open.has(id) && !placed.has(id)) {
        placed.add(id);
        result[column].push(id);
      }
    }
  }
  for (const column of ['primary', 'secondary'] as const) {
    for (const id of defaults[column]) if (!placed.has(id)) result[column].push(id);
  }
  return result;
}

/** Which cards are open, split into the two tool columns. */
export function openCards(s: SessionView): Arrangement {
  return arranged(defaultCards(s), s.arrangement);
}

function defaultCards(s: SessionView): Arrangement {
  if (s.meta.kind === 'work') {
    return {
      primary: [
        ...(s.panels.progress ? (['progress'] as const) : []),
        ...(s.panels.tasks ? (['tasks'] as const) : []),
        ...(s.detail ? (['detail'] as const) : []),
      ],
      secondary: [],
    };
  }
  const primary: CardId[] = [];
  if (s.panels.tasks) primary.push('tasks');
  if (s.panels.diff) primary.push('diff');
  if (s.panels.preview) primary.push('preview');
  // A file opens inside the Files card, so only the other details (plan, subagent) get a card of their own.
  if (s.detail && s.detail.type !== 'file') primary.push('detail');
  const secondary: CardId[] = [];
  if (s.panels.files) secondary.push('files');
  if (s.panels.terminal && canTerminal) secondary.push('terminal');
  return { primary, secondary };
}

function renderCard(id: CardId, s: SessionView, card: CardProps): ReactNode {
  switch (id) {
    case 'progress':
      return <WorkPanel s={s} {...card} />;
    case 'tasks':
      return <TasksPanel s={s} {...card} />;
    case 'diff':
      return <DiffPanel s={s} {...card} />;
    case 'preview':
      return <PreviewPanel s={s} {...card} />;
    case 'detail':
      return <DetailPanel s={s} {...card} />;
    case 'files':
      return <FilesPanel s={s} {...card} />;
    case 'terminal':
      return <TerminalPanel s={s} {...card} />;
  }
}

function Column({
  ids,
  s,
  columns,
  expanded,
  toggleExpand,
}: {
  ids: CardId[];
  s: SessionView;
  columns: Arrangement;
  expanded: CardId | null;
  toggleExpand: (id: CardId, wide: boolean) => void;
}) {
  // Each session keeps its own split for every combination of open cards.
  const key = ids.join('+');
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: `${s.meta.id}:col:${key}` });
  return (
    <ResizablePanelGroup
      orientation="vertical"
      id={`${s.meta.id}:col:${key}`}
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      {ids.map((id, i) => (
        <Fragment key={id}>
          {i > 0 && <ResizableHandle className="my-0.5 bg-transparent" />}
          <ResizablePanel id={id} minSize={90} className="py-1">
            {renderCard(id, s, {
              expanded: expanded === id,
              onExpand: (wide) => toggleExpand(id, wide),
              cardId: id,
              onMove: (dragged, place) => moveCard(s.meta.id, dragged, id, place, columns),
            })}
          </ResizablePanel>
        </Fragment>
      ))}
    </ResizablePanelGroup>
  );
}

/** The card blown up over the workspace (or the whole session), if it is still open. */
export function soloCard(s: SessionView): CardId | null {
  const { primary, secondary } = openCards(s);
  return s.expanded && [...primary, ...secondary].includes(s.expanded) ? s.expanded : null;
}

/** The tool workspace beside the conversation: one or two resizable columns of cards. */
export function Workspace({ s }: { s: SessionView }) {
  const expanded = s.expanded;
  const columns = useDefaultLayout({ id: `${s.meta.id}:columns` });
  // Leaving a card expanded again restores it; the same card asked for in the other scope switches scope instead.
  const layout = openCards(s);
  const { primary, secondary } = layout;
  const all = [...primary, ...secondary];
  // A lone card has nothing to share the workspace with, so expanding it takes the whole session.
  const toggleExpand = (card: CardId, wide: boolean) => {
    const whole = wide || all.length === 1;
    expandCard(s.meta.id, expanded === card && (!whole || s.expandedWide) ? null : card, whole);
  };
  const solo = soloCard(s);
  if (solo) {
    return (
      <div className="h-full p-1">
        {renderCard(solo, s, { expanded: true, onExpand: (wide) => toggleExpand(solo, wide) })}
      </div>
    );
  }
  if (!primary.length || !secondary.length)
    return (
      <div className="h-full px-1">
        <Column ids={all} s={s} columns={layout} expanded={expanded} toggleExpand={toggleExpand} />
      </div>
    );
  return (
    <ResizablePanelGroup
      orientation="horizontal"
      id={`${s.meta.id}:columns`}
      defaultLayout={columns.defaultLayout}
      onLayoutChanged={columns.onLayoutChanged}
      className="px-1"
    >
      <ResizablePanel id="primary" minSize={220}>
        <Column ids={primary} s={s} columns={layout} expanded={expanded} toggleExpand={toggleExpand} />
      </ResizablePanel>
      <ResizableHandle className="mx-0.5 bg-transparent" />
      <ResizablePanel id="secondary" minSize={220}>
        <Column ids={secondary} s={s} columns={layout} expanded={expanded} toggleExpand={toggleExpand} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
