// Settings window. Every value comes from the main process (single source of
// truth), so the main window and this one can never disagree.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BrainIcon, ChevronRightIcon, BriefcaseIcon, CodeIcon, DatabaseIcon, FolderIcon, InfoIcon, MonitorSmartphoneIcon, MoonIcon, PlusIcon, SettingsIcon, Trash2Icon } from 'lucide-react';
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
import { TooltipProvider } from '@/components/ui/tooltip';
import { Tip } from '@/components/common/Tip';
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
import { WebSearchSection } from './WebSearchSection';
import { Group, Heading, Panel, Row, groupDomId } from './ui';

type Section = 'appearance' | 'general' | 'work' | 'code' | 'models' | 'projects' | 'remote' | 'storage' | 'about';
/** A group inside a section: a leaf of the sidebar tree that scrolls to the group's DOM id (`group-<id>`). */
interface GroupNode {
  id: string;
  label: MessageKey;
}
const SECTIONS: { id: Section; label: MessageKey | null; icon: ReactNode; groups?: GroupNode[] }[] = [
  { id: 'appearance', label: 'settings.section.appearance', icon: <MoonIcon className="size-4" /> },
  {
    id: 'general',
    label: 'settings.section.general',
    icon: <SettingsIcon className="size-4" />,
    groups: [
      { id: 'basics', label: 'settings.basics' },
      { id: 'aiTools', label: 'settings.aiTools' },
      { id: 'replyRendering', label: 'settings.replyRendering' },
      { id: 'prediction', label: 'settings.prediction' },
      { id: 'webSearch', label: 'web.title' },
    ],
  },
  { id: 'work', label: null, icon: <BriefcaseIcon className="size-4" /> },
  { id: 'code', label: null, icon: <CodeIcon className="size-4" /> },
  { id: 'models', label: 'settings.section.models', icon: <BrainIcon className="size-4" /> },
  {
    id: 'projects',
    label: 'settings.section.projects',
    icon: <FolderIcon className="size-4" />,
    groups: [
      { id: 'worktree', label: 'settings.worktreeLocation' },
      { id: 'codeProjects', label: 'settings.codeProjects' },
      { id: 'workFolders', label: 'settings.workFolders' },
    ],
  },
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
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">{t('settings.petFormat')}<Tip>{t('settings.petFormat.tip')}</Tip></p>
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
  /** Sections whose group list the user folded away; the rest show their groups. */
  const [folded, setFolded] = useState<ReadonlySet<Section>>(new Set());
  /** A group to scroll to once its section has rendered; a fresh object each click so the same group can be hit twice. */
  const [jump, setJump] = useState<{ group: string } | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  /** The group nearest the top of the content, so the tree can show where you are. */
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
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

  useEffect(() => {
    if (jump) document.getElementById(groupDomId(jump.group))?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [jump]);
  const syncActiveGroup = () => {
    const main = mainRef.current;
    const groups = SECTIONS.find((x) => x.id === section)?.groups;
    if (!main || !groups) return setActiveGroup(null);
    const line = main.getBoundingClientRect().top + 48;
    let current = groups[0].id;
    for (const g of groups) {
      const el = document.getElementById(groupDomId(g.id));
      if (el && el.getBoundingClientRect().top <= line) current = g.id;
    }
    // At the very bottom the last group may be too short to reach the line.
    if (main.scrollTop + main.clientHeight >= main.scrollHeight - 2) current = groups[groups.length - 1].id;
    setActiveGroup(current);
  };
  useEffect(syncActiveGroup); // content height changes with settings, so re-check every render (setting the same value is a no-op)
  const openSection = (id: Section) => {
    setSection(id);
    mainRef.current?.scrollTo({ top: 0 });
  };
  const toggleFold = (id: Section) => setFolded((prev) => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });

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
          <Row title={t('settings.language')} tip={t('settings.language.tip')}>
            <Select value={settings.language ?? 'system'} onValueChange={(v) => void patch({ language: v as LanguageSetting })}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="system">{t('settings.language.system')}</SelectItem>
                {LOCALES.map((l) => <SelectItem key={l} value={l}>{LOCALE_NAMES[l]}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </Row>
          <Row title={t('settings.theme')} col>
            <SwatchGroup value={theme} onChange={(id) => void patch({ theme: id })} options={THEMES.map((o) => ({ ...o, label: t(o.label) }))} />
          </Row>
          <Row title={t('settings.sidebar')}>
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
        <div>
          <Group id="basics" title={t('settings.basics')}>
            <Panel>
              <Row title={t('settings.notify')} hint={t('settings.notify.hint')}>
                <Switch checked={settings.notify !== false} onCheckedChange={(v) => void patch({ notify: v })} />
              </Row>
              <Row title={t('settings.defaultMode')} tip={t('settings.defaultMode.tip')}>
                <Segmented
                  value={settings.defaultMode ?? 'code'}
                  options={[{ id: 'code', label: 'Code' }, { id: 'work', label: 'Work' }]}
                  onChange={(m) => void patch({ defaultMode: m })}
                />
              </Row>
            </Panel>
          </Group>

          <Group id="aiTools" title={t('settings.aiTools')} sub={t('settings.aiTools.sub')} tip={t('settings.aiTools.tip')}>
            <Panel>
              <Row title={t('settings.aiSchedule')} hint={t('settings.aiSchedule.hint')}>
                <Switch checked={settings.aiSchedule !== false} onCheckedChange={(v) => void patch({ aiSchedule: v })} />
              </Row>
              <Row title={t('settings.aiCustomize')} hint={t('settings.aiCustomize.hint')} tip={t('settings.aiCustomize.tip')}>
                <Switch checked={settings.aiCustomize !== false} onCheckedChange={(v) => void patch({ aiCustomize: v })} />
              </Row>
              <Row title={t('settings.aiSettings')} hint={t('settings.aiSettings.hint')} tip={t('settings.aiSettings.tip')}>
                <Switch checked={settings.aiSettings !== false} onCheckedChange={(v) => void patch({ aiSettings: v })} />
              </Row>
              <Row title={t('settings.aiProject')} hint={t('settings.aiProject.hint')} tip={t('settings.aiProject.tip')}>
                <Switch checked={settings.aiProject !== false} onCheckedChange={(v) => void patch({ aiProject: v })} />
              </Row>
            </Panel>
          </Group>

          <Group id="replyRendering" title={t('settings.replyRendering')}>
            <Panel>
              <Row title={t('settings.mermaid')} hint={t('settings.mermaid.hint')} tip={t('settings.mermaid.tip')}>
                <Switch checked={settings.renderMermaid !== false} onCheckedChange={(v) => void patch({ renderMermaid: v })} />
              </Row>
            </Panel>
          </Group>

          <Group id="prediction" title={t('settings.prediction')} sub={t('settings.prediction.sub')} tip={t('settings.prediction.tip')}>
            <Panel>
              <Row title={t('settings.prediction.enable')}>
                <Switch checked={settings.suggestions !== false} onCheckedChange={(v) => void patch({ suggestions: v })} />
              </Row>
              {settings.suggestions !== false && (
                <>
                  <Row title={t('settings.prediction.model')} tip={t('settings.prediction.model.tip')}>
                    <Segmented value={settings.suggestionModel ?? 'session'} options={modeOptions} onChange={(m) => void patch({ suggestionModel: m })} />
                  </Row>
                  {(settings.suggestionModel ?? 'session') === 'fixed' && (
                    <Row title={t('settings.fixedModelRow')} tip={t('settings.fixedModelRow.tip')}>
                      <ModelPicker value={settings.suggestionModelId ?? null} onChange={(id) => void patch({ suggestionModelId: id })} emptyLabel={unspecified} label={t('settings.prediction.pickerLabel')} className="w-64 shrink-0" />
                    </Row>
                  )}
                  <Row title={t('settings.prediction.context')} tip={t('settings.prediction.context.tip')}>
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
            </Panel>
          </Group>

          <div id={groupDomId('webSearch')} className="scroll-mt-2"><WebSearchSection /></div>
        </div>
      </>
    );
  } else if (section === 'work') {
    body = (
      <>
        <Heading title="Work" sub={t('settings.work.sub')} />
        <div>
          <Group id="ideas" title={t('settings.work.ideas')} sub={t('settings.work.ideas.sub')} tip={t('settings.work.ideas.tip')}>
            <Panel>
              <Row title={t('settings.work.recommend')}>
                <Switch checked={settings.workIdeas !== false} onCheckedChange={(v) => void patch({ workIdeas: v })} />
              </Row>
              {settings.workIdeas !== false && (
                <>
                  <Row title={t('settings.work.model')} tip={t('settings.work.model.tip')}>
                    <Segmented value={settings.workIdeasModel ?? 'session'} options={modeOptions} onChange={(m) => void patch({ workIdeasModel: m })} />
                  </Row>
                  {(settings.workIdeasModel ?? 'session') === 'fixed' && (
                    <Row title={t('settings.fixedModelRow')} tip={t('settings.fixedModelRow.tip')}>
                      <ModelPicker value={settings.workIdeasModelId ?? null} onChange={(id) => void patch({ workIdeasModelId: id })} emptyLabel={unspecified} label={t('settings.work.pickerLabel')} className="w-64 shrink-0" />
                    </Row>
                  )}
                </>
              )}
            </Panel>
          </Group>
        </div>
      </>
    );
  } else if (section === 'code') {
    body = (
      <>
        <Heading title="Code" sub={t('settings.code.sub')} />
        <div>
          <Group id="terminal" title={t('settings.terminal')}>
            <Panel>
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
            </Panel>
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
        <div id={groupDomId('worktree')} className="scroll-mt-2">
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
        </div>
        <div id={groupDomId('codeProjects')} className="scroll-mt-2">
        <div className="mt-6 mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">{t('settings.codeProjects')}</h3><Button size="sm" variant="outline" onClick={() => void add('project')}>{t('settings.add')}</Button></div>
        {list(projects, 'project')}
        </div>
        <div id={groupDomId('workFolders')} className="scroll-mt-2">
        <div className="mt-6 mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">{t('settings.workFolders')}</h3><Button size="sm" variant="outline" onClick={() => void add('folder')}>{t('settings.add')}</Button></div>
        {list(folders, 'folder')}
        </div>
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
    <TooltipProvider delayDuration={300}>
    <div className="flex h-screen flex-col bg-background" data-platform={bridge.platform}>
      <header className="app-drag titlebar-inset flex h-12 shrink-0 items-center justify-center border-b text-sm font-medium">{t('settings.title')}</header>
      <div className="flex min-h-0 flex-1">
        <nav className="w-56 shrink-0 overflow-y-auto border-r bg-sidebar p-3">
          <ul className="flex flex-col gap-0.5">
            {SECTIONS.map((s) => {
              const active = section === s.id;
              const open = !!s.groups && !folded.has(s.id);
              return (
                <li key={s.id}>
                  <div
                    className={cn(
                      'flex h-8 items-center rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent/60',
                      active && 'bg-sidebar-accent font-medium',
                    )}
                  >
                    <button
                      type="button"
                      tabIndex={s.groups ? 0 : -1}
                      disabled={!s.groups}
                      onClick={() => toggleFold(s.id)}
                      className="flex size-6 shrink-0 cursor-pointer items-center justify-center text-muted-foreground disabled:invisible"
                    >
                      <ChevronRightIcon className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
                    </button>
                    <button type="button" onClick={() => openSection(s.id)} className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2.5 pr-2.5 text-left">
                      <span className="text-muted-foreground">{s.icon}</span>
                      <span className="truncate">{s.label ? t(s.label) : s.id === 'work' ? 'Work' : 'Code'}</span>
                    </button>
                  </div>
                  {open && (
                    <ul className="mt-0.5 ml-[22px] flex flex-col gap-0.5 border-l pl-2">
                      {s.groups!.map((g) => (
                        <li key={g.id}>
                          <button
                            type="button"
                            onClick={() => {
                              if (!active) setSection(s.id);
                              setJump({ group: g.id });
                            }}
                            className={cn(
                              'h-7 w-full cursor-pointer truncate rounded-lg px-2 text-left text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground',
                              active && activeGroup === g.id && 'bg-sidebar-accent/60 font-medium text-sidebar-foreground',
                            )}
                          >
                            {t(g.label)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
        <main ref={mainRef} onScroll={syncActiveGroup} className="min-w-0 flex-1 overflow-y-auto p-8">
          <div key={section} className="mx-auto max-w-3xl animate-in duration-200 fade-in-0 slide-in-from-bottom-1">{body}</div>
        </main>
      </div>
      <Toaster position="bottom-right" theme={settings.resolvedTheme ?? 'light'} />
    </div>
    </TooltipProvider>
  );
}
