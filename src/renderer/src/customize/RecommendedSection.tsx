// Customize → Recommended: ready-made skills, plugins and connectors for common work, one click each.
import { useState } from 'react';
import { CheckIcon, DownloadIcon, PackageIcon, PlugZapIcon, SparklesIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { RECOMMENDED, RECOMMENDED_GROUPS } from '@shared/recommended';
import type { Recommended } from '@shared/recommended';
import type { CustomizeCatalog } from '@shared/protocol';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { call, errText } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { dialogs } from '@/store/dialogs';
import { Heading, Panel } from './ui';

interface Props {
  catalog: CustomizeCatalog;
  project: string | null;
  onCatalog: (c: CustomizeCatalog) => void;
}

const KIND_ICON = {
  skill: SparklesIcon,
  skillRepo: SparklesIcon,
  plugin: PackageIcon,
  connector: PlugZapIcon,
} as const;

/** Source without its `@version` suffix, as the Plugins tab compares it. */
const bare = (source: string) => source.replace(/@[^@/]*$/, '');

export function RecommendedSection({ catalog, project, onCatalog }: Props) {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);

  const installed = (r: Recommended) => {
    if (r.kind === 'skill') return catalog.skills.some((s) => s.name === r.name);
    if (r.kind === 'skillRepo') return catalog.skills.some((s) => s.name === r.marker);
    if (r.kind === 'plugin') return catalog.plugins.some((p) => bare(p.source) === r.source);
    return catalog.connectors.some((c) => c.name === r.connector.name);
  };
  /** Take back what `install` put in place. */
  const uninstall = async (r: Recommended) => {
    if (
      !(await dialogs.confirm(
        t('rec.uninstallTitle', { name: t(r.title) }),
        t('rec.uninstallBody'),
        t('rec.uninstall'),
        true,
      ))
    )
      return;
    setBusy(r.id);
    try {
      if (r.kind === 'skill') {
        const own = catalog.skills.find((s) => s.name === r.name && s.scope !== 'package');
        if (!own) throw new Error(t('rec.notFound'));
        onCatalog(await call('customize:skillDelete', own.file, project));
      } else if (r.kind === 'skillRepo') onCatalog(await call('customize:skillsFromGitRemove', r.repo, project));
      else if (r.kind === 'plugin') {
        const entry = catalog.plugins.find((p) => bare(p.source) === r.source);
        if (!entry) throw new Error(t('rec.notFound'));
        onCatalog(await call('customize:pluginRemove', entry.source, entry.scope, project));
      } else onCatalog(await call('customize:connectorRemove', r.connector.name, 'user', project));
      toast.success(t('rec.removed'));
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(null);
    }
  };
  const install = async (r: Recommended) => {
    setBusy(r.id);
    try {
      if (r.kind === 'skill')
        onCatalog(
          await call(
            'customize:skillCreate',
            { name: r.name, description: t(r.skillDesc), body: t(r.body), scope: 'user', home: 'pi' },
            project,
          ),
        );
      else if (r.kind === 'skillRepo') onCatalog(await call('customize:skillsFromGit', r.repo, r.subdir, project));
      else if (r.kind === 'plugin') onCatalog(await call('customize:pluginInstall', r.source, 'user', project));
      else onCatalog(await call('customize:connectorSave', { ...r.connector, scope: 'user' }, project));
      toast.success(t('rec.done'));
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Heading title={t('customize.tab.recommended')} sub={t('rec.sub')} tip={t('rec.tip')} />
      <div className="space-y-6">
        {RECOMMENDED_GROUPS.map((group) => (
          <section key={group}>
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">{t(`rec.group.${group}`)}</h3>
            <Panel>
              {RECOMMENDED.filter((r) => r.group === group).map((r) => {
                const Icon = KIND_ICON[r.kind];
                const done = installed(r);
                return (
                  <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
                      <Icon className="size-4 text-muted-foreground" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium">{t(r.title)}</span>
                        <Badge variant="secondary">{t(`rec.kind.${r.kind}`)}</Badge>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{t(r.desc)}</div>
                    </div>
                    {done ? (
                      <>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <CheckIcon className="size-4" />
                          {t('rec.installed')}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          disabled={!!busy}
                          onClick={() => void uninstall(r)}
                        >
                          {busy === r.id ? (
                            <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          ) : (
                            <Trash2Icon className="size-4" />
                          )}
                          {t('rec.uninstall')}
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" disabled={!!busy} onClick={() => void install(r)}>
                        {busy === r.id ? (
                          <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        ) : (
                          <DownloadIcon className="size-4" />
                        )}
                        {t('rec.install')}
                      </Button>
                    )}
                  </div>
                );
              })}
            </Panel>
          </section>
        ))}
      </div>
    </>
  );
}
