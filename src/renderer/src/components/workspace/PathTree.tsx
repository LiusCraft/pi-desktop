// A file tree (@pierre/trees) for a list of paths: the changed files of the Diff panel and the
// project files of the Files panel. Rows open on click or Enter; a right click opens the shared file menu.
import { useEffect, useMemo, useRef, useState } from 'react';
import { FileTree, useFileTree } from '@pierre/trees/react';
import type { FileTreeRowDecoration, GitStatusEntry } from '@pierre/trees';
import type { SessionMeta } from '@shared/protocol';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import { FileMenuContent } from './FileContextMenu';

/** A click and the selection change it causes arrive together; one open is enough. */
const CLICK_SETTLE_MS = 80;

export type PathStatus = GitStatusEntry['status'];

interface RowTarget {
  path: string;
  directory: boolean;
}

/** The row a DOM event came from, read off the row's own attributes (the rows live in a shadow root). */
function rowOf(event: Event): RowTarget | null {
  for (const node of event.composedPath()) {
    if (!(node instanceof HTMLElement) || !node.dataset.itemPath) continue;
    return { path: node.dataset.itemPath.replace(/\/$/, ''), directory: node.dataset.itemType === 'folder' };
  }
  return null;
}

export function PathTree({ meta, label, paths, statuses, decorate, selected, expandAll = false, snapshotOf, onOpen, onPin, className }: {
  meta: SessionMeta;
  /** What the list is called for assistive tech. */
  label: string;
  paths: string[];
  statuses?: Map<string, PathStatus>;
  /** Text at the end of a file's row (e.g. its added/removed counts). */
  decorate?: (path: string) => FileTreeRowDecoration | null;
  /** The file to mark as current. */
  selected?: string | null;
  expandAll?: boolean;
  /** A deleted file can still be quoted from its diff snapshot. */
  snapshotOf?: (path: string) => string | undefined;
  /** A click on a file: show it (as a preview). */
  onOpen: (path: string) => void;
  /** A double click on a file: keep it open. */
  onPin?: (path: string) => void;
  className?: string;
}) {
  const latest = useRef({ onOpen, onPin, decorate });
  latest.current = { onOpen, onPin, decorate };
  const lastClick = useRef(0);
  const programmatic = useRef(false);
  const [menu, setMenu] = useState<RowTarget>({ path: '', directory: false });
  const gitStatus = useMemo(() => [...(statuses ?? [])].map(([path, status]) => ({ path, status })), [statuses]);

  const { model } = useFileTree({
    paths,
    initialExpansion: expandAll ? 'open' : 'closed',
    flattenEmptyDirectories: true,
    search: true,
    fileTreeSearchMode: 'hide-non-matches',
    gitStatus,
    renderRowDecoration: ({ item }) => (item.kind === 'file' ? latest.current.decorate?.(item.path) ?? null : null),
    onSelectionChange: (picked) => {
      const path = picked.at(-1);
      if (!path || programmatic.current || Date.now() - lastClick.current < CLICK_SETTLE_MS) return;
      if (!model.getItem(path)?.isDirectory()) latest.current.onOpen(path);
    },
  });

  const pathKey = paths.join('\n');
  const first = useRef(true);
  useEffect(() => {
    if (first.current) return void (first.current = false);
    model.resetPaths(paths);
  }, [pathKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => model.setGitStatus(gitStatus), [model, gitStatus]);
  useEffect(() => {
    if (!selected) return;
    programmatic.current = true;
    model.getItem(selected)?.select();
    queueMicrotask(() => void (programmatic.current = false));
  }, [model, selected]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="navigation"
          aria-label={label}
          className={cn('path-tree min-h-0', className)}
          onContextMenuCapture={(event) => setMenu(rowOf(event.nativeEvent) ?? { path: '', directory: false })}
          onClickCapture={(event) => {
            const row = rowOf(event.nativeEvent);
            if (!row || row.directory) return;
            lastClick.current = Date.now();
            latest.current.onOpen(row.path);
          }}
          onDoubleClickCapture={(event) => {
            const row = rowOf(event.nativeEvent);
            if (row && !row.directory) latest.current.onPin?.(row.path);
          }}
        >
          <FileTree model={model} style={{ height: '100%' }} />
        </div>
      </ContextMenuTrigger>
      <FileMenuContent meta={meta} path={menu.path} directory={menu.directory} snapshot={snapshotOf?.(menu.path)} />
    </ContextMenu>
  );
}
