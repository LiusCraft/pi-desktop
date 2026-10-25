import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command';
import { call, modKey } from '@/lib/api';
import { ago, fname } from '@/lib/format';
import { addProject, openSession, setView, showWelcome, togglePanel } from '@/store/actions';
import { currentSession, getApp, setApp, useApp } from '@/store/app';

/** ⌘K: jump to a session or run an action. */
export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen);
  const sessions = useApp((s) => s.sessions);
  const setOpen = (o: boolean) => setApp((s) => void (s.paletteOpen = o));
  const run = (fn: () => unknown) => {
    setOpen(false);
    fn();
  };
  const list = Object.values(sessions).filter((s) => !s.meta.archived).sort((a, b) => (b.meta.updatedAt || 0) - (a.meta.updatedAt || 0)).slice(0, 40);
  const actions: { label: string; hint?: string; run: () => unknown }[] = [
    { label: 'New session', hint: 'Code', run: () => { setView('code'); showWelcome(); } },
    { label: 'New task', hint: 'Cowork', run: () => { setView('cowork'); showWelcome(); } },
    { label: 'Open folder…', run: () => void addProject() },
    { label: 'Toggle diff', hint: `${modKey}D`, run: () => { const s = currentSession(); if (s) togglePanel(s.meta.id, 'diff'); } },
    { label: 'Toggle terminal', run: () => { const s = currentSession(); if (s) togglePanel(s.meta.id, 'terminal'); } },
    { label: '模型管理…', run: () => call('settings:open', 'models') },
    { label: 'Toggle theme', run: () => call('settings:set', { theme: getApp().settings.resolvedTheme === 'dark' ? 'light' : 'dark' }) },
    { label: 'Settings…', hint: `${modKey},`, run: () => call('settings:open') },
  ];
  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Search sessions, tasks and actions">
      <CommandInput placeholder="Search sessions, tasks and actions…" />
      <CommandList>
        <CommandEmpty>No results</CommandEmpty>
        {list.length > 0 && (
          <CommandGroup heading="Sessions">
            {list.map((s) => (
              <CommandItem key={s.meta.id} value={`${s.meta.title} ${s.meta.id}`} onSelect={() => run(() => void openSession(s.meta.id))}>
                <span className="truncate">{s.meta.title}</span>
                <CommandShortcut>{s.meta.kind === 'cowork' ? 'Cowork' : fname(s.meta.projectPath)} · {ago(s.meta.updatedAt || Date.now())}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Actions">
          {actions.map((a) => (
            <CommandItem key={a.label} value={a.label} onSelect={() => run(a.run)}>
              {a.label}
              {a.hint && <CommandShortcut>{a.hint}</CommandShortcut>}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
