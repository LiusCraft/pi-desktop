import { useMemo, useState } from 'react';
import { BriefcaseIcon, CodeIcon, GitMergeIcon, TriangleAlertIcon } from 'lucide-react';
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';
import { ago, fname } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { openSession } from '@/store/actions';
import { setApp, useApp } from '@/store/app';
import { SESSION_GROUPS, sessionGroup, switcherSessions } from '@/store/session-switcher';

export function SessionSwitcher() {
  const t = useT();
  const open = useApp((s) => s.sessionsOpen);
  const setOpen = (o: boolean) => setApp((s) => void (s.sessionsOpen = o));
  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t('shortcuts.sessions')}
      description={t('switcher.description')}
      shouldFilter={false}
    >
      {open && (
        <SessionResults
          onSelect={(id) => {
            setOpen(false);
            void openSession(id);
          }}
        />
      )}
    </CommandDialog>
  );
}

function SessionResults({ onSelect }: { onSelect: (id: string) => void }) {
  const t = useT();
  const sessions = useApp((s) => s.sessions);
  const [query, setQuery] = useState('');
  const list = useMemo(() => switcherSessions(sessions, query), [sessions, query]);
  return (
    <>
      <CommandInput value={query} onValueChange={setQuery} placeholder={t('switcher.search')} />
      <CommandList className="max-h-[min(60vh,32rem)]">
        {list.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{t('switcher.empty')}</p>}
        {SESSION_GROUPS.map((group) => {
          const entries = list.filter((s) => sessionGroup(s) === group);
          if (!entries.length) return null;
          return (
            <CommandGroup key={group} heading={t(`switcher.${group}`)}>
              {entries.map(({ meta }) => {
                const Icon = meta.kind === 'work' ? BriefcaseIcon : CodeIcon;
                return (
                  <CommandItem key={meta.id} value={meta.id} onSelect={() => onSelect(meta.id)}>
                    <Icon />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{meta.title}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {meta.kind === 'work' ? 'Work' : 'Code'}
                        {meta.projectPath ? ` · ${fname(meta.projectPath)}` : ''}
                      </div>
                    </div>
                    {group === 'attention' && <TriangleAlertIcon className="text-warning" />}
                    {group === 'merged' && <GitMergeIcon />}
                    {meta.lastResponseAt && (
                      <CommandShortcut className="shrink-0 tracking-normal">{ago(meta.lastResponseAt)}</CommandShortcut>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          );
        })}
      </CommandList>
    </>
  );
}
