import { useEffect, useRef, useState } from 'react';
import { CheckIcon, ChevronDownIcon, GitBranchIcon } from 'lucide-react';
import type { BranchInfo, FileChange } from '@shared/protocol';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { OVERLAY_COLLISION_PADDING } from '@/components/ui/overlay';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { call } from '@/lib/api';
import { ago } from '@/lib/format';
import { useT } from '@/lib/i18n';
import type { DiffScope } from '@/store/types';

function DiffTotals({ files }: { files?: FileChange[] }) {
  if (!files) return <span className="text-muted-foreground">—</span>;
  const { add, del } = files.reduce((total, file) => ({ add: total.add + file.add, del: total.del + file.del }), {
    add: 0,
    del: 0,
  });
  return (
    <span className="flex shrink-0 gap-1 text-xs tabular-nums">
      <span className="text-success">+{add}</span>
      <span className="text-destructive">−{del}</span>
    </span>
  );
}

export function DiffSince({
  cwd,
  scope,
  branch,
  sessionMode,
  files,
  onSelect,
  onOpenChange,
}: {
  cwd: string;
  scope: DiffScope;
  branch: string | null;
  sessionMode: boolean;
  files: Record<DiffScope, FileChange[] | undefined>;
  onSelect: (scope: DiffScope, branch?: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [branches, setBranches] = useState<BranchInfo[] | null>(null);
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!branchOpen) return;
    let cancelled = false;
    setBranches(null);
    setFailed(false);
    call('git:branchBases', cwd).then(
      (list) => {
        if (!cancelled) setBranches(list);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    const focus = requestAnimationFrame(() => input.current?.focus());
    return () => {
      cancelled = true;
      cancelAnimationFrame(focus);
    };
  }, [cwd, branchOpen]);
  const labels: Record<DiffScope, string> = {
    branch: sessionMode ? t('panel.sessionChanges') : branch || t('panel.base'),
    lastCommit: t('panel.lastCommit'),
    lastTurn: t('panel.lastTurn'),
  };
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) setBranchOpen(false);
    onOpenChange(next);
  };
  const select = (next: DiffScope, ref?: string) => {
    onSelect(next, ref);
    changeOpen(false);
  };
  const selected = (value: DiffScope) => (
    <span className="flex size-3.5 shrink-0 items-center">
      {scope === value && <CheckIcon className="size-3.5 text-info" />}
    </span>
  );
  // Keep the selected branch visible first without disturbing Git's recency order.
  const ordered = branches
    ? [...branches.filter((b) => b.name === branch), ...branches.filter((b) => b.name !== branch)]
    : [];
  return (
    <span className="flex min-w-0 items-center gap-1 text-sm font-normal">
      <span className="shrink-0 text-muted-foreground">{t('panel.since')}</span>
      <DropdownMenu open={open} onOpenChange={changeOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            className="min-w-0 gap-1.5 px-1.5 font-normal data-[state=open]:bg-accent"
            aria-label={t('panel.changeBase')}
          >
            <span className="truncate">{labels[scope]}</span>
            <DiffTotals files={files[scope]} />
            <ChevronDownIcon className="size-3 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 max-w-[calc(100vw-2rem)]">
          {sessionMode ? (
            <DropdownMenuItem onSelect={() => select('branch')}>
              {selected('branch')}
              <span className="min-w-0 flex-1 truncate">{labels.branch}</span>
              <DiffTotals files={files.branch} />
            </DropdownMenuItem>
          ) : (
            <DropdownMenuSub open={branchOpen} onOpenChange={setBranchOpen}>
              <DropdownMenuSubTrigger className="gap-2 rounded-lg px-2.5 py-2 text-[13px]">
                {selected('branch')}
                <span className="min-w-0 flex-1 truncate">{labels.branch}</span>
                <DiffTotals files={files.branch} />
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent
                  collisionPadding={OVERLAY_COLLISION_PADDING}
                  className="w-96 max-w-[calc(100vw-2rem)] rounded-xl border-border/70 p-0 shadow-xl"
                >
                  <Command
                    onKeyDown={(event) => {
                      // Let cmdk own typing and navigation, not the parent menu's typeahead.
                      if (event.key !== 'Escape') event.stopPropagation();
                    }}
                  >
                    <CommandInput ref={input} placeholder={t('panel.searchBases')} />
                    <CommandList className="max-h-80 scroll-py-1 p-1">
                      {failed || !branches ? (
                        <div className="px-3 py-4 text-xs text-muted-foreground">
                          {t(failed ? 'panel.branchError' : 'panel.loadingBranches')}
                        </div>
                      ) : (
                        <>
                          <CommandEmpty>{t('panel.noBases')}</CommandEmpty>
                          {ordered.map((b) => (
                            <CommandItem
                              key={b.name}
                              value={b.name}
                              title={`${b.name}\n${b.subject}`}
                              onSelect={() => select('branch', b.name)}
                              className="items-start gap-2 rounded-lg py-2"
                            >
                              {scope === 'branch' && b.name === branch ? (
                                <CheckIcon className="mt-0.5 size-3.5 text-info" />
                              ) : (
                                <GitBranchIcon className="mt-0.5 size-3.5" />
                              )}
                              <span className="min-w-0 flex-1">
                                <span className="block truncate">{b.name}</span>
                                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                  {b.author} · {b.short} · {ago(Date.parse(b.date), true)}
                                </span>
                              </span>
                            </CommandItem>
                          ))}
                        </>
                      )}
                    </CommandList>
                  </Command>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          )}
          {!sessionMode && (
            <DropdownMenuItem onSelect={() => select('lastCommit')}>
              {selected('lastCommit')}
              <span className="min-w-0 flex-1">{labels.lastCommit}</span>
              <DiffTotals files={files.lastCommit} />
            </DropdownMenuItem>
          )}
          <DropdownMenuItem title={t('panel.lastTurnTip')} onSelect={() => select('lastTurn')}>
            {selected('lastTurn')}
            <span className="min-w-0 flex-1">{labels.lastTurn}</span>
            <DiffTotals files={files.lastTurn} />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
