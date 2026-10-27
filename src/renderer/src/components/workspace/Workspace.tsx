import { Fragment, type ReactNode } from 'react';
import { useDefaultLayout } from 'react-resizable-panels';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { expandCard } from '@/store/actions';
import type { CardId, SessionView } from '@/store/types';
import { WorkPanel, DetailPanel, DiffPanel, FilesPanel, PreviewPanel, TasksPanel, type CardProps } from './Panels';
import { TerminalPanel } from './TerminalPanel';

/** Which cards are open, split into the two tool columns. */
export function openCards(s: SessionView): { primary: CardId[]; secondary: CardId[] } {
  if (s.meta.kind === 'work') {
    return { primary: [...(s.panels.progress ? (['progress'] as const) : []), ...(s.panels.tasks ? (['tasks'] as const) : []), ...(s.detail ? (['detail'] as const) : [])], secondary: [] };
  }
  const primary: CardId[] = [];
  if (s.panels.tasks) primary.push('tasks');
  if (s.panels.diff) primary.push('diff');
  if (s.panels.preview) primary.push('preview');
  // A file opens inside the Files card, so only the other details (plan, subagent) get a card of their own.
  if (s.detail && s.detail.type !== 'file') primary.push('detail');
  const secondary: CardId[] = [];
  if (s.panels.files) secondary.push('files');
  if (s.panels.terminal) secondary.push('terminal');
  return { primary, secondary };
}

function renderCard(id: CardId, s: SessionView, card: CardProps): ReactNode {
  switch (id) {
    case 'progress': return <WorkPanel s={s} {...card} />;
    case 'tasks': return <TasksPanel s={s} {...card} />;
    case 'diff': return <DiffPanel s={s} {...card} />;
    case 'preview': return <PreviewPanel s={s} {...card} />;
    case 'detail': return <DetailPanel s={s} {...card} />;
    case 'files': return <FilesPanel s={s} {...card} />;
    case 'terminal': return <TerminalPanel s={s} {...card} />;
  }
}

function Column({ ids, s, expanded, setExpanded }: { ids: CardId[]; s: SessionView; expanded: CardId | null; setExpanded: (id: CardId | null) => void }) {
  // Each session keeps its own split for every combination of open cards.
  const key = ids.join('+');
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: `${s.meta.id}:col:${key}` });
  return (
    <ResizablePanelGroup orientation="vertical" id={`${s.meta.id}:col:${key}`} defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
      {ids.map((id, i) => (
        <Fragment key={id}>
          {i > 0 && <ResizableHandle className="my-0.5 bg-transparent" />}
          <ResizablePanel id={id} minSize={90} className="py-1">
            {renderCard(id, s, { expanded: expanded === id, onExpand: () => setExpanded(expanded === id ? null : id) })}
          </ResizablePanel>
        </Fragment>
      ))}
    </ResizablePanelGroup>
  );
}

/** The tool workspace beside the conversation: one or two resizable columns of cards. */
export function Workspace({ s }: { s: SessionView }) {
  const expanded = s.expanded;
  const columns = useDefaultLayout({ id: `${s.meta.id}:columns` });
  const setExpanded = (card: CardId | null) => expandCard(s.meta.id, card);
  const { primary, secondary } = openCards(s);
  const all = [...primary, ...secondary];
  const solo = expanded && all.includes(expanded) ? expanded : null;
  if (solo) {
    return <div className="h-full p-1">{renderCard(solo, s, { expanded: true, onExpand: () => setExpanded(null) })}</div>;
  }
  if (!primary.length || !secondary.length) return <div className="h-full px-1"><Column ids={all} s={s} expanded={expanded} setExpanded={setExpanded} /></div>;
  return (
    <ResizablePanelGroup orientation="horizontal" id={`${s.meta.id}:columns`} defaultLayout={columns.defaultLayout} onLayoutChanged={columns.onLayoutChanged} className="px-1">
      <ResizablePanel id="primary" minSize={220}>
        <Column ids={primary} s={s} expanded={expanded} setExpanded={setExpanded} />
      </ResizablePanel>
      <ResizableHandle className="mx-0.5 bg-transparent" />
      <ResizablePanel id="secondary" minSize={220}>
        <Column ids={secondary} s={s} expanded={expanded} setExpanded={setExpanded} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
