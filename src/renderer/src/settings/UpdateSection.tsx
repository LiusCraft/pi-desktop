// Settings → About: version check, one-click update and the release notes of recent versions.
import { useEffect, useState } from 'react';
import { ChevronRightIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { Settings } from '@shared/protocol';
import { Switch } from '@/components/ui/switch';
import type { UpdateCheck, UpdateProgress } from '@shared/update';
import { Markdown } from '@/components/common/Markdown';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { bridge, call, errText } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { Group, Panel, Row } from './ui';

const PERCENT = 100;

export function UpdateSection({ version, settings, onPatch }: { version: string; settings: Partial<Settings>; onPatch: (values: Partial<Settings>) => void }) {
  const t = useT();
  const locale = useLocale();
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);

  const run = async () => {
    setChecking(true);
    try {
      setCheck(await call('update:check'));
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    void run();
    return bridge.on('update:progress', setProgress);
  }, []);

  const install = async () => {
    setProgress({ stage: 'downloading', received: 0, total: 0 });
    try {
      await call('update:install');
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setProgress(null);
    }
  };

  const available = check?.available ?? null;
  const percent = progress && progress.total ? Math.floor((progress.received / progress.total) * PERCENT) : 0;
  const status = progress
    ? progress.stage === 'launching' ? t('update.launching') : t('update.downloading', { percent })
    : checking ? t('update.checking') : !check ? '' : available ? t('update.available', { version: available.version }) : t('update.upToDate');
  const date = (iso: string) => (iso ? new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }) : '');

  return (
    <>
      <Panel>
        <Row title={t('update.title')} hint={status} tip={available?.asset ? t('update.installTip') : undefined}>
          <Button size="sm" variant="outline" disabled={checking || !!progress} onClick={() => void run()}>{t('update.check')}</Button>
          {available && (
            available.asset
              ? <Button size="sm" disabled={!!progress} onClick={() => void install()}>{t('update.install')}</Button>
              : <Button size="sm" onClick={() => void call('app:openExternal', available.url)}>{t('update.viewOnGithub')}</Button>
          )}
        </Row>
        <Row title={t('update.auto')} hint={t('update.auto.hint')}>
          <Switch checked={settings.autoUpdateCheck !== false} onCheckedChange={(v) => onPatch({ autoUpdateCheck: v })} />
        </Row>
      </Panel>
      <Group title={t('update.changes')} sub={t('update.changesSub')}>
        {check && !check.releases.length ? (
          <p className="px-1 text-sm text-muted-foreground">{t('update.noReleases')}</p>
        ) : (
          <Panel>
            {check?.releases.map((r) => (
              <Collapsible key={r.version} defaultOpen={r.version === available?.version}>
                <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left text-sm">
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
                  <span className="font-medium">v{r.version}</span>
                  {r.version === version && <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{t('update.current')}</span>}
                  <span className="ml-auto text-xs text-muted-foreground">{date(r.publishedAt)}</span>
                </CollapsibleTrigger>
                <CollapsibleContent className="px-4 pb-4 pl-10">
                  {r.notes ? <Markdown text={r.notes} className="text-sm" /> : <p className="text-sm text-muted-foreground">{t('update.noNotes')}</p>}
                  <Button size="sm" variant="link" className="mt-1 h-auto p-0" onClick={() => void call('app:openExternal', r.url)}>{t('update.viewOnGithub')}</Button>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </Panel>
        )}
      </Group>
    </>
  );
}
