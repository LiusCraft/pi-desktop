import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import {
  BotIcon,
  FileDiffIcon,
  FileIcon,
  FolderIcon,
  GlobeIcon,
  ListChecksIcon,
  Maximize2Icon,
  Minimize2Icon,
  PlusIcon,
  SquareTerminalIcon,
  XIcon,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { canTerminal } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { closeDetail, selectWorkspaceTab, togglePanel, toggleWorkspaceExpanded } from '@/store/actions';
import { selectedWorkspaceTab } from '@/store/layout';
import type { SessionView, WorkspaceTab } from '@/store/types';
import { IconBtn } from './PanelToolbar';
import { WorkPanel, DetailPanel, DiffPanel, FilesPanel, PreviewPanel, TasksPanel } from './Panels';
import { TerminalPanel } from './TerminalPanel';

const TABS = {
  progress: { label: 'progress.title', icon: ListChecksIcon, Panel: WorkPanel },
  tasks: { label: 'tasks.title', icon: BotIcon, Panel: TasksPanel },
  diff: { label: 'panel.changes', icon: FileDiffIcon, Panel: DiffPanel },
  preview: { label: 'panel.preview', icon: GlobeIcon, Panel: PreviewPanel },
  files: { label: 'panel.files', icon: FolderIcon, Panel: FilesPanel },
  terminal: { label: 'main.terminal', icon: SquareTerminalIcon, Panel: TerminalPanel },
  detail: { label: 'panel.details', icon: FileIcon, Panel: DetailPanel },
} as const;

const CODE_TABS = ['tasks', 'terminal', 'diff', 'preview', 'files'] as const;
const WORK_TABS = ['progress', 'tasks'] as const;

export function NewWorkspaceTabMenu({ s }: { s: SessionView }) {
  const t = useT();
  const choices = s.meta.kind === 'work' ? WORK_TABS : CODE_TABS;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconBtn title={t('panel.newWorkspaceTab')}>
          <PlusIcon className="size-4" />
        </IconBtn>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {choices.map((tab) => {
          if (tab === 'terminal' && !canTerminal) return null;
          const { icon: Icon, label } = TABS[tab];
          return (
            <DropdownMenuItem
              key={tab}
              onSelect={() => {
                if (s.panels[tab]) selectWorkspaceTab(s.meta.id, tab);
                else togglePanel(s.meta.id, tab, true);
              }}
            >
              <Icon aria-hidden />
              {t(label)}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One dock for all open panels. Switching tabs hides their contents without unmounting them. */
export function Workspace({ s, tabs }: { s: SessionView; tabs: WorkspaceTab[] }) {
  const t = useT();
  const prefix = useId();
  const sid = s.meta.id;
  const active = selectedWorkspaceTab(s, tabs);
  const list = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<WorkspaceTab, HTMLButtonElement>());

  useEffect(() => {
    const selected = list.current?.querySelector('[data-state="active"]');
    selected?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [active, tabs.length, t]);

  function close(tab: WorkspaceTab, moveFocus: boolean) {
    const index = tabs.indexOf(tab);
    const target = tab === active ? (tabs[index + 1] ?? tabs[index - 1]) : active;
    if (tab === 'detail') closeDetail(sid);
    else togglePanel(sid, tab, false);
    if (!moveFocus) return;
    if (target) buttons.current.get(target)?.focus();
    else requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-composer-input]')?.focus());
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, tab: WorkspaceTab) {
    const index = tabs.indexOf(tab);
    const next =
      event.key === 'ArrowLeft'
        ? tabs[(index - 1 + tabs.length) % tabs.length]
        : event.key === 'ArrowRight'
          ? tabs[(index + 1) % tabs.length]
          : event.key === 'Home'
            ? tabs[0]
            : event.key === 'End'
              ? tabs.at(-1)
              : undefined;
    if (next) {
      event.preventDefault();
      selectWorkspaceTab(sid, next);
      buttons.current.get(next)?.focus();
    } else if (event.key === 'Delete') {
      event.preventDefault();
      close(tab, true);
    }
  }

  return (
    <section
      data-slot="workspace"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg surface-flat bg-card"
    >
      <div className="panel-tabs">
        <div ref={list} role="tablist" aria-label={t('main.panels')} className="flex min-w-0 flex-1 overflow-x-auto">
          {tabs.map((tab) => {
            const { icon: Icon } = TABS[tab];
            const label = tab === 'detail' && s.detail?.type === 'plan' ? t('plan.title') : t(TABS[tab].label);
            const id = `${prefix}-${tab}`;
            return (
              <div
                key={tab}
                data-state={active === tab ? 'active' : 'inactive'}
                className="panel-tab gap-1 pr-1.5 pl-2.5"
              >
                <button
                  ref={(element) => {
                    if (element) buttons.current.set(tab, element);
                    else buttons.current.delete(tab);
                  }}
                  id={`${id}-tab`}
                  type="button"
                  role="tab"
                  aria-selected={active === tab}
                  aria-controls={`${id}-panel`}
                  tabIndex={active === tab ? 0 : -1}
                  className="flex h-full items-center gap-1.5 rounded-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                  onClick={() => selectWorkspaceTab(sid, tab)}
                  onKeyDown={(event) => onKeyDown(event, tab)}
                >
                  <Icon className="size-3.5 shrink-0" aria-hidden />
                  {label}
                </button>
                <IconBtn
                  title={t('panel.closeTab', { name: label })}
                  className="size-5 rounded-sm"
                  onClick={(event) => close(tab, document.activeElement === event.currentTarget)}
                >
                  <XIcon className="size-3" />
                </IconBtn>
              </div>
            );
          })}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 px-1">
          <IconBtn
            title={t(s.workspaceExpanded ? 'panel.restoreWorkspace' : 'panel.expandWorkspace')}
            onClick={() => toggleWorkspaceExpanded(sid)}
          >
            {s.workspaceExpanded ? <Minimize2Icon className="size-3.5" /> : <Maximize2Icon className="size-3.5" />}
          </IconBtn>
          <NewWorkspaceTabMenu s={s} />
        </div>
      </div>
      {tabs.map((tab) => {
        const { Panel } = TABS[tab];
        const id = `${prefix}-${tab}`;
        return (
          <div
            key={tab}
            id={`${id}-panel`}
            role="tabpanel"
            aria-labelledby={`${id}-tab`}
            data-slot="workspace-panel"
            data-tab={tab}
            hidden={active !== tab}
            className="min-h-0 min-w-0 flex-1"
          >
            <Panel s={s} />
          </div>
        );
      })}
    </section>
  );
}
