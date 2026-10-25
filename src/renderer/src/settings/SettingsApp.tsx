// Settings window. Every value comes from the main process (single source of
// truth), so the main window and this one can never disagree.
import { useEffect, useState, type ReactNode } from 'react';
import { BrainIcon, FolderIcon, InfoIcon, MoonIcon, SettingsIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { AppInfo, Project, Settings, SettingsPayload } from '@shared/protocol';
import { useCopy } from '@/components/common/Copy';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Toaster } from 'sonner';
import { bridge, call, errText, isMac } from '@/lib/api';
import { applyTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { PET_SKINS, PetSprite } from '@/components/composer/Clawd';
import { ModelsSection } from './ModelsSection';

type Section = 'appearance' | 'general' | 'models' | 'projects' | 'about';
const SECTIONS: { id: Section; label: string; icon: ReactNode }[] = [
  { id: 'appearance', label: '外观', icon: <MoonIcon className="size-4" /> },
  { id: 'general', label: '通用', icon: <SettingsIcon className="size-4" /> },
  { id: 'models', label: '模型管理', icon: <BrainIcon className="size-4" /> },
  { id: 'projects', label: '项目与文件夹', icon: <FolderIcon className="size-4" /> },
  { id: 'about', label: '关于', icon: <InfoIcon className="size-4" /> },
];
// `keys` was the old section id: keep old links working.
const normalizeSection = (s: string): Section => (s === 'keys' ? 'models' : (s as Section));
const isSection = (s: string): s is Section => SECTIONS.some((x) => x.id === s || (x.id === 'models' && s === 'keys'));
const revealLabel = isMac ? '在 Finder 中显示' : '在资源管理器中显示';

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
const Heading = ({ title, sub }: { title: string; sub: string }) => (
  <div className="mb-5">
    <h2 className="text-xl font-semibold">{title}</h2>
    <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
  </div>
);

function ThemeOption({ id, label, current, onPick }: { id: 'light' | 'dark' | 'system'; label: string; current: string; onPick: () => void }) {
  const swatch = { light: 'bg-[#faf9f5]', dark: 'bg-[#262624]', system: 'bg-gradient-to-r from-[#faf9f5] from-50% to-[#262624] to-50%' }[id];
  return (
    <button onClick={onPick} aria-pressed={id === current} className="flex flex-col items-center gap-2">
      <span className={cn('h-16 w-24 rounded-lg border-2', swatch, id === current ? 'border-primary' : 'border-border')} />
      <span className={cn('text-xs', id === current ? 'font-medium' : 'text-muted-foreground')}>{label}</span>
    </button>
  );
}

export function SettingsApp() {
  const [settings, setSettings] = useState<Partial<SettingsPayload>>(bridge.boot.settings ?? {});
  const [section, setSection] = useState<Section>(() => (isSection(location.hash.slice(1)) ? normalizeSection(location.hash.slice(1)) : 'appearance'));
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [folders, setFolders] = useState<Project[]>([]);
  const { copied, copy } = useCopy();

  useEffect(() => {
    const offChanged = bridge.on('settings:changed', (s) => {
      setSettings(s);
      applyTheme(s);
    });
    const offSection = bridge.on('settings:section', (s) => isSection(s) && setSection(normalizeSection(s)));
    void Promise.all([call('settings:get'), call('app:info'), call('projects:list'), call('cowork:folders')]).then(([s, i, p, f]) => {
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
  const reloadLists = async () => {
    setProjects(await call('projects:list'));
    setFolders(await call('cowork:folders'));
  };

  const theme = settings.theme === 'light' || settings.theme === 'dark' ? settings.theme : 'system';
  let body: ReactNode;
  if (section === 'appearance') {
    body = (
      <>
        <Heading title="外观" sub="Pi Desktop 在这台电脑上的显示方式。" />
        <Panel>
          <Row title="主题" hint="跟随系统时会随 macOS / Windows 的外观自动切换。" col>
            <div className="flex gap-4">
              <ThemeOption id="light" label="浅色" current={theme} onPick={() => void patch({ theme: 'light' })} />
              <ThemeOption id="dark" label="深色" current={theme} onPick={() => void patch({ theme: 'dark' })} />
              <ThemeOption id="system" label="跟随系统" current={theme} onPick={() => void patch({ theme: 'system' })} />
            </div>
          </Row>
          <Row title="侧边栏" hint="启动时收起左侧导航。">
            <Switch checked={!!settings.sidebarCollapsed} onCheckedChange={(v) => void patch({ sidebarCollapsed: v })} />
          </Row>
          <Row title="桌面宠物" hint="输入框上方走来走去、会随 agent 状态变化的像素小宠物。">
            <Switch checked={settings.pet !== false} onCheckedChange={(v) => void patch({ pet: v })} />
          </Row>
          {settings.pet !== false && (
            <Row title="宠物皮肤" col>
              <div className="flex gap-4">
                {PET_SKINS.map((p) => {
                  const on = (settings.petSkin ?? 'clawd') === p.id;
                  return (
                    <button key={p.id} onClick={() => void patch({ petSkin: p.id })} aria-pressed={on} className="flex flex-col items-center gap-2">
                      <span className={cn('flex h-16 w-24 items-center justify-center rounded-lg border-2 bg-muted/50', on ? 'border-primary' : 'border-border')}>
                        <PetSprite skin={p.id} size={1.1} />
                      </span>
                      <span className={cn('text-xs', on ? 'font-medium' : 'text-muted-foreground')}>{p.label}</span>
                    </button>
                  );
                })}
              </div>
            </Row>
          )}
        </Panel>
      </>
    );
  } else if (section === 'general') {
    body = (
      <>
        <Heading title="通用" sub="通知与默认视图。" />
        <Panel>
          <Row title="任务通知" hint="任务跑完且窗口不在最前面时，发送系统通知。">
            <Switch checked={settings.notify !== false} onCheckedChange={(v) => void patch({ notify: v })} />
          </Row>
          <Row title="默认分区" hint="第一次启动时打开的视图；之后会记住你最后切换到的分区。">
            <div className="flex rounded-lg bg-muted p-0.5 text-sm">
              {(['code', 'cowork'] as const).map((m) => (
                <button key={m} onClick={() => void patch({ defaultMode: m })} className={cn('rounded-md px-3 py-1', (settings.defaultMode ?? 'code') === m ? 'bg-background shadow-sm' : 'text-muted-foreground')}>
                  {m === 'code' ? 'Code' : 'Cowork'}
                </button>
              ))}
            </div>
          </Row>
        </Panel>
      </>
    );
  } else if (section === 'models') {
    body = <ModelsSection />;
  } else if (section === 'projects') {
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
                await (kind === 'project' ? call('projects:remove', p.path) : call('cowork:removeFolder', p.path));
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
      await (kind === 'project' ? call('projects:add') : call('cowork:addFolder')).catch((e) => toast.error(errText(e)));
      await reloadLists();
    };
    body = (
      <>
        <Heading title="项目与文件夹" sub="Code 会话的项目，以及 Cowork 可用的工作文件夹。" />
        <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Code 项目</h3><Button size="sm" variant="outline" onClick={() => void add('project')}>添加…</Button></div>
        {list(projects, 'project')}
        <div className="mt-6 mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Cowork 文件夹</h3><Button size="sm" variant="outline" onClick={() => void add('folder')}>添加…</Button></div>
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
          <Row title="数据目录" hint={<span className="font-mono">{info?.userData}</span>}>
            <Button size="sm" variant="outline" onClick={() => info && call('app:revealPath', info.userData).catch((e) => toast.error(errText(e)))}>打开</Button>
            <Button size="sm" variant="outline" onClick={() => copy(info?.userData ?? '')}>{copied ? '已复制' : '复制路径'}</Button>
          </Row>
          <Row title="pi 配置目录" hint={<span className="font-mono">{info?.agentDir}</span>}>
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
      <div className="flex min-h-0 flex-1">
        <nav className="w-52 shrink-0 space-y-0.5 border-r bg-sidebar p-3">
          {SECTIONS.map((s) => (
            <button key={s.id} onClick={() => setSection(s.id)} className={cn('flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm', section === s.id ? 'bg-sidebar-accent font-medium' : 'text-sidebar-foreground hover:bg-sidebar-accent/60')}>
              <span className="text-muted-foreground">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </nav>
        <main className="min-w-0 flex-1 overflow-y-auto p-8">
          <div className="mx-auto max-w-3xl">{body}</div>
        </main>
      </div>
      <Toaster position="bottom-right" theme={settings.resolvedTheme ?? 'light'} />
    </div>
  );
}
