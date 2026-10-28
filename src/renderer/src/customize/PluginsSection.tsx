// Customize → Plugins: pi packages (npm, git or local folders) listed in settings.json. A
// package can bring skills, prompt templates, extensions and MCP servers in one install.
import { useEffect, useState } from 'react';
import { ChevronRightIcon, DownloadIcon, PackageIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { PLUGIN_RESOURCE_KINDS } from '@shared/protocol';
import type { CustomizeCatalog, PluginInfo, PluginResource } from '@shared/protocol';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { call, errText } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { fname } from '@/lib/format';
import { dialogs } from '@/store/dialogs';
import { Empty, Heading, Panel, Segmented } from './ui';

/** Packages worth suggesting; offered until a configured plugin matches. */
const RECOMMENDED = [{ source: 'npm:pi-lens', descKey: 'plugins.lensDesc' }] as const;

interface Props {
  catalog: CustomizeCatalog;
  project: string | null;
  onCatalog: (c: CustomizeCatalog) => void;
}

/** The files a package brings, each with its own switch (written as filters on the settings entry). */
function PluginItems({ plugin, project, onCatalog }: { plugin: PluginInfo; project: string | null; onCatalog: (c: CustomizeCatalog) => void }) {
  const t = useT();
  const [items, setItems] = useState<PluginResource[] | null>(null);
  const load = () => call('customize:pluginResources', plugin.source, plugin.scope, project).then(setItems, (err) => toast.error(errText(err)));
  useEffect(() => { void load(); }, [plugin.source, plugin.scope]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = async (r: PluginResource, on: boolean) => {
    setItems((cur) => cur && cur.map((x) => (x.path === r.path ? { ...x, enabled: on } : x)));
    try {
      onCatalog(await call('customize:pluginSetResource', plugin.source, plugin.scope, r, on, project));
    } catch (err) {
      toast.error(errText(err));
    }
    void load();
  };
  if (!items) return <div className="px-4 pb-3 pl-15 text-xs text-muted-foreground">…</div>;
  if (!items.length) return <div className="px-4 pb-3 pl-15 text-xs text-muted-foreground">{t('plugins.itemsEmpty')}</div>;
  return (
    <div className="space-y-2 px-4 pb-3 pl-15">
      {PLUGIN_RESOURCE_KINDS.map((kind) => {
        const rows = items.filter((r) => r.kind === kind);
        if (!rows.length) return null;
        return (
          <div key={kind}>
            <div className="mb-1 text-xs font-medium text-muted-foreground">{t(`plugins.kind.${kind}`)}</div>
            {rows.map((r) => (
              <div key={r.path} className="flex items-center gap-2 py-0.5">
                <span className="min-w-0 flex-1 truncate font-mono text-xs" title={r.path}>{r.name}</span>
                <Switch checked={r.enabled} onCheckedChange={(on) => void toggle(r, on)} aria-label={r.name} />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function PluginsSection({ catalog, project, onCatalog }: Props) {
  const t = useT();
  const [source, setSource] = useState('');
  const [scope, setScope] = useState<'user' | 'project'>('user');
  /** What is running: installing/updating can take a while, so the whole page says so. */
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<'installing' | 'updating' | 'removing' | null>(null);

  const run = async (label: 'installing' | 'updating' | 'removing', fn: () => Promise<CustomizeCatalog>, done?: string) => {
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
    run('installing', () => call('customize:pluginInstall', source, scope, project), t('plugins.installed')).then(() => setSource(''));
  const remove = async (p: PluginInfo) => {
    if (!(await dialogs.confirm(t('plugins.removeTitle', { source: p.source }), t('plugins.removeBody'), t('plugins.remove'), true))) return;
    await run('removing', () => call('customize:pluginRemove', p.source, p.scope, project), t('plugins.removed'));
  };

  return (
    <>
      <Heading
        title={t('plugins.title')}
        sub={t('plugins.sub')}
        tip={t('plugins.tip')}
        action={
          <Button size="sm" variant="outline" className="shrink-0" disabled={!!busy || !catalog.plugins.length} onClick={() => void run('updating', () => call('customize:pluginUpdate', null, project), t('plugins.updatedAll'))}>
            <RefreshCwIcon className={`size-4 ${busy === 'updating' ? 'animate-spin' : ''}`} />{t('plugins.updateAll')}
          </Button>
        }
      />
      <div className="mb-5 rounded-xl border bg-card p-4">
        <div className="mb-2 text-sm font-medium">{t('plugins.install')}</div>
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
          <Segmented value={scope} onChange={setScope} options={[{ id: 'user', label: t('plugins.personal') }, { id: 'project', label: t('plugins.projectOpt'), disabled: !project }]} />
          <Button disabled={!source.trim() || !!busy} onClick={() => void install()}>
            {busy === 'installing' ? <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <DownloadIcon className="size-4" />}{t('plugins.installBtn')}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {busy ? t('plugins.firstInstall', { busy: t(`plugins.${busy}`) }) : scope === 'project' && project ? t('plugins.projectScope', { name: fname(project) }) : t('plugins.userScope')}
        </p>
      </div>
      {RECOMMENDED.filter((r) => !catalog.plugins.some((p) => p.source.replace(/@[^@/]*$/, '') === r.source)).map((r) => (
        <div key={r.source} className="mb-5 flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40"><PackageIcon className="size-4 text-muted-foreground" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5"><span className="font-mono text-sm font-medium">{r.source}</span><Badge variant="secondary">{t('plugins.recommended')}</Badge></div>
            <div className="mt-0.5 text-xs text-muted-foreground">{t(r.descKey)}</div>
          </div>
          <Button size="sm" disabled={!!busy} onClick={() => void run('installing', () => call('customize:pluginInstall', r.source, 'user', project), t('plugins.installed'))}>
            <DownloadIcon className="size-4" />{t('plugins.installBtn')}
          </Button>
        </div>
      ))}
      <Panel>
        {catalog.plugins.map((p) => (
          <div key={`${p.scope}:${p.source}`}>
          <div className="flex items-center gap-3 px-4 py-3">
            <Button size="icon" variant="ghost" className="size-6 shrink-0" title={t('plugins.items')} disabled={!p.installedPath} onClick={() => setOpen(open === `${p.scope}:${p.source}` ? null : `${p.scope}:${p.source}`)}>
              <ChevronRightIcon className={`size-4 transition-transform ${open === `${p.scope}:${p.source}` ? 'rotate-90' : ''}`} />
            </Button>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40"><PackageIcon className="size-4 text-muted-foreground" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate font-mono text-sm font-medium">{p.source}</span>
                <Badge variant="secondary">{t(p.scope === 'user' ? 'plugins.personal' : 'plugins.projectOpt')}</Badge>
                {p.filtered && <Badge variant="secondary" title={t('plugins.filteredHint')}>{t('plugins.filtered')}</Badge>}
                {!p.installedPath && <Badge variant="secondary" className="text-warning" title={t('plugins.notInstalledHint')}>{t('plugins.notInstalled')}</Badge>}
              </div>
              {p.installedPath && <div className="mt-0.5 truncate text-xs text-muted-foreground" title={p.installedPath}>{p.installedPath}</div>}
            </div>
            <Button size="icon" variant="ghost" className="size-8" title={t('plugins.update')} disabled={!!busy} onClick={() => void run('updating', () => call('customize:pluginUpdate', p.source, project), t('plugins.updated', { source: p.source }))}><RefreshCwIcon className="size-4" /></Button>
            <Button size="icon" variant="ghost" className="size-8 text-destructive" title={t('plugins.remove')} disabled={!!busy} onClick={() => void remove(p)}><Trash2Icon className="size-4" /></Button>
          </div>
          {open === `${p.scope}:${p.source}` && <PluginItems plugin={p} project={project} onCatalog={onCatalog} />}
          </div>
        ))}
        {!catalog.plugins.length && <Empty>{t('plugins.empty')}</Empty>}
      </Panel>
    </>
  );
}
