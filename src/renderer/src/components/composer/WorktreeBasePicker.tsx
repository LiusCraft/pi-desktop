import { useState } from 'react';
import { ChevronDownIcon, GitBranchIcon } from 'lucide-react';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { setApp, useApp } from '@/store/app';

export function WorktreeBasePicker({ branch }: { branch: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const branches = useApp((st) => st.projectBranches);
  const base = useApp((st) => st.baseRef) ?? branch;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex h-full items-center gap-1.5 rounded-l-lg pr-2 pl-2.5 hover:bg-accent data-[state=open]:bg-accent"
          title={t('composer.worktreeBase', { ref: base })}
        >
          <GitBranchIcon className="size-4 shrink-0" />
          <span className="max-w-32 truncate">{base}</span>
          <ChevronDownIcon className="size-3 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-64 overflow-hidden rounded-xl p-0">
        <Command
          label={t('composer.worktreeBaseLabel')}
          className="max-h-[min(20rem,var(--radix-popover-content-available-height))]"
        >
          <div className="px-3 pt-2.5 text-xs font-medium text-muted-foreground">{t('composer.worktreeBaseLabel')}</div>
          <CommandInput placeholder={t('panel.searchBases')} />
          <CommandList className="p-1">
            <CommandEmpty>{t('panel.noBases')}</CommandEmpty>
            {[branch, ...branches.filter((b) => b !== branch)].map((name) => (
              <CommandItem
                key={name}
                value={name}
                title={name}
                onSelect={() => {
                  setApp((st) => void (st.baseRef = name));
                  setOpen(false);
                }}
                className={cn('rounded-lg px-2.5 py-2 text-[13px]', name === base && 'font-medium')}
              >
                <GitBranchIcon className="size-3.5" />
                <span className="truncate">{name}</span>
                {name === branch && (
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{t('composer.current')}</span>
                )}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
