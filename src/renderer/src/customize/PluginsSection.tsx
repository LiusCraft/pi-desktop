// Customize → Plugins: pi packages (npm, git or local folders) listed in settings.json. A
// package can bring skills, prompt templates, extensions and MCP servers in one install.
import { useState } from 'react';
import { DownloadIcon, PackageIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import type { CustomizeCatalog, PluginInfo } from '@shared/protocol';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { call, errText } from '@/lib/api';
import { fname } from '@/lib/format';
import { dialogs } from '@/store/dialogs';
import { Empty, Heading, Panel, Segmented } from './ui';

interface Props {
  catalog: CustomizeCatalog;
  project: string | null;
  onCatalog: (c: CustomizeCatalog) => void;
}

export function PluginsSection({ catalog, project, onCatalog }: Props) {
  const [source, setSource] = useState('');
  const [scope, setScope] = useState<'user' | 'project'>('user');
  /** What is running: installing/updating can take a while, so the whole page says so. */
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (label: string, fn: () => Promise<CustomizeCatalog>, done?: string) => {
    setBusy(label);
    try {
      onCatalog(await fn());
      if (done) toast.success(done);
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(null);
    }
  };
  const install = () =>
    run('安装中…', () => call('customize:pluginInstall', source, scope, project), '已安装，新建的会话会加载它').then(() => setSource(''));
  const remove = async (p: PluginInfo) => {
    if (!(await dialogs.confirm(`移除 ${p.source}？`, '会从配置里去掉这个插件，它带来的技能、命令和工具在新会话里不再可用。', '移除', true))) return;
    await run('移除中…', () => call('customize:pluginRemove', p.source, p.scope, project), '已移除');
  };

  return (
    <>
      <Heading
        title="Plugins"
        sub="pi 包：一次安装就能带来技能、提示模板、扩展和 MCP 服务器。来源可以是 npm、git 或本地文件夹。"
        action={
          <Button size="sm" variant="outline" className="shrink-0" disabled={!!busy || !catalog.plugins.length} onClick={() => void run('更新中…', () => call('customize:pluginUpdate', null, project), '已更新全部插件')}>
            <RefreshCwIcon className={`size-4 ${busy === '更新中…' ? 'animate-spin' : ''}`} />全部更新
          </Button>
        }
      />
      <div className="mb-5 rounded-xl border bg-card p-4">
        <div className="mb-2 text-sm font-medium">安装插件</div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="min-w-64 flex-1"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && source.trim() && !busy && !e.nativeEvent.isComposing) void install(); }}
            placeholder="npm:pi-web-access   git:github.com/user/repo   F:\path\to\package"
            spellCheck={false}
            disabled={!!busy}
          />
          <Segmented value={scope} onChange={setScope} options={[{ id: 'user', label: '个人' }, { id: 'project', label: '项目', disabled: !project }]} />
          <Button disabled={!source.trim() || !!busy} onClick={() => void install()}>
            {busy === '安装中…' ? <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <DownloadIcon className="size-4" />}安装
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {busy ? `${busy} 首次安装要下载依赖，可能要一会儿。` : scope === 'project' && project ? `只对 ${fname(project)} 生效，写入项目的 .pi/settings.json。` : '对所有项目生效，写入 pi 的 settings.json。'}
        </p>
      </div>
      <Panel>
        {catalog.plugins.map((p) => (
          <div key={`${p.scope}:${p.source}`} className="flex items-center gap-3 px-4 py-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40"><PackageIcon className="size-4 text-muted-foreground" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate font-mono text-sm font-medium">{p.source}</span>
                <Badge variant="secondary">{p.scope === 'user' ? '个人' : '项目'}</Badge>
                {p.filtered && <Badge variant="secondary" title="设置里限制了它加载哪些资源">已过滤</Badge>}
                {!p.installedPath && <Badge variant="secondary" className="text-warning" title="还没有安装到本机，新会话启动时会尝试安装">未安装</Badge>}
              </div>
              {p.installedPath && <div className="mt-0.5 truncate text-xs text-muted-foreground" title={p.installedPath}>{p.installedPath}</div>}
            </div>
            <Button size="icon" variant="ghost" className="size-8" title="更新" disabled={!!busy} onClick={() => void run('更新中…', () => call('customize:pluginUpdate', p.source, project), `已更新 ${p.source}`)}><RefreshCwIcon className="size-4" /></Button>
            <Button size="icon" variant="ghost" className="size-8 text-destructive" title="移除" disabled={!!busy} onClick={() => void remove(p)}><Trash2Icon className="size-4" /></Button>
          </div>
        ))}
        {!catalog.plugins.length && <Empty>还没有安装插件。上面输入一个包名就能装，比如 npm:pi-web-access。</Empty>}
      </Panel>
    </>
  );
}
