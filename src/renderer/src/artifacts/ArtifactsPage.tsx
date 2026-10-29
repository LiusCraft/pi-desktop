// The Artifacts page: the web pages the model built, to preview, publish and take down. The bucket they are
// published to is a setting (Settings → Storage); previewing needs none of it.
import { useCallback, useEffect, useState } from 'react';
import { CheckIcon, CopyIcon, ExternalLinkIcon, EyeIcon, LoaderCircleIcon, ShapesIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { publishState, type ArtifactMeta, type ArtifactPublishState } from '@shared/artifacts';
import { useCopy } from '@/components/common/Copy';
import { Button } from '@/components/ui/button';
import { Empty, Heading, Panel } from '@/customize/ui';
import { call, errText } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { ago } from '@/lib/format';
import { cn } from '@/lib/utils';
import { subscribeResource } from '@/store/resources';

const fail = (err: unknown) => toast.error(errText(err));
const STATE_LABEL = {
  draft: 'artifacts.stateDraft',
  published: 'artifacts.statePublished',
  outdated: 'artifacts.stateOutdated',
} as const satisfies Record<ArtifactPublishState, string>;
const STATE_TONE: Record<ArtifactPublishState, string> = {
  draft: 'bg-muted text-muted-foreground',
  published: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  outdated: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
};
const kb = (bytes: number) => `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;

/** Screenshot of the page, taken by the app the first time a version is shown; a placeholder until it arrives. */
export function Thumbnail({ a }: { a: ArtifactMeta }) {
  const t = useT();
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setSrc(undefined);
    void call('artifacts:thumbnail', a.id)
      .then((url) => live && setSrc(url))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [a.id, a.version]);
  return (
    <button
      className="group/thumb relative block aspect-[16/10] w-full overflow-hidden border-b bg-muted/40"
      title={t('artifacts.preview')}
      onClick={() => void call('artifacts:preview', a.id).catch(fail)}
    >
      {src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          className="size-full object-cover object-top transition-transform duration-300 group-hover/thumb:scale-[1.03]"
        />
      ) : (
        <span className="flex size-full items-center justify-center text-muted-foreground">
          {src === undefined ? (
            <LoaderCircleIcon className="size-5 animate-spin" />
          ) : (
            <ShapesIcon className="size-8 opacity-40" />
          )}
        </span>
      )}
      <span className="absolute inset-0 flex items-center justify-center bg-background/0 opacity-0 transition group-hover/thumb:bg-background/40 group-hover/thumb:opacity-100">
        <span className="flex items-center gap-1.5 rounded-full bg-background px-3 py-1 text-xs font-medium shadow">
          <EyeIcon className="size-3.5" />
          {t('artifacts.preview')}
        </span>
      </span>
    </button>
  );
}

function ArtifactCard({
  a,
  ready,
  onChange,
}: {
  a: ArtifactMeta;
  ready: boolean;
  onChange: (list: ArtifactMeta[]) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState<'publish' | 'unpublish' | 'remove' | null>(null);
  const { copied, copy } = useCopy();
  const state = publishState(a);
  const run = async (what: NonNullable<typeof busy>, fn: () => Promise<unknown>) => {
    setBusy(what);
    try {
      await fn();
      onChange(await call('artifacts:list'));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };
  const remove = () => {
    const warn = t(a.publishedFiles.length ? 'artifacts.confirmDeletePublished' : 'artifacts.confirmDelete', {
      title: a.title,
    });
    if (window.confirm(warn)) void run('remove', () => call('artifacts:remove', a.id, true));
  };
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md">
      <Thumbnail a={a} />
      <div className="flex flex-1 flex-col gap-1.5 px-3.5 pt-3">
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium" title={a.title}>
            {a.title}
          </span>
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs', STATE_TONE[state])}>
            {t(STATE_LABEL[state])}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          {t('artifacts.meta', { v: a.version, n: a.files.length, size: kb(a.bytes), ago: ago(a.updatedAt, true) })}
        </div>
        {a.publishedUrl && (
          <div className="flex items-center gap-1">
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={a.publishedUrl}>
              {a.publishedUrl}
            </code>
            <Button
              size="icon-sm"
              variant="ghost"
              title={t('artifacts.copyLink')}
              onClick={() => copy(a.publishedUrl!)}
            >
              {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              title={t('artifacts.openBrowser')}
              onClick={() => void call('app:openExternal', a.publishedUrl!)}
            >
              <ExternalLinkIcon className="size-4" />
            </Button>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 px-3.5 py-3">
        <Button
          size="sm"
          disabled={!ready || busy !== null || state === 'published'}
          title={ready ? undefined : t('artifacts.needStorage')}
          onClick={() => void run('publish', () => call('artifacts:publish', a.id))}
        >
          {busy === 'publish'
            ? t('artifacts.uploading')
            : state === 'draft'
              ? t('artifacts.publish')
              : state === 'outdated'
                ? t('artifacts.updatePublish')
                : t('artifacts.published')}
        </Button>
        {state !== 'draft' && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => void run('unpublish', () => call('artifacts:unpublish', a.id))}
          >
            {busy === 'unpublish' ? t('artifacts.working') : t('artifacts.unpublish')}
          </Button>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          className="ml-auto text-muted-foreground hover:text-destructive"
          title={t('artifacts.delete')}
          disabled={busy !== null}
          onClick={remove}
        >
          <Trash2Icon className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function ArtifactsPage() {
  const t = useT();
  const [list, setList] = useState<ArtifactMeta[] | null>(null);
  const [ready, setReady] = useState(false);
  const load = useCallback(() => {
    void call('artifacts:list').then(setList).catch(fail);
    void call('storage:get')
      .then((s) => setReady(s.ready))
      .catch(fail);
  }, []);
  useEffect(() => {
    load();
    // The bucket is set up in another window: look again when this one is back in focus. A page saved from
    // chat arrives as a resource change instead, at once.
    window.addEventListener('focus', load);
    const offSaved = subscribeResource('artifacts', load);
    return () => {
      window.removeEventListener('focus', load);
      offSaved();
    };
  }, [load]);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl animate-in px-8 py-8 duration-200 fade-in-0 slide-in-from-bottom-1">
        <Heading
          title={t('artifacts.title')}
          sub={t('artifacts.sub')}
          action={
            list && !ready ? (
              <Button size="sm" variant="outline" onClick={() => void call('settings:open', 'storage')}>
                {t('artifacts.storageSettings')}
              </Button>
            ) : undefined
          }
        />
        {list && !ready && (
          <div className="mb-4 rounded-lg border border-dashed px-4 py-3 text-xs text-muted-foreground">
            {t('artifacts.noStorage')}
          </div>
        )}
        {list &&
          (list.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
              {list.map((a) => (
                <ArtifactCard key={a.id} a={a} ready={ready} onChange={setList} />
              ))}
            </div>
          ) : (
            <Panel>
              <Empty>{t('artifacts.empty')}</Empty>
            </Panel>
          ))}
      </div>
    </div>
  );
}
