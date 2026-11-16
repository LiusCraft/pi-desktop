// A full page of a desktop plugin replaces the conversation area while it is open, like Customize or
// the Artifacts page. The list of plugins is the host's (see `loadPlugins`); the page only picks the
// one it was opened for.
import { useT } from '@/lib/i18n';
import { isRemote } from '@/lib/api';
import { useApp } from '@/store/app';
import { PluginFrame } from './PluginFrame';

const Notice = ({ children }: { children: string }) => (
  <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">{children}</div>
);

export function PluginPage() {
  const t = useT();
  const key = useApp((s) => s.pluginPage);
  const plugins = useApp((s) => s.plugins);
  if (!key) return null;
  // A plugin page is served from this machine's own packages; a remote host has its own.
  if (isRemote) return <Notice>{t('pluginPage.remote')}</Notice>;
  const [pluginId, pageId] = key.split(':');
  const plugin = plugins.find((p) => p.id === pluginId);
  const page = plugin?.contributions.pages.find((p) => p.id === pageId);
  // Nothing loaded yet: the list arrives right after the window boots.
  if (!plugin && !plugins.length) return <Notice>…</Notice>;
  if (!plugin || !page) return <Notice>{t('pluginPage.missing')}</Notice>;
  if (!plugin.ready) return <Notice>{t('pluginPage.off')}</Notice>;
  return <PluginFrame key={key} plugin={plugin} page={page} />;
}
