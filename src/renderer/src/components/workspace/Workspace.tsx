import { Fragment, useState, type ReactNode } from 'react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import type { SessionView } from '@/store/types';
import { CoworkPanel, DetailPanel, DiffPanel, FilesPanel, PreviewPanel, TasksPanel, TerminalPanel, type CardProps } from './Panels';

type CardId = 'progress' | 'tasks' | 'diff' | 'preview' | 'detail' | 'files' | 'terminal';

/** Which cards are open, split into the two tool columns. */
export function openCards(s: SessionView): { primary: CardId[]; secondary: CardId[] } {
  if (s.meta.kind === 'cowork') {
    return { primary: [...(s.panels.progress ? (['progress'] as const) : []), ...(s.panels.tasks ? (['tasks'] as const) : []), ...(s.detail ? (['detail'] as const) : [])], secondary: [] };
  }
  const primary: CardId[] = [];
  if (s.panels.tasks) primary.push('tasks');
  if (s.panels.diff) primary.push('diff');
  if (s.panels.preview) primary.push('preview');
  if (s.detail) primary.push('detail');
  const secondary: CardId[] = [];
  if (s.panels.files) secondary.push('files');
  if (s.panels.terminal) secondary.push('terminal');
  return { primary, secondary };
}

function renderCard(id: CardId, s: SessionView, card: CardProps): ReactNode {
  switch (id) {
    case 'progress': return <CoworkPanel s={s} {...card} />;
    case 'tasks': return <TasksPanel s={s} {...card} />;
    case 'diff': return <DiffPanel s={s} {...card} />;
    case 'preview': return <PreviewPanel s={s} {...card} />;
    case 'detail': return <DetailPanel s={s} {...card} />;
    case 'files': return <FilesPanel s={s} {...card} />;
    case 'terminal': return <TerminalPanel s={s} {...card} />;
  }
}

function Column({ ids, s, expanded, setExpanded }: { ids: CardId[]; s: SessionView; expanded: CardId | null; setExpanded: (id: CardId | null) => void }) {
  return (
    <ResizablePanelGroup orientation="vertical" id={`col-${ids.join('-')}`}>
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
  const [expanded, setExpanded] = useState<CardId | null>(null);
  const { primary, secondary } = openCards(s);
  const all = [...primary, ...secondary];
  const solo = expanded && all.includes(expanded) ? expanded : null;
  if (solo) {
    return <div className="h-full p-1">{renderCard(solo, s, { expanded: true, onExpand: () => setExpanded(null) })}</div>;
  }
  if (!primary.length || !secondary.length) return <div className="h-full px-1"><Column ids={all} s={s} expanded={expanded} setExpanded={setExpanded} /></div>;
  return (
    <ResizablePanelGroup orientation="horizontal" id="workspace-columns" className="px-1">
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
