// Settings → 对象存储: the user's own S3-compatible bucket. One connection for everything Pi Desktop keeps
// off this machine (published Artifacts today); features that use it are managed on their own pages.
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { missingStorageField, type ObjectStorageDraft, type ObjectStorageInfo } from '@shared/storage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { call, errText } from '@/lib/api';
import { cn } from '@/lib/utils';

const Heading = ({ title, sub }: { title: string; sub: string }) => (
  <div className="mb-5">
    <h2 className="text-xl font-semibold">{title}</h2>
    <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
  </div>
);
const Panel = ({ children }: { children: ReactNode }) => <div className="divide-y rounded-xl border bg-card">{children}</div>;
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
function Group({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="mt-7 first:mt-0">
      <h3 className="px-1 text-sm font-semibold">{title}</h3>
      {sub && <p className="mt-0.5 px-1 text-xs text-muted-foreground">{sub}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

const fail = (err: unknown) => toast.error(errText(err));
/** Setting names in the order the form shows them, for "fill in … first" messages. */
const FIELD_LABEL: Record<string, string> = {
  endpoint: 'Endpoint', bucket: 'Bucket', accessKeyId: 'Access Key ID', secretAccessKey: 'Secret Access Key', publicBaseUrl: '公开访问地址',
};

type Form = ObjectStorageDraft;
const toForm = (info: ObjectStorageInfo): Form => ({
  endpoint: info.endpoint, region: info.region, bucket: info.bucket, accessKeyId: info.accessKeyId, publicBaseUrl: info.publicBaseUrl,
  prefix: info.prefix, pathStyle: info.pathStyle, secretAccessKey: '',
});

function StoragePanel({ info, onSaved }: { info: ObjectStorageInfo; onSaved: (info: ObjectStorageInfo) => void }) {
  const [form, setForm] = useState<Form>(() => toForm(info));
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const missing = missingStorageField(form, info.secretSet || !!form.secretAccessKey);

  const save = async () => {
    setBusy('save');
    try {
      const next = await call('storage:save', form);
      setForm(toForm(next));
      onSaved(next);
      toast.success(next.ready ? '已保存' : '已保存');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };
  const test = async () => {
    setBusy('test');
    try {
      await call('storage:test', form);
      toast.success('连接正常');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };
  const field = (label: string, key: keyof Form, hint?: string, extra?: { placeholder?: string; type?: string; mono?: boolean }) => (
    <Row title={label} hint={hint}>
      <Input
        className={cn('h-8 w-72', extra?.mono !== false && 'font-mono text-xs')}
        type={extra?.type}
        value={String(form[key])}
        placeholder={extra?.placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => set(key, e.target.value as Form[typeof key])}
      />
    </Row>
  );
  return (
    <Panel>
      {field('Endpoint', 'endpoint', 'S3 兼容服务的地址：AWS S3、Cloudflare R2、阿里云 OSS、腾讯云 COS、MinIO 等。', { placeholder: 'https://<account>.r2.cloudflarestorage.com' })}
      {field('Region', 'region', 'R2 填 auto；其他服务按控制台里的区域填，如 us-east-1、oss-cn-hangzhou。', { placeholder: 'auto' })}
      {field('Bucket', 'bucket', '建议用一个单独的存储桶：页面的脚本和同一域名下的其他内容属于同一个来源。')}
      {field('Access Key ID', 'accessKeyId')}
      {field('Secret Access Key', 'secretAccessKey', info.secretSet ? '已保存。留空表示不修改。' : '保存在这台电脑的数据目录中，不会显示或发给模型。', {
        type: 'password', placeholder: info.secretSet ? '••••••••' : undefined,
      })}
      {field('公开访问地址', 'publicBaseUrl', '浏览器能访问到这个存储桶的地址（公开读的桶域名，或前面接的 CDN），生成的链接以它开头。', { placeholder: 'https://pub-xxxx.r2.dev' })}
      {field('路径前缀', 'prefix', '可选。Pi Desktop 存进桶里的所有内容都放在这个前缀下，各功能再各用一个子文件夹（如 artifacts/）。', { placeholder: 'pi-desktop' })}
      <Row title="Path-style 地址" hint="大多数 S3 兼容服务（R2、MinIO）用 endpoint/bucket/key；AWS、OSS、COS 常用 bucket.endpoint/key，此时关闭。">
        <Switch checked={form.pathStyle} onCheckedChange={(v) => set('pathStyle', v)} />
      </Row>
      <div className="flex items-center justify-end gap-2 px-4 py-3">
        {missing && <span className="mr-auto text-xs text-muted-foreground">还需要填写：{FIELD_LABEL[missing] ?? missing}</span>}
        <Button size="sm" variant="outline" disabled={busy !== null || (!!missing && missing !== 'publicBaseUrl')} onClick={() => void test()}>
          {busy === 'test' ? '检测中…' : '测试连接'}
        </Button>
        <Button size="sm" disabled={busy !== null} onClick={() => void save()}>{busy === 'save' ? '保存中…' : '保存'}</Button>
      </div>
    </Panel>
  );
}

export function StorageSection() {
  const [info, setInfo] = useState<ObjectStorageInfo | null>(null);
  useEffect(() => {
    void call('storage:get').then(setInfo).catch(fail);
  }, []);
  if (!info) return null;
  return (
    <div>
      <Heading title="对象存储" sub="Pi Desktop 存放资产的地方：你自己的 S3 兼容存储桶（AWS S3、Cloudflare R2、阿里云 OSS、腾讯云 COS、MinIO 等）。目前 Artifacts 用它发布页面；不配置也能正常使用，只是需要上传的功能用不了。" />
      <Group title={info.ready ? '已配置' : '尚未配置'} sub={info.ready ? '已可用。上传的内容经公开访问地址可读：只上传你愿意分享的内容。' : '配置并保存后，需要上传的功能（如 Artifacts 的发布）才会可用。'}>
        <StoragePanel info={info} onSaved={setInfo} />
      </Group>
    </div>
  );
}
