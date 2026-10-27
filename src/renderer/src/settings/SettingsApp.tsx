// Settings window. Every value comes from the main process (single source of
// truth), so the main window and this one can never disagree.
import { useEffect, useState, type ReactNode } from 'react';
import { BrainIcon, BriefcaseIcon, CodeIcon, DatabaseIcon, FolderIcon, InfoIcon, MonitorSmartphoneIcon, MoonIcon, PlusIcon, SettingsIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import type { AppInfo, Project, Settings, SettingsPayload, SuggestionModelMode, TerminalShell, WorkIdeasModelMode } from '@shared/protocol';
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
import { applyTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { allPets, PetSprite } from '@/components/composer/Clawd';
import { ModelPicker } from './ModelPicker';
import { ModelsSection } from './ModelsSection';
import { RemoteSection } from './RemoteSection';
import { StorageSection } from './StorageSection';

type Section = 'appearance' | 'general' | 'work' | 'code' | 'models' | 'projects' | 'remote' | 'storage' | 'about';
const SECTIONS: { id: Section; label: string; icon: ReactNode }[] = [
  { id: 'appearance', label: '外观', icon: <MoonIcon className="size-4" /> },
  { id: 'general', label: '通用', icon: <SettingsIcon className="size-4" /> },
  { id: 'work', label: 'Work', icon: <BriefcaseIcon className="size-4" /> },
  { id: 'code', label: 'Code', icon: <CodeIcon className="size-4" /> },
  { id: 'models', label: '模型管理', icon: <BrainIcon className="size-4" /> },
  { id: 'projects', label: '项目与文件夹', icon: <FolderIcon className="size-4" /> },
  { id: 'remote', label: '远程', icon: <MonitorSmartphoneIcon className="size-4" /> },
  { id: 'storage', label: '对象存储', icon: <DatabaseIcon className="size-4" /> },
  { id: 'about', label: '关于', icon: <InfoIcon className="size-4" /> },
];
// `keys` was the old section id: keep old links working.
const normalizeSection = (s: string): Section => (s === 'keys' ? 'models' : (s as Section));
const isSection = (s: string): s is Section => SECTIONS.some((x) => x.id === s || (x.id === 'models' && s === 'keys'));
/** Select value standing for `terminalShell: null`. */
const SYSTEM_SHELL = 'system';
const revealLabel = isMac ? '在 Finder 中显示' : '在资源管理器中显示';
const SUGGESTION_MODES: { id: SuggestionModelMode; label: string; hint: string }[] = [
  { id: 'session', label: '跟随会话', hint: '用会话当前的模型（默认），更好但可能更贵' },
  { id: 'auto', label: '自动', hint: '同 provider 里单价最低的小模型' },
  { id: 'fixed', label: '指定', hint: '固定使用下面选择的模型' },
];

const WORK_IDEAS_MODES: { id: WorkIdeasModelMode; label: string; hint: string }[] = [
  { id: 'session', label: '跟随会话', hint: '用最近一个 Work 会话的模型（默认）' },
  { id: 'auto', label: '自动', hint: '同 provider 里单价最低的小模型' },
  { id: 'fixed', label: '指定', hint: '固定使用下面选择的模型' },
];

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

const THEMES: readonly Swatch<'light' | 'dark' | 'system'>[] = [
  { id: 'light', label: '浅色', tile: 'bg-[#faf9f5]' },
  { id: 'dark', label: '深色', tile: 'bg-[#262624]' },
  { id: 'system', label: '跟随系统', tile: 'bg-gradient-to-r from-[#faf9f5] from-50% to-[#262624] to-50%' },
];

/** Number input that commits on blur or Enter, so a half-typed count is never saved. */
function CountInput({ value, disabled, onCommit }: { value: number; disabled?: boolean; onCommit: (value: number) => void }) {
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
      aria-label="预测上下文条数"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      className="h-8 w-16 text-center"
    />
  );
}

/** The template shown when adding a pet: the first built-in one, so a new skin starts from a working example. */
const PET_TEMPLATE = JSON.stringify({ ...BUILTIN_PETS[0], id: 'my-pet', label: '我的宠物' }, null, 2);

/** Paste a pet definition (same format as the built-in pets) and save it as a new skin. */
function AddPet({ onSave }: { onSave: (pet: unknown) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(PET_TEMPLATE);
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
  if (!open) return <Button variant="outline" size="sm" onClick={() => setOpen(true)}><PlusIcon className="size-4" />新增宠物</Button>;
  return (
    <div className="w-full space-y-2">
      <p className="text-xs text-muted-foreground">
        和内置宠物同样的格式：一组彩色矩形（x、y、w、h），带 <code>leg a</code> / <code>arm l</code> / <code>eyes</code> / <code>mouth</code> / <code>tail</code> 等部位名的矩形会自动有对应动作。也可以在 Work 里直接对 AI 说「帮我做一只小狐狸宠物」。
      </p>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} className="h-56 font-mono text-xs" />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void save()}>保存</Button>
        <Button variant="ghost" size="sm" onClick={() => { setOpen(false); setError(''); }}>取消</Button>
        <Button variant="ghost" size="sm" onClick={() => copy(PET_TEMPLATE)}>复制模板</Button>
      </div>
    </div>
  );
}

