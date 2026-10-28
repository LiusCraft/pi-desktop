import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command';
import { call, modKey } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { ago, fname } from '@/lib/format';
import { addProject, openSession, setView, showWelcome, togglePanel } from '@/store/actions';
import { currentSession, getApp, setApp, useApp } from '@/store/app';

/** ⌘K: jump to a session or run an action. */
export function CommandPalette() {
  const t = useT();
  const open = useApp((s) => s.paletteOpen);
  const sessions = useApp((s) => s.sessions);
  const setOpen = (o: boolean) => setApp((s) => void (s.paletteOpen = o));
  const run = (fn: () => unknown) => {
    setOpen(false);
    fn();
  };
  const list = Object.values(sessions).filter((s) => !s.meta.archived).sort((a, b) => (b.meta.updatedAt || 0) - (a.meta.updatedAt || 0)).slice(0, 40);
  // The diff and the terminal are Code panels: a Work session has no card to show for them.
  const codeSession = useApp((s) => (s.current ? s.sessions[s.current]?.meta.kind : undefined)) === 'code';
  const actions: { label: string; hint?: string; run: () => unknown }[] = [
    { label: t('palette.newSession'), hint: 'Code', run: () => { setView('code'); showWelcome(); } },
    { label: t('palette.newTask'), hint: 'Work', run: () => { setView('work'); showWelcome(); } },
    { label: t('palette.openFolder'), run: () => void addProject() },
    ...(codeSession ? [
      { label: t('palette.toggleDiff'), hint: `${modKey}D`, run: () => { const s = currentSession(); if (s) togglePanel(s.meta.id, 'diff'); } },
      { label: t('palette.toggleTerminal'), run: () => { const s = currentSession(); if (s) togglePanel(s.meta.id, 'terminal'); } },
    ] : []),
    { label: t('palette.models'), run: () => call('settings:open', 'models') },
    { label: t('palette.toggleTheme'), run: () => call('settings:set', { theme: getApp().settings.resolvedTheme === 'dark' ? 'light' : 'dark' }) },
    { label: t('palette.settings'), hint: `${modKey},`, run: () => call('settings:open') },
  ];
  return (
    <CommandDialog open={open} onOpenChange={setOpen} title={t('palette.title')} description={t('palette.description')}>
      <CommandInput placeholder={t('palette.placeholder')} />
      <CommandList>
        <CommandEmpty>{t('palette.empty')}</CommandEmpty>
        {list.length > 0 && (
          <CommandGroup heading={t('palette.sessions')}>
            {list.map((s) => (
              <CommandItem key={s.meta.id} value={`${s.meta.title} ${s.meta.id}`} onSelect={() => run(() => void openSession(s.meta.id))}>
                <span className="truncate">{s.meta.title}</span>
                <CommandShortcut>{s.meta.kind === 'work' ? 'Work' : fname(s.meta.projectPath)} · {ago(s.meta.updatedAt || Date.now())}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading={t('palette.actions')}>
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
