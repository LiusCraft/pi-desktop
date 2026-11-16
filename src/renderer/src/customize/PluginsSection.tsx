// Customize → Plugins: pi packages (npm, git or local folders) listed in settings.json. A
// package can bring skills, prompt templates, extensions and MCP servers in one install, and —
// when it declares `piDesktop` — desktop capabilities the app itself shows (see docs/plugins.md).
import { useEffect, useState } from 'react';
import { ChevronRightIcon, DownloadIcon, PackageIcon, RefreshCwIcon, SparklesIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { PLUGIN_RESOURCE_KINDS } from '@shared/protocol';
import type {
  CustomizeCatalog,
  DesktopPluginInfo,
  PluginInfo,
  PluginPermission,
  PluginResource,
} from '@shared/protocol';
import type { MessageKey, MessageParams } from '@shared/i18n';
import { Tip } from '@/components/common/Tip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { call, errText } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { fname } from '@/lib/format';
import { dialogs } from '@/store/dialogs';
import { showWelcome, welcomeDraftKey } from '@/store/actions';
import { drafts } from '@/store/drafts';
import { subscribeResource } from '@/store/resources';
import { Empty, Heading, Panel, Segmented } from './ui';

type Translate = (key: MessageKey, params?: MessageParams) => string;

/** A label per permission, so the consent dialog says what the plugin actually gets. */
const PERM_KEYS = {
  'session:read': 'plugins.perm.session:read',
  'session:prompt': 'plugins.perm.session:prompt',
  notify: 'plugins.perm.notify',
  storage: 'plugins.perm.storage',
  'host:call': 'plugins.perm.host:call',
} satisfies Record<PluginPermission, MessageKey>;

/** One permission in the user's words. */
const permText = (t: Translate, perm: PluginPermission) => t(PERM_KEYS[perm]);
const permList = (t: Translate, permissions: PluginPermission[]) =>
  permissions.length ? permissions.map((p) => permText(t, p)).join(' · ') : t('plugins.desktop.none');

/** Packages worth suggesting; offered until a configured plugin matches. */
const RECOMMENDED = [{ source: 'npm:pi-lens', descKey: 'plugins.lensDesc' }] as const;

interface Props {
  catalog: CustomizeCatalog;
  project: string | null;
  onCatalog: (c: CustomizeCatalog) => void;
}

/** The files a package brings, each with its own switch (written as filters on the settings entry). */
function PluginItems({
  plugin,
  project,
  onCatalog,
}: {
  plugin: PluginInfo;
  project: string | null;
  onCatalog: (c: CustomizeCatalog) => void;
}) {
  const t = useT();
  const [items, setItems] = useState<PluginResource[] | null>(null);
  const load = () =>
    call('customize:pluginResources', plugin.source, plugin.scope, project).then(setItems, (err) =>
      toast.error(errText(err)),
    );
  useEffect(() => {
    void load();
  }, [plugin.source, plugin.scope]); // eslint-disable-line react-hooks/exhaustive-deps
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
  if (!items.length)
    return <div className="px-4 pb-3 pl-15 text-xs text-muted-foreground">{t('plugins.itemsEmpty')}</div>;
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
                <span className="min-w-0 flex-1 truncate font-mono text-xs" title={r.path}>
                  {r.name}
                </span>
                <Switch checked={r.enabled} onCheckedChange={(on) => void toggle(r, on)} aria-label={r.name} />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/**
 * A package's desktop plugins: what they add to the app, what they may do, and the switch that decides
 * it. Turning one on is a permission grant, so the dialog names every permission first.
 */
function DesktopItems({
  source,
  scope,
  project,
  plugins,
  onChange,
}: {
  source: string;
  scope: 'user' | 'project';
  project: string | null;
  plugins: DesktopPluginInfo[];
  onChange: (list: DesktopPluginInfo[]) => void;
}) {
  const t = useT();
  const mine = plugins.filter((p) => p.source === source && p.scope === scope);
  if (!mine.length) return null;
  return (
    <div className="space-y-2 px-4 pb-3 pl-15">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {t('plugins.desktop.title')}
        <Tip>{t('plugins.desktop.tip')}</Tip>
      </div>
      {mine.map((p) => (
        <DesktopRow key={p.id} plugin={p} project={project} onChange={onChange} />
      ))}
    </div>
  );
}

function DesktopRow({
  plugin,
  project,
  onChange,
}: {
  plugin: DesktopPluginInfo;
  project: string | null;
  onChange: (list: DesktopPluginInfo[]) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const set = async (on: boolean) => {
    if (
      on &&
      !(await dialogs.confirm(
        t('plugins.desktop.grantTitle', { id: plugin.id }),
        t('plugins.desktop.grantBody', { perms: permList(t, plugin.permissions) }),
        t('plugins.desktop.grant'),
      ))
    )
      return;
    setBusy(true);
    try {
      onChange(await call('plugins:setEnabled', plugin.id, on, on ? plugin.permissions : null, project));
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };
  const pages = plugin.contributions.pages.map((p) => p.title).join(' · ');
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-xs font-medium">{plugin.name || plugin.id}</span>
            <Badge variant="secondary" className="font-mono">
              {plugin.id}
            </Badge>
            {plugin.version && <span className="text-xs text-muted-foreground">v{plugin.version}</span>}
            {plugin.needsGrant && (
              <Badge variant="secondary" className="text-warning" title={t('plugins.desktop.needsGrantHint')}>
                {t('plugins.desktop.needsGrant')}
              </Badge>
            )}
            {!plugin.enabled && <Badge variant="secondary">{t('plugins.desktop.off')}</Badge>}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {pages ? t('plugins.desktop.pages', { list: pages }) : t('plugins.desktop.noPages')}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {t('plugins.desktop.permissions', { list: permList(t, plugin.permissions) })}
          </div>
          {plugin.error && <div className="mt-1 text-xs text-destructive">{plugin.error}</div>}
        </div>
        <Switch
          checked={plugin.enabled}
          disabled={busy || (!!plugin.error && !plugin.enabled)}
          onCheckedChange={(on) => void set(on)}
          aria-label={plugin.id}
        />
      </div>
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
  /** The desktop plugins of every configured package; installed, enabled or not. */
  const [desktop, setDesktop] = useState<DesktopPluginInfo[]>([]);
  useEffect(() => {
    const load = () => call('plugins:list', project).then(setDesktop, (err) => toast.error(errText(err)));
    load();
    // The host owns this list (installs, switches, another window): it announces a change, the page reads again.
    return subscribeResource('plugins', load);
  }, [project, catalog]);

  const run = async (
    label: 'installing' | 'updating' | 'removing',
    fn: () => Promise<CustomizeCatalog>,
    done?: string,
  ) => {
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
    run('installing', () => call('customize:pluginInstall', source, scope, project), t('plugins.installed')).then(() =>
      setSource(''),
    );
  /** Hand the user a new session with the prompt half-written; the plugin-author skill does the rest. */
  const createWithAi = () => {
    showWelcome();
    drafts.setText(welcomeDraftKey(), t('plugins.createWithAiPrompt'));
  };
  const remove = async (p: PluginInfo) => {
    if (
      !(await dialogs.confirm(
        t('plugins.removeTitle', { source: p.source }),
        t('plugins.removeBody'),
        t('plugins.remove'),
        true,
      ))
    )
      return;
    await run('removing', () => call('customize:pluginRemove', p.source, p.scope, project), t('plugins.removed'));
  };

  return (
    <>
      <Heading
        title={t('plugins.title')}
        sub={t('plugins.sub')}
        tip={t('plugins.tip')}
        action={
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="outline" onClick={createWithAi}>
              <SparklesIcon className="size-4" />
              {t('plugins.createWithAi')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy || !catalog.plugins.length}
              onClick={() =>
                void run('updating', () => call('customize:pluginUpdate', null, project), t('plugins.updatedAll'))
              }
            >
              <RefreshCwIcon className={`size-4 ${busy === 'updating' ? 'animate-spin' : ''}`} />
              {t('plugins.updateAll')}
            </Button>
          </div>
        }
      />
      <div className="mb-5 rounded-xl border bg-card p-4">
        <div className="mb-2 text-sm font-medium">{t('plugins.install')}</div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="min-w-64 flex-1"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && source.trim() && !busy && !e.nativeEvent.isComposing) void install();
            }}
            placeholder="npm:pi-web-access   git:github.com/user/repo   F:\path\to\package"
            spellCheck={false}
            disabled={!!busy}
          />
          <Segmented
            value={scope}
            onChange={setScope}
            options={[
              { id: 'user', label: t('plugins.personal') },
              { id: 'project', label: t('plugins.projectOpt'), disabled: !project },
            ]}
          />
          <Button disabled={!source.trim() || !!busy} onClick={() => void install()}>
            {busy === 'installing' ? (
              <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <DownloadIcon className="size-4" />
            )}
            {t('plugins.installBtn')}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {busy
            ? t('plugins.firstInstall', { busy: t(`plugins.${busy}`) })
            : scope === 'project' && project
              ? t('plugins.projectScope', { name: fname(project) })
              : t('plugins.userScope')}
        </p>
      </div>
      {RECOMMENDED.filter((r) => !catalog.plugins.some((p) => p.source.replace(/@[^@/]*$/, '') === r.source)).map(
        (r) => (
          <div key={r.source} className="mb-5 flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
              <PackageIcon className="size-4 text-muted-foreground" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-sm font-medium">{r.source}</span>
                <Badge variant="secondary">{t('plugins.recommended')}</Badge>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{t(r.descKey)}</div>
            </div>
            <Button
              size="sm"
              disabled={!!busy}
              onClick={() =>
                void run(
                  'installing',
                  () => call('customize:pluginInstall', r.source, 'user', project),
                  t('plugins.installed'),
                )
              }
            >
              <DownloadIcon className="size-4" />
              {t('plugins.installBtn')}
            </Button>
          </div>
        ),
      )}
      <Panel>
        {catalog.plugins.map((p) => (
          <div key={`${p.scope}:${p.source}`}>
            <div className="flex items-center gap-3 px-4 py-3">
              <Button
                size="icon"
                variant="ghost"
                className="size-6 shrink-0"
                title={t('plugins.items')}
                disabled={!p.installedPath}
                onClick={() => setOpen(open === `${p.scope}:${p.source}` ? null : `${p.scope}:${p.source}`)}
              >
                <ChevronRightIcon
                  className={`size-4 transition-transform ${open === `${p.scope}:${p.source}` ? 'rotate-90' : ''}`}
                />
              </Button>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
                <PackageIcon className="size-4 text-muted-foreground" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate font-mono text-sm font-medium">{p.source}</span>
                  <Badge variant="secondary">{t(p.scope === 'user' ? 'plugins.personal' : 'plugins.projectOpt')}</Badge>
                  {p.filtered && (
                    <Badge variant="secondary" title={t('plugins.filteredHint')}>
                      {t('plugins.filtered')}
                    </Badge>
                  )}
                  {!p.installedPath && (
                    <Badge variant="secondary" className="text-warning" title={t('plugins.notInstalledHint')}>
                      {t('plugins.notInstalled')}
                    </Badge>
                  )}
                </div>
                {p.installedPath && (
                  <div className="mt-0.5 truncate text-xs text-muted-foreground" title={p.installedPath}>
                    {p.installedPath}
                  </div>
                )}
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                title={t('plugins.update')}
                disabled={!!busy}
                onClick={() =>
                  void run(
                    'updating',
                    () => call('customize:pluginUpdate', p.source, project),
                    t('plugins.updated', { source: p.source }),
                  )
                }
              >
                <RefreshCwIcon className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-8 text-destructive"
                title={t('plugins.remove')}
                disabled={!!busy}
                onClick={() => void remove(p)}
              >
                <Trash2Icon className="size-4" />
              </Button>
            </div>
            {open === `${p.scope}:${p.source}` && (
              <>
                <DesktopItems
                  source={p.source}
                  scope={p.scope}
                  project={project}
                  plugins={desktop}
                  onChange={setDesktop}
                />
                <PluginItems plugin={p} project={project} onCatalog={onCatalog} />
              </>
            )}
          </div>
        ))}
        {!catalog.plugins.length && <Empty>{t('plugins.empty')}</Empty>}
      </Panel>
    </>
  );
}
