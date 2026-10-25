// Settings window. Every value comes from the main process (single source of
// truth), so the main window and this one can never disagree.
import { useEffect, useState, type ReactNode } from 'react';
import { FolderIcon, InfoIcon, KeyRoundIcon, MoonIcon, SettingsIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { AppInfo, KeyStatus, Project, Settings, SettingsPayload } from '@shared/protocol';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Toaster } from 'sonner';
import { bridge, call, errText, isMac } from '@/lib/api';
import { applyTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

type Section = 'appearance' | 'general' | 'keys' | 'projects' | 'about';
const SECTIONS: { id: Section; label: string; icon: ReactNode }[] = [
  { id: 'appearance', label: '外观', icon: <MoonIcon className="size-4" /> },
  { id: 'general', label: '通用', icon: <SettingsIcon className="size-4" /> },
  { id: 'keys', label: 'API 密钥', icon: <KeyRoundIcon className="size-4" /> },
  { id: 'projects', label: '项目与文件夹', icon: <FolderIcon className="size-4" /> },
  { id: 'about', label: '关于', icon: <InfoIcon className="size-4" /> },
];
const isSection = (s: string): s is Section => SECTIONS.some((x) => x.id === s);
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
  const [section, setSection] = useState<Section>(() => (isSection(location.hash.slice(1)) ? (location.hash.slice(1) as Section) : 'appearance'));
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [keys, setKeys] = useState<Record<string, KeyStatus>>({});
  const [projects, setProjects] = useState<Project[]>([]);
  const [folders, setFolders] = useState<Project[]>([]);

  useEffect(() => {
    const offChanged = bridge.on('settings:changed', (s) => {
      setSettings(s);
      applyTheme(s);
    });
    const offSection = bridge.on('settings:section', (s) => isSection(s) && setSection(s));
    void Promise.all([call('settings:get'), call('app:info'), call('keys:status'), call('projects:list'), call('cowork:folders')]).then(([s, i, k, p, f]) => {
      setSettings(s);
      applyTheme(s);
      setInfo(i);
      setKeys(k);
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
    } catch {}
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
  } else if (section === 'keys') {
    body = <KeysSection keys={keys} secure={!!settings.secureKeys} onChange={setKeys} />;
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
                toast('已从列表移除，磁盘上的文件不受影响');
              }}
            >
              移除
            </Button>
          </div>
        )) : <div className="px-4 py-3 text-sm text-muted-foreground">还没有添加。</div>}
      </Panel>
    );
    const add = async (kind: 'project' | 'folder') => {
      const added = await (kind === 'project' ? call('projects:add') : call('cowork:addFolder')).catch((e) => void toast.error(errText(e)));
      await reloadLists();
      if (added) toast(`已添加 ${added.name}`);
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
            <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(info?.userData ?? '').then(() => toast('已复制'))}>复制路径</Button>
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
          <div className="mx-auto max-w-2xl">{body}</div>
        </main>
      </div>
      <Toaster position="bottom-center" theme={settings.resolvedTheme ?? 'light'} />
    </div>
  );
}

function KeysSection({ keys, secure, onChange }: { keys: Record<string, KeyStatus>; secure: boolean; onChange: (k: Record<string, KeyStatus>) => void }) {
  const providers = Object.keys(keys);
  const [provider, setProvider] = useState('anthropic');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async (p = provider, v = value.trim()) => {
    setSaving(true);
    try {
      await call('keys:set', p, v);
      onChange(await call('keys:status'));
      setValue('');
      toast(v ? '已保存，新会话会使用这个密钥' : '已删除');
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <Heading title="API 密钥" sub="只保存在这台电脑上，只在 agent 进程里使用。" />
      <p className="mb-4 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        {secure ? '系统加密存储可用，密钥会加密后写入磁盘。' : '当前系统没有可用的加密存储，密钥以明文保存在应用数据目录。'}
        也可以改用环境变量或 <code>~/.pi/agent/auth.json</code>；这里保存的密钥优先。
      </p>
      <Panel>
        <div className="flex gap-2 p-4">
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>{providers.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
          </Select>
          <Input type="password" autoComplete="off" spellCheck={false} placeholder="粘贴 API key，留空保存则删除" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
          <Button disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : '保存'}</Button>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr><th className="px-4 py-2 font-medium">Provider</th><th className="px-4 py-2 font-medium">环境变量</th><th className="px-4 py-2 font-medium">状态</th><th /></tr>
          </thead>
          <tbody className="divide-y">
            {providers.map((p) => {
              const k = keys[p];
              return (
                <tr key={p}>
                  <td className="px-4 py-2 font-medium">{p}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{k.env}</td>
                  <td className="px-4 py-2">{k.saved ? <Badge>已保存</Badge> : k.envSet ? <Badge variant="secondary">环境变量已设置</Badge> : <Badge variant="outline">未设置</Badge>}</td>
                  <td className="px-4 py-2 text-right">{k.saved && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void save(p, '')}>删除</Button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
