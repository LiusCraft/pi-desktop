// Settings window. Every value comes from the main process (single source of
// truth), so the main window and this one can never disagree.
import { useEffect, useState, type ReactNode } from 'react';
import { BrainIcon, BriefcaseIcon, CodeIcon, DatabaseIcon, FolderIcon, InfoIcon, MonitorSmartphoneIcon, MoonIcon, PlusIcon, SettingsIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import type { AppInfo, Project, Settings, SettingsPayload, SuggestionModelMode, TerminalShell, WorkIdeasModelMode } from '@shared/protocol';
import { LOCALES, LOCALE_NAMES, type LanguageSetting, type MessageKey } from '@shared/i18n';
import { SUGGESTION_DEFAULT_CONTEXT, SUGGESTION_MAX_CONTEXT } from '@shared/protocol';
import { BUILTIN_PETS, BUILTIN_PET_IDS, DEFAULT_PET_ID } from '@shared/pets';
import { useCopy } from '@/components/common/Copy';
import { Segmented } from '@/components/common/Segmented';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Toaster } from 'sonner';
import { bridge, call, errText, isMac } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { applyTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { allPets, PetSprite } from '@/components/composer/Clawd';
import { ModelPicker } from './ModelPicker';
import { ModelsSection } from './ModelsSection';
import { RemoteSection } from './RemoteSection';
import { StorageSection } from './StorageSection';

type Section = 'appearance' | 'general' | 'work' | 'code' | 'models' | 'projects' | 'remote' | 'storage' | 'about';
const SECTIONS: { id: Section; label: MessageKey | null; icon: ReactNode }[] = [
  { id: 'appearance', label: 'settings.section.appearance', icon: <MoonIcon className="size-4" /> },
  { id: 'general', label: 'settings.section.general', icon: <SettingsIcon className="size-4" /> },
  { id: 'work', label: null, icon: <BriefcaseIcon className="size-4" /> },
  { id: 'code', label: null, icon: <CodeIcon className="size-4" /> },
  { id: 'models', label: 'settings.section.models', icon: <BrainIcon className="size-4" /> },
  { id: 'projects', label: 'settings.section.projects', icon: <FolderIcon className="size-4" /> },
  { id: 'remote', label: 'settings.section.remote', icon: <MonitorSmartphoneIcon className="size-4" /> },
  { id: 'storage', label: 'settings.section.storage', icon: <DatabaseIcon className="size-4" /> },
  { id: 'about', label: 'settings.section.about', icon: <InfoIcon className="size-4" /> },
];
// `keys` was the old section id: keep old links working.
const normalizeSection = (s: string): Section => (s === 'keys' ? 'models' : (s as Section));
const isSection = (s: string): s is Section => SECTIONS.some((x) => x.id === s || (x.id === 'models' && s === 'keys'));
/** Select value standing for `terminalShell: null`. */
const SYSTEM_SHELL = 'system';
const revealKey = isMac ? 'settings.showInFinder' : 'settings.showInExplorer';
/** Built-in pets are named in the app's language; the user's own keep the label they gave. */
const PET_LABEL_KEY: Record<string, MessageKey> = { cat: 'pet.cat', robot: 'pet.robot' };
const MODEL_MODE_LABELS = [
  { id: 'session', label: 'settings.followSession' },
  { id: 'auto', label: 'settings.auto' },
  { id: 'fixed', label: 'settings.fixed' },
] as const satisfies readonly { id: SuggestionModelMode & WorkIdeasModelMode; label: MessageKey }[];

function Row({ title, hint, children, col }: { title: ReactNode; hint?: ReactNode; children?: ReactNode; col?: boolean }) {
  return (
    <div className={cn('flex gap-4 px-4 py-3.5', col ? 'flex-col' : 'items-center')}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  );
}
const Panel = ({ children }: { children: ReactNode }) => <div className="divide-y rounded-xl border bg-card">{children}</div>;
/** A titled settings group: a small heading (and optional note) above its own panel. */
function Group({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="px-1 text-sm font-semibold">{title}</h3>
      {sub && <p className="mt-0.5 px-1 text-xs text-muted-foreground">{sub}</p>}
      <div className="mt-2">
        <Panel>{children}</Panel>
      </div>
    </section>
  );
}

const Heading = ({ title, sub }: { title: string; sub: string }) => (
  <div className="mb-5">
    <h2 className="text-xl font-semibold">{title}</h2>
    <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
  </div>
);

interface Swatch<T extends string> {
  id: T;
  label: string;
  /** Classes for the preview tile. */
  tile?: string;
  preview?: ReactNode;
}

/** Pick one of a few previews, each a labelled tile (theme, pet skin). */
function SwatchGroup<T extends string>({ value, onChange, options }: { value: T; onChange: (id: T) => void; options: readonly Swatch<T>[] }) {
  return (
    <ToggleGroup type="single" value={value} onValueChange={(id) => id && onChange(id as T)} spacing={1} className="gap-4">
      {options.map((o) => (
        <ToggleGroupItem key={o.id} value={o.id} className="group/swatch h-auto flex-col gap-2 p-0 font-normal focus-visible:border-transparent focus-visible:ring-0 hover:bg-transparent data-[state=on]:bg-transparent">
          <span className={cn('flex h-16 w-24 items-center justify-center rounded-lg border-2 border-border group-data-[state=on]/swatch:border-primary', o.tile)}>{o.preview}</span>
          <span className="text-xs text-muted-foreground group-data-[state=on]/swatch:font-medium group-data-[state=on]/swatch:text-foreground">{o.label}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

const THEMES: readonly { id: 'light' | 'dark' | 'system'; label: MessageKey; tile: string }[] = [
  { id: 'light', label: 'settings.themeLight', tile: 'bg-[#faf9f5]' },
  { id: 'dark', label: 'settings.themeDark', tile: 'bg-[#262624]' },
  { id: 'system', label: 'settings.themeSystem', tile: 'bg-gradient-to-r from-[#faf9f5] from-50% to-[#262624] to-50%' },
];

/** Number input that commits on blur or Enter, so a half-typed count is never saved. */
function CountInput({ value, disabled, onCommit }: { value: number; disabled?: boolean; onCommit: (value: number) => void }) {
  const t = useT();
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const next = Math.round(Number(text));
    if (!Number.isFinite(next) || next < 1) return setText(String(value));
    onCommit(Math.min(SUGGESTION_MAX_CONTEXT, next));
  };
  return (
    <Input
      type="number"
      min={1}
      max={SUGGESTION_MAX_CONTEXT}
      value={text}
      disabled={disabled}
      aria-label={t('settings.predictCountLabel')}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      className="h-8 w-16 text-center"
    />
  );
}

/** The template shown when adding a pet: the first built-in one, so a new skin starts from a working example. */
const petTemplate = (label: string) => JSON.stringify({ ...BUILTIN_PETS[0], id: 'my-pet', label }, null, 2);

/** Paste a pet definition (same format as the built-in pets) and save it as a new skin. */
function AddPet({ onSave }: { onSave: (pet: unknown) => Promise<void> }) {
  const t = useT();
  const template = petTemplate(t('settings.petName'));
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(template);
  const [error, setError] = useState('');
  const { copy } = useCopy();
  const save = async () => {
    try {
      await onSave(JSON.parse(text));
      setOpen(false);
      setError('');
    } catch (err) {
      setError(errText(err));
    }
  };
  if (!open) return <Button variant="outline" size="sm" onClick={() => setOpen(true)}><PlusIcon className="size-4" />{t('settings.addPet')}</Button>;
  return (
    <div className="w-full space-y-2">
      <p className="text-xs text-muted-foreground">{t('settings.petFormat')}</p>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} className="h-56 font-mono text-xs" />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void save()}>{t('settings.save')}</Button>
        <Button variant="ghost" size="sm" onClick={() => { setOpen(false); setError(''); }}>{t('settings.cancel')}</Button>
        <Button variant="ghost" size="sm" onClick={() => copy(template)}>{t('settings.copyTemplate')}</Button>
      </div>
    </div>
  );
}

export function SettingsApp() {
  const t = useT();
  const locale = useLocale();
  useEffect(() => { document.title = t('settings.title'); }, [locale]); // eslint-disable-line react-hooks/exhaustive-deps
  const [settings, setSettings] = useState<Partial<SettingsPayload>>(bridge.boot.settings ?? {});
  const [section, setSection] = useState<Section>(() => (isSection(location.hash.slice(1)) ? normalizeSection(location.hash.slice(1)) : 'appearance'));
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [shells, setShells] = useState<TerminalShell[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [folders, setFolders] = useState<Project[]>([]);
  const { copied, copy } = useCopy();

  useEffect(() => {
    call('terminal:shells').then(setShells).catch(() => {});
  }, []);
  useEffect(() => {
    const offChanged = bridge.on('settings:changed', (s) => {
      setSettings(s);
      applyTheme(s);
    });
    const offSection = bridge.on('settings:section', (s) => isSection(s) && setSection(normalizeSection(s)));
    void Promise.all([call('settings:get'), call('app:info'), call('projects:list'), call('work:folders')]).then(([s, i, p, f]) => {
      setSettings(s);
      applyTheme(s);
      setInfo(i);
      setProjects(p);
      setFolders(f);
    });
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && void call('settings:close');
    window.addEventListener('keydown', esc);
    return () => {
      offChanged();
      offSection();
      window.removeEventListener('keydown', esc);
    };
  }, []);
  useEffect(() => {
    try {
      history.replaceState(null, '', `#${section}`);
    } catch {
      // A file:// document rejects history rewrites; the section state is enough there.
    }
  }, [section]);

  const patch = async (values: Partial<Settings>) => {
    try {
      const next = await call('settings:set', values);
      setSettings(next);
      applyTheme(next);
    } catch (err) {
      toast.error(errText(err));
    }
  };
  const savePet = async (pet: unknown) => {
    setSettings(await call('pets:save', pet));
  };
  const removePet = async (id: string) => {
    try {
      setSettings(await call('pets:remove', id));
    } catch (err) {
      toast.error(errText(err));
    }
  };
  const reloadLists = async () => {
    setProjects(await call('projects:list'));
    setFolders(await call('work:folders'));
  };

  const modeOptions = MODEL_MODE_LABELS.map((o) => ({ id: o.id, label: t(o.label) }));
  const unspecified = t('settings.unspecified');
  const theme = settings.theme === 'light' || settings.theme === 'dark' ? settings.theme : 'system';
  let body: ReactNode;
  if (section === 'appearance') {
    body = (
      <>
        <Heading title={t('settings.section.appearance')} sub={t('settings.appearance.sub')} />
        <Panel>
          <Row title={t('settings.language')} hint={t('settings.language.hint')}>
            <Select value={settings.language ?? 'system'} onValueChange={(v) => void patch({ language: v as LanguageSetting })}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="system">{t('settings.language.system')}</SelectItem>
                {LOCALES.map((l) => <SelectItem key={l} value={l}>{LOCALE_NAMES[l]}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </Row>
          <Row title={t('settings.theme')} hint={t('settings.theme.hint')} col>
            <SwatchGroup value={theme} onChange={(id) => void patch({ theme: id })} options={THEMES.map((o) => ({ ...o, label: t(o.label) }))} />
          </Row>
          <Row title={t('settings.sidebar')} hint={t('settings.sidebar.hint')}>
            <Switch checked={!!settings.sidebarCollapsed} onCheckedChange={(v) => void patch({ sidebarCollapsed: v })} />
          </Row>
          <Row title={t('settings.pet')} hint={t('settings.pet.hint')}>
            <Switch checked={settings.pet !== false} onCheckedChange={(v) => void patch({ pet: v })} />
          </Row>
          {settings.pet !== false && (
            <Row title={t('settings.petSkin')} col>
              <SwatchGroup
                value={settings.petSkin ?? DEFAULT_PET_ID}
                onChange={(id) => void patch({ petSkin: id })}
                options={allPets(settings.pets).map((p) => ({ id: p.id, label: PET_LABEL_KEY[p.id] ? t(PET_LABEL_KEY[p.id]) : p.label, tile: 'bg-muted/50', preview: <PetSprite pet={p} size={1.1} /> }))}
              />
              <div className="mt-3 flex flex-wrap items-start gap-2">
                <AddPet onSave={savePet} />
                {(settings.pets ?? []).filter((p) => !BUILTIN_PET_IDS.includes(p.id)).map((p) => (
                  <Button key={p.id} variant="ghost" size="sm" onClick={() => void removePet(p.id)} title={t('settings.deletePet', { name: p.label })}>
                    <Trash2Icon className="size-3.5" />{p.label}
                  </Button>
                ))}
              </div>
            </Row>
          )}
        </Panel>
      </>
    );
  } else if (section === 'general') {
    body = (
      <>
        <Heading title={t('settings.section.general')} sub={t('settings.general.sub')} />
        <div className="space-y-6">
          <Group title={t('settings.basics')}>
            <Row title={t('settings.notify')} hint={t('settings.notify.hint')}>
              <Switch checked={settings.notify !== false} onCheckedChange={(v) => void patch({ notify: v })} />
            </Row>
            <Row title={t('settings.defaultMode')} hint={t('settings.defaultMode.hint')}>
              <Segmented
                value={settings.defaultMode ?? 'code'}
                options={[{ id: 'code', label: 'Code' }, { id: 'work', label: 'Work' }]}
                onChange={(m) => void patch({ defaultMode: m })}
              />
            </Row>
          </Group>

          <Group title={t('settings.aiTools')} sub={t('settings.aiTools.sub')}>
            <Row title={t('settings.aiSchedule')} hint={t('settings.aiSchedule.hint')}>
              <Switch checked={settings.aiSchedule !== false} onCheckedChange={(v) => void patch({ aiSchedule: v })} />
            </Row>
            <Row title={t('settings.aiCustomize')} hint={t('settings.aiCustomize.hint')}>
              <Switch checked={settings.aiCustomize !== false} onCheckedChange={(v) => void patch({ aiCustomize: v })} />
            </Row>
            <Row title={t('settings.aiSettings')} hint={t('settings.aiSettings.hint')}>
              <Switch checked={settings.aiSettings !== false} onCheckedChange={(v) => void patch({ aiSettings: v })} />
            </Row>
          </Group>

          <Group title={t('settings.replyRendering')}>
            <Row title={t('settings.mermaid')} hint={t('settings.mermaid.hint')}>
              <Switch checked={settings.renderMermaid !== false} onCheckedChange={(v) => void patch({ renderMermaid: v })} />
            </Row>
          </Group>

          <Group title={t('settings.prediction')} sub={t('settings.prediction.sub')}>
            <Row title={t('settings.prediction.enable')}>
              <Switch checked={settings.suggestions !== false} onCheckedChange={(v) => void patch({ suggestions: v })} />
            </Row>
            {settings.suggestions !== false && (
              <>
                <Row title={t('settings.prediction.model')} hint={t('settings.prediction.model.hint')}>
                  <Segmented value={settings.suggestionModel ?? 'session'} options={modeOptions} onChange={(m) => void patch({ suggestionModel: m })} />
                </Row>
                {(settings.suggestionModel ?? 'session') === 'fixed' && (
                  <Row title={t('settings.fixedModelRow')} hint={t('settings.fixedModelRow.hint')}>
                    <ModelPicker value={settings.suggestionModelId ?? null} onChange={(id) => void patch({ suggestionModelId: id })} emptyLabel={unspecified} label={t('settings.prediction.pickerLabel')} className="w-64 shrink-0" />
                  </Row>
                )}
                <Row title={t('settings.prediction.context')} hint={t('settings.prediction.context.hint')}>
                  <div className="flex shrink-0 items-center gap-2">
                    {!settings.suggestionFullContext && (
                      <>
                        <CountInput value={settings.suggestionContext ?? SUGGESTION_DEFAULT_CONTEXT} onCommit={(n) => void patch({ suggestionContext: n })} />
                        <span className="text-sm text-muted-foreground">{t('settings.messagesUnit')}</span>
                      </>
                    )}
                    <Segmented
                      value={settings.suggestionFullContext ? 'all' : 'recent'}
                      options={[{ id: 'recent', label: t('settings.recent') }, { id: 'all', label: t('settings.wholeConversation') }]}
                      onChange={(m) => void patch({ suggestionFullContext: m === 'all' })}
                    />
                  </div>
                </Row>
              </>
            )}
          </Group>
        </div>
      </>
    );
  } else if (section === 'work') {
    body = (
      <>
        <Heading title="Work" sub={t('settings.work.sub')} />
        <div className="space-y-6">
          <Group title={t('settings.work.ideas')} sub={t('settings.work.ideas.sub')}>
            <Row title={t('settings.work.recommend')}>
              <Switch checked={settings.workIdeas !== false} onCheckedChange={(v) => void patch({ workIdeas: v })} />
            </Row>
            {settings.workIdeas !== false && (
              <>
                <Row title={t('settings.work.model')} hint={t('settings.work.model.hint')}>
                  <Segmented value={settings.workIdeasModel ?? 'session'} options={modeOptions} onChange={(m) => void patch({ workIdeasModel: m })} />
                </Row>
                {(settings.workIdeasModel ?? 'session') === 'fixed' && (
                  <Row title={t('settings.fixedModelRow')} hint={t('settings.fixedModelRow.hint')}>
                    <ModelPicker value={settings.workIdeasModelId ?? null} onChange={(id) => void patch({ workIdeasModelId: id })} emptyLabel={unspecified} label={t('settings.work.pickerLabel')} className="w-64 shrink-0" />
                  </Row>
                )}
              </>
            )}
          </Group>
        </div>
      </>
    );
  } else if (section === 'code') {
    body = (
      <>
        <Heading title="Code" sub={t('settings.code.sub')} />
        <div className="space-y-6">
          <Group title={t('settings.terminal')}>
            <Row title={t('settings.terminal.default')} hint={t('settings.terminal.default.hint')}>
              <Select value={settings.terminalShell ?? SYSTEM_SHELL} onValueChange={(v) => void patch({ terminalShell: v === SYSTEM_SHELL ? null : v })}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>
                  <SelectItem value={SYSTEM_SHELL}>{t('settings.systemDefault')}</SelectItem>
                  {shells.map((sh) => <SelectItem key={sh.file} value={sh.file}>{sh.label}</SelectItem>)}
                  {settings.terminalShell && !shells.some((sh) => sh.file === settings.terminalShell) && (
                    <SelectItem value={settings.terminalShell}>{t('settings.notFound', { name: settings.terminalShell })}</SelectItem>
                  )}
                </SelectGroup></SelectContent>
              </Select>
            </Row>
          </Group>
        </div>
      </>
    );
  } else if (section === 'models') {
    body = <ModelsSection />;
  } else if (section === 'storage') {
    body = <StorageSection />;
  } else if (section === 'remote') {
    body = <RemoteSection />;
  } else if (section === 'projects') {
    const worktreePath = settings.worktreeDir || info?.defaultWorktreeDir || '';
    const pickWorktree = async () => {
      const dir = await call('app:pickFolder').catch((e) => {
        toast.error(errText(e));
        return null;
      });
      if (dir) await patch({ worktreeDir: dir });
    };
    const list = (items: Project[], kind: 'project' | 'folder') => (
      <Panel>
        {items.length ? items.map((p) => (
          <div key={p.path} className="flex items-center gap-2 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{p.name}</div>
              <div className="truncate font-mono text-xs text-muted-foreground" title={p.path}>{p.path}</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => call('app:revealPath', p.path).catch((e) => toast.error(errText(e)))}>{t(revealKey)}</Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={async () => {
                await (kind === 'project' ? call('projects:remove', p.path) : call('work:removeFolder', p.path));
                await reloadLists();
              }}
            >
              {t('settings.remove')}
            </Button>
          </div>
        )) : <div className="px-4 py-3 text-sm text-muted-foreground">{t('settings.nothingAdded')}</div>}
      </Panel>
    );
    const add = async (kind: 'project' | 'folder') => {
      try {
        const added = await (kind === 'project' ? call('projects:add') : call('work:addFolder'));
        // A worktree is asked about in the main window's flow; here it simply becomes a project of its own.
        if (added && 'kind' in added && added.kind === 'worktree') await call('projects:adoptWorktree', 'project');
      } catch (e) {
        toast.error(errText(e));
      }
      await reloadLists();
    };
    body = (
      <>
        <Heading title={t('settings.section.projects')} sub={t('settings.projects.sub')} />
        <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">{t('settings.worktreeLocation')}</h3></div>
        <Panel>
          <Row
            title={t('settings.worktreeRoot')}
            hint={<span className="break-all font-mono">{worktreePath}{settings.worktreeDir ? '' : t('settings.defaultSuffix')}</span>}
          >
            <Button size="sm" variant="outline" onClick={() => void pickWorktree()}>{t('settings.change')}</Button>
            {settings.worktreeDir && (
              <Button size="sm" variant="ghost" onClick={() => void patch({ worktreeDir: null })}>{t('settings.restoreDefault')}</Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={!worktreePath}
              onClick={() => worktreePath && call('app:revealPath', worktreePath).catch((e) => toast.error(errText(e)))}
            >
              {t('settings.open')}
            </Button>
          </Row>
        </Panel>
        <div className="mt-6 mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">{t('settings.codeProjects')}</h3><Button size="sm" variant="outline" onClick={() => void add('project')}>{t('settings.add')}</Button></div>
        {list(projects, 'project')}
        <div className="mt-6 mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">{t('settings.workFolders')}</h3><Button size="sm" variant="outline" onClick={() => void add('folder')}>{t('settings.add')}</Button></div>
        {list(folders, 'folder')}
      </>
    );
  } else {
    const v = info?.versions ?? {};
    const ver = [info?.version && `v${info.version}`, v.electron && `Electron ${v.electron}`, v.chrome && `Chromium ${v.chrome}`, v.node && `Node ${v.node}`].filter(Boolean).join(' · ');
    body = (
      <>
        <Heading title={t('settings.section.about')} sub={t('settings.about.sub')} />
        <Panel>
          <Row title={`Pi Desktop${info?.demo ? t('settings.about.demo') : ''}`} hint={ver} />
          <Row title={t('settings.about.dataDir')} hint={<span className="break-all font-mono">{info?.dataDir}</span>}>
            <Button size="sm" variant="outline" onClick={() => info && call('app:revealPath', info.dataDir).catch((e) => toast.error(errText(e)))}>{t('settings.open')}</Button>
            <Button size="sm" variant="outline" onClick={() => copy(info?.dataDir ?? '')}>{copied ? t('settings.copied') : t('settings.copyPath')}</Button>
          </Row>
          <Row title={t('settings.about.extensionsDir')} hint={<span className="break-all font-mono">{info?.extensionsDir}</span>}>
            <Button size="sm" variant="outline" onClick={() => info && call('app:revealPath', info.extensionsDir).catch((e) => toast.error(errText(e)))}>{t('settings.open')}</Button>
            <Button size="sm" variant="outline" onClick={() => copy(info?.extensionsDir ?? '')}>{copied ? t('settings.copied') : t('settings.copyPath')}</Button>
          </Row>
          <Row title={t('settings.about.agentDir')} hint={<span className="break-all font-mono">{info?.agentDir}</span>}>
            <Button size="sm" variant="outline" onClick={() => info && call('app:revealPath', info.agentDir).catch((e) => toast.error(errText(e)))}>{t('settings.open')}</Button>
            <Button size="sm" variant="outline" onClick={() => copy(info?.agentDir ?? '')}>{copied ? t('settings.copied') : t('settings.copyPath')}</Button>
          </Row>
        </Panel>
      </>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background" data-platform={bridge.platform}>
      <header className="app-drag titlebar-inset flex h-12 shrink-0 items-center justify-center border-b text-sm font-medium">{t('settings.title')}</header>
      <Tabs value={section} onValueChange={(v) => setSection(v as Section)} orientation="vertical" className="min-h-0 flex-1 flex-row gap-0">
        <nav className="w-52 shrink-0 border-r bg-sidebar p-3">
          <TabsList className="h-auto w-full flex-col items-stretch gap-0.5 bg-transparent p-0">
            {SECTIONS.map((s) => (
              <TabsTrigger
                key={s.id}
                value={s.id}
                className="h-8 flex-none justify-start gap-2.5 rounded-lg px-2.5 font-normal text-sidebar-foreground shadow-none hover:bg-sidebar-accent/60 data-[state=active]:bg-sidebar-accent data-[state=active]:font-medium data-[state=active]:shadow-none"
              >
                <span className="text-muted-foreground">{s.icon}</span>
                {s.label ? t(s.label) : s.id === 'work' ? 'Work' : 'Code'}
              </TabsTrigger>
            ))}
          </TabsList>
        </nav>
        <main className="min-w-0 flex-1 overflow-y-auto p-8">
          <div key={section} className="mx-auto max-w-3xl animate-in duration-200 fade-in-0 slide-in-from-bottom-1">{body}</div>
        </main>
      </Tabs>
      <Toaster position="bottom-right" theme={settings.resolvedTheme ?? 'light'} />
    </div>
  );
}
