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
import { ago } from '@/lib/format';
import { cn } from '@/lib/utils';

const fail = (err: unknown) => toast.error(errText(err));
const STATE_LABEL: Record<ArtifactPublishState, string> = { draft: '仅本地', published: '已发布', outdated: '有未发布的更新' };
const STATE_TONE: Record<ArtifactPublishState, string> = {
  draft: 'bg-muted text-muted-foreground',
  published: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  outdated: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
};
const kb = (bytes: number) => `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;

/** Screenshot of the page, taken by the app the first time a version is shown; a placeholder until it arrives. */
export function Thumbnail({ a }: { a: ArtifactMeta }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setSrc(undefined);
    void call('artifacts:thumbnail', a.id).then((url) => live && setSrc(url)).catch(() => live && setSrc(null));
    return () => { live = false; };
  }, [a.id, a.version]);
  return (
    <button
      className="group/thumb relative block aspect-[16/10] w-full overflow-hidden border-b bg-muted/40"
      title="预览"
      onClick={() => void call('artifacts:preview', a.id).catch(fail)}
    >
      {src ? (
        <img src={src} alt="" draggable={false} className="size-full object-cover object-top transition-transform duration-300 group-hover/thumb:scale-[1.03]" />
      ) : (
        <span className="flex size-full items-center justify-center text-muted-foreground">
          {src === undefined ? <LoaderCircleIcon className="size-5 animate-spin" /> : <ShapesIcon className="size-8 opacity-40" />}
        </span>
      )}
      <span className="absolute inset-0 flex items-center justify-center bg-background/0 opacity-0 transition group-hover/thumb:bg-background/40 group-hover/thumb:opacity-100">
        <span className="flex items-center gap-1.5 rounded-full bg-background px-3 py-1 text-xs font-medium shadow"><EyeIcon className="size-3.5" />预览</span>
      </span>
    </button>
  );
}

function ArtifactCard({ a, ready, onChange }: { a: ArtifactMeta; ready: boolean; onChange: (list: ArtifactMeta[]) => void }) {
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
    const warn = a.publishedFiles.length ? `删除「${a.title}」？存储桶里已发布的副本也会一并删除。` : `删除「${a.title}」？`;
    if (window.confirm(warn)) void run('remove', () => call('artifacts:remove', a.id, true));
  };
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md">
      <Thumbnail a={a} />
      <div className="flex flex-1 flex-col gap-1.5 px-3.5 pt-3">
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium" title={a.title}>{a.title}</span>
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs', STATE_TONE[state])}>{STATE_LABEL[state]}</span>
        </div>
        <div className="text-xs text-muted-foreground">v{a.version} · {a.files.length} 个文件 · {kb(a.bytes)} · {ago(a.updatedAt, true)}</div>
        {a.publishedUrl && (
          <div className="flex items-center gap-1">
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={a.publishedUrl}>{a.publishedUrl}</code>
            <Button size="icon-sm" variant="ghost" title="复制链接" onClick={() => copy(a.publishedUrl!)}>{copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}</Button>
            <Button size="icon-sm" variant="ghost" title="在浏览器中打开" onClick={() => void call('app:openExternal', a.publishedUrl!)}><ExternalLinkIcon className="size-4" /></Button>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 px-3.5 py-3">
        <Button
          size="sm"
          disabled={!ready || busy !== null || state === 'published'}
          title={ready ? undefined : '发布需要先在 设置 → 对象存储 里配置存储桶'}
          onClick={() => void run('publish', () => call('artifacts:publish', a.id))}
        >
          {busy === 'publish' ? '上传中…' : state === 'draft' ? '发布' : state === 'outdated' ? '更新发布' : '已发布'}
        </Button>
        {state !== 'draft' && (
          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void run('unpublish', () => call('artifacts:unpublish', a.id))}>
            {busy === 'unpublish' ? '处理中…' : '取消发布'}
          </Button>
        )}
        <Button size="icon-sm" variant="ghost" className="ml-auto text-muted-foreground hover:text-destructive" title="删除" disabled={busy !== null} onClick={remove}>
          <Trash2Icon className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function ArtifactsPage() {
  const [list, setList] = useState<ArtifactMeta[] | null>(null);
  const [ready, setReady] = useState(false);
  const load = useCallback(() => {
    void call('artifacts:list').then(setList).catch(fail);
    void call('storage:get').then((s) => setReady(s.ready)).catch(fail);
  }, []);
  useEffect(() => {
    load();
    // The model saves pages from chat and the bucket is set up in another window: look again when this one is back in focus.
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl animate-in px-8 py-8 duration-200 fade-in-0 slide-in-from-bottom-1">
        <Heading
          title="Artifacts"
          sub="模型做的页面、图表和小工具。随时本地预览；发布到你自己的对象存储后，得到一个任何人都能打开的链接。"
          action={list && !ready ? <Button size="sm" variant="outline" onClick={() => void call('settings:open', 'storage')}>对象存储设置</Button> : undefined}
        />
        {list && !ready && (
          <div className="mb-4 rounded-lg border border-dashed px-4 py-3 text-xs text-muted-foreground">
            还没有配置对象存储，所以暂时只能本地预览。需要分享时，到「对象存储设置」里填好 S3 兼容的存储桶即可。
          </div>
        )}
        {list && (list.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
            {list.map((a) => <ArtifactCard key={a.id} a={a} ready={ready} onChange={setList} />)}
          </div>
        ) : (
          <Panel><Empty>还没有 artifact。在对话里让模型“做一个页面，保存成 artifact”，它会出现在这里。</Empty></Panel>
        ))}
      </div>
    </div>
  );
}