export function SettingsApp() {
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

  const theme = settings.theme === 'light' || settings.theme === 'dark' ? settings.theme : 'system';
  let body: ReactNode;
  if (section === 'appearance') {
    body = (
      <>
        <Heading title="外观" sub="Pi Desktop 在这台电脑上的显示方式。" />
        <Panel>
          <Row title="主题" hint="跟随系统时会随 macOS / Windows 的外观自动切换。" col>
            <SwatchGroup value={theme} onChange={(id) => void patch({ theme: id })} options={THEMES} />
          </Row>
          <Row title="侧边栏" hint="启动时收起左侧导航。">
            <Switch checked={!!settings.sidebarCollapsed} onCheckedChange={(v) => void patch({ sidebarCollapsed: v })} />
          </Row>
          <Row title="桌面宠物" hint="输入框上方走来走去、会随 agent 状态变化的像素小宠物。">
            <Switch checked={settings.pet !== false} onCheckedChange={(v) => void patch({ pet: v })} />
          </Row>
          {settings.pet !== false && (
            <Row title="宠物皮肤" col>
              <SwatchGroup
                value={settings.petSkin ?? DEFAULT_PET_ID}
                onChange={(id) => void patch({ petSkin: id })}
                options={allPets(settings.pets).map((p) => ({ id: p.id, label: p.label, tile: 'bg-muted/50', preview: <PetSprite pet={p} size={1.1} /> }))}
              />
              <div className="mt-3 flex flex-wrap items-start gap-2">
                <AddPet onSave={savePet} />
                {(settings.pets ?? []).filter((p) => !BUILTIN_PET_IDS.includes(p.id)).map((p) => (
                  <Button key={p.id} variant="ghost" size="sm" onClick={() => void removePet(p.id)} title={`删除 ${p.label}`}>
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
        <Heading title="通用" sub="通知、默认视图、AI 工具、回复渲染与输入预测。" />
        <div className="space-y-6">
          <Group title="基础">
            <Row title="任务通知" hint="任务跑完且窗口不在最前面时，发送系统通知。">
              <Switch checked={settings.notify !== false} onCheckedChange={(v) => void patch({ notify: v })} />
            </Row>
            <Row title="默认分区" hint="第一次启动时打开的视图；之后会记住你最后切换到的分区。">
              <Segmented
                value={settings.defaultMode ?? 'code'}
                options={[{ id: 'code', label: 'Code' }, { id: 'work', label: 'Work' }]}
                onChange={(m) => void patch({ defaultMode: m })}
              />
            </Row>
          </Group>

          <Group title="AI 工具" sub="让 AI 在对话里替你操作这些页面，比如“每天早上 9 点跑一遍测试”。关闭后新开的会话里不再提供对应工具，已打开的会话不受影响。">
            <Row title="定时任务" hint="创建、修改、运行「定时任务」页里的任务。">
              <Switch checked={settings.aiSchedule !== false} onCheckedChange={(v) => void patch({ aiSchedule: v })} />
            </Row>
            <Row title="自定义" hint="添加或移除技能、连接器（MCP）和插件。连接器与插件会在本机执行代码。">
              <Switch checked={settings.aiCustomize !== false} onCheckedChange={(v) => void patch({ aiCustomize: v })} />
            </Row>
            <Row title="应用设置" hint="修改主题、宠物、通知、输入预测等设置。API 密钥、终端、文件夹和这几个开关本身不开放给 AI。">
              <Switch checked={settings.aiSettings !== false} onCheckedChange={(v) => void patch({ aiSettings: v })} />
            </Row>
          </Group>

          <Group title="回复渲染">
            <Row title="渲染 Mermaid 图表" hint="回复里的 mermaid 代码块默认画成图表（可缩放、可在新窗口查看）。关闭后显示为普通代码，单个图表仍可手动渲染。">
              <Switch checked={settings.renderMermaid !== false} onCheckedChange={(v) => void patch({ renderMermaid: v })} />
            </Row>
          </Group>

          <Group title="输入预测" sub="每轮任务结束后用一个模型猜你下一句想说什么，以灰色文字显示在空输入框里。按 → 或 Tab 采用，Esc 忽略。">
            <Row title="启用输入预测">
              <Switch checked={settings.suggestions !== false} onCheckedChange={(v) => void patch({ suggestions: v })} />
            </Row>
            {settings.suggestions !== false && (
              <>
                <Row title="预测模型" hint="自动 = 同 provider 里最便宜的小模型；指定的模型不可用时回退到自动。离线 Demo 模型不参与预测。">
                  <Segmented value={settings.suggestionModel ?? 'session'} options={SUGGESTION_MODES} onChange={(m) => void patch({ suggestionModel: m })} />
                </Row>
                {(settings.suggestionModel ?? 'session') === 'fixed' && (
                  <Row title="指定模型" hint="只列出当前可用（已配置凭据）的模型。">
                    <ModelPicker value={settings.suggestionModelId ?? null} onChange={(id) => void patch({ suggestionModelId: id })} emptyLabel="未指定（回退到自动）" label="预测使用的模型" className="w-64 shrink-0" />
                  </Row>
                )}
                <Row title="上下文范围" hint="发给预测模型的 user / assistant 消息（不含工具输出）。全部对话会按预测模型的上下文窗口截断。">
                  <div className="flex shrink-0 items-center gap-2">
                    {!settings.suggestionFullContext && (
                      <>
                        <CountInput value={settings.suggestionContext ?? SUGGESTION_DEFAULT_CONTEXT} onCommit={(n) => void patch({ suggestionContext: n })} />
                        <span className="text-sm text-muted-foreground">条</span>
                      </>
                    )}
                    <Segmented
                      value={settings.suggestionFullContext ? 'all' : 'recent'}
                      options={[{ id: 'recent', label: '最近' }, { id: 'all', label: '全部对话' }]}
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
        <Heading title="Work" sub="只在 Work 分区生效的设置。" />
        <div className="space-y-6">
          <Group title="Work 首页建议" sub="Work 首页的「Ideas for you」根据最近的 Work 会话标题生成；结果会缓存，会话有变化才重新生成。关闭后首页不再显示这一块。">
            <Row title="根据最近的会话推荐">
              <Switch checked={settings.workIdeas !== false} onCheckedChange={(v) => void patch({ workIdeas: v })} />
            </Row>
            {settings.workIdeas !== false && (
              <>
                <Row title="使用的模型" hint="跟随会话 = 最近一个 Work 会话用的模型；自动 = 同 provider 里最便宜的小模型；模型不可用时回退到自动。离线 Demo 模型不参与。">
                  <Segmented value={settings.workIdeasModel ?? 'session'} options={WORK_IDEAS_MODES} onChange={(m) => void patch({ workIdeasModel: m })} />
                </Row>
                {(settings.workIdeasModel ?? 'session') === 'fixed' && (
                  <Row title="指定模型" hint="只列出当前可用（已配置凭据）的模型。">
                    <ModelPicker value={settings.workIdeasModelId ?? null} onChange={(id) => void patch({ workIdeasModelId: id })} emptyLabel="未指定（回退到自动）" label="生成建议使用的模型" className="w-64 shrink-0" />
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
        <Heading title="Code" sub="只在 Code 分区生效的设置。" />
        <div className="space-y-6">
          <Group title="终端">
            <Row title="默认终端" hint="终端面板新建标签页时启动的 shell。已打开的终端不受影响。">
              <Select value={settings.terminalShell ?? SYSTEM_SHELL} onValueChange={(v) => void patch({ terminalShell: v === SYSTEM_SHELL ? null : v })}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>
                  <SelectItem value={SYSTEM_SHELL}>系统默认</SelectItem>
                  {shells.map((sh) => <SelectItem key={sh.file} value={sh.file}>{sh.label}</SelectItem>)}
                  {settings.terminalShell && !shells.some((sh) => sh.file === settings.terminalShell) && (
                    <SelectItem value={settings.terminalShell}>{settings.terminalShell}（未找到）</SelectItem>
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
            <Button size="sm" variant="outline" onClick={() => call('app:revealPath', p.path).catch((e) => toast.error(errText(e)))}>{revealLabel}</Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={async () => {
                await (kind === 'project' ? call('projects:remove', p.path) : call('work:removeFolder', p.path));
                await reloadLists();
              }}
            >
              移除
            </Button>
          </div>
        )) : <div className="px-4 py-3 text-sm text-muted-foreground">还没有添加。</div>}
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
        <Heading title="项目与文件夹" sub="Code 会话的项目、worktree 位置，以及 Work 可用的工作文件夹。" />
        <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Worktree 位置</h3></div>
        <Panel>
          <Row
            title="Code 会话的 worktree 根目录"
            hint={<span className="break-all font-mono">{worktreePath}{settings.worktreeDir ? '' : '（默认）'}</span>}
          >
            <Button size="sm" variant="outline" onClick={() => void pickWorktree()}>修改…</Button>
            {settings.worktreeDir && (
              <Button size="sm" variant="ghost" onClick={() => void patch({ worktreeDir: null })}>恢复默认</Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={!worktreePath}
              onClick={() => worktreePath && call('app:revealPath', worktreePath).catch((e) => toast.error(errText(e)))}
            >
              打开
            </Button>
          </Row>
        </Panel>
        <div className="mt-6 mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Code 项目</h3><Button size="sm" variant="outline" onClick={() => void add('project')}>添加…</Button></div>
        {list(projects, 'project')}
        <div className="mt-6 mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Work 文件夹</h3><Button size="sm" variant="outline" onClick={() => void add('folder')}>添加…</Button></div>
        {list(folders, 'folder')}
      </>
    );
  } else {
    const v = info?.versions ?? {};
    const ver = [info?.version && `v${info.version}`, v.electron && `Electron ${v.electron}`, v.chrome && `Chromium ${v.chrome}`, v.node && `Node ${v.node}`].filter(Boolean).join(' · ');
    body = (
      <>
        <Heading title="关于" sub="基于 pi coding agent SDK 的桌面客户端。" />
        <Panel>
          <Row title={`Pi Desktop${info?.demo ? '（演示模式）' : ''}`} hint={ver} />
          <Row title="数据目录" hint={<span className="break-all font-mono">{info?.dataDir}</span>}>
            <Button size="sm" variant="outline" onClick={() => info && call('app:revealPath', info.dataDir).catch((e) => toast.error(errText(e)))}>打开</Button>
            <Button size="sm" variant="outline" onClick={() => copy(info?.dataDir ?? '')}>{copied ? '已复制' : '复制路径'}</Button>
          </Row>
          <Row title="Pi Desktop 扩展目录" hint={<span className="break-all font-mono">{info?.extensionsDir}</span>}>
            <Button size="sm" variant="outline" onClick={() => info && call('app:revealPath', info.extensionsDir).catch((e) => toast.error(errText(e)))}>打开</Button>
            <Button size="sm" variant="outline" onClick={() => copy(info?.extensionsDir ?? '')}>{copied ? '已复制' : '复制路径'}</Button>
          </Row>
          <Row title="pi 配置目录" hint={<span className="break-all font-mono">{info?.agentDir}</span>}>
            <Button size="sm" variant="outline" onClick={() => info && call('app:revealPath', info.agentDir).catch((e) => toast.error(errText(e)))}>打开</Button>
            <Button size="sm" variant="outline" onClick={() => copy(info?.agentDir ?? '')}>{copied ? '已复制' : '复制路径'}</Button>
          </Row>
        </Panel>
      </>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background" data-platform={bridge.platform}>
      <header className="app-drag titlebar-inset flex h-12 shrink-0 items-center justify-center border-b text-sm font-medium">Settings</header>
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
                {s.label}
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
