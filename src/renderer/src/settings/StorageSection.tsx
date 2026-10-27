// Settings → Object storage: the user's own S3-compatible bucket. One connection for everything Pi Desktop keeps
// off this machine (published Artifacts today); features that use it are managed on their own pages.
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { MessageKey } from '@shared/i18n';
import { missingStorageField, type ObjectStorageDraft, type ObjectStorageInfo } from '@shared/storage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { call, errText } from '@/lib/api';
import { useT } from '@/lib/i18n';
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
const FIELD_LABEL: Record<string, MessageKey | string> = {
  endpoint: 'Endpoint', bucket: 'Bucket', accessKeyId: 'Access Key ID', secretAccessKey: 'Secret Access Key', publicBaseUrl: 'storage.publicBaseUrl',
};

type Form = ObjectStorageDraft;
const toForm = (info: ObjectStorageInfo): Form => ({
  endpoint: info.endpoint, region: info.region, bucket: info.bucket, accessKeyId: info.accessKeyId, publicBaseUrl: info.publicBaseUrl,
  prefix: info.prefix, pathStyle: info.pathStyle, secretAccessKey: '',
});

function StoragePanel({ info, onSaved }: { info: ObjectStorageInfo; onSaved: (info: ObjectStorageInfo) => void }) {
  const t = useT();
  const [form, setForm] = useState<Form>(() => toForm(info));
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const fieldLabel = (key: string) => { const l = FIELD_LABEL[key] ?? key; return l.startsWith('storage.') ? t(l as MessageKey) : l; };
  const missing = missingStorageField(form, info.secretSet || !!form.secretAccessKey);

  const save = async () => {
    setBusy('save');
    try {
      const next = await call('storage:save', form);
      setForm(toForm(next));
      onSaved(next);
      toast.success(t('storage.saved'));
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
      toast.success(t('storage.connected'));
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
      {field('Endpoint', 'endpoint', t('storage.endpoint.hint'), { placeholder: 'https://<account>.r2.cloudflarestorage.com' })}
      {field('Region', 'region', t('storage.region.hint'), { placeholder: 'auto' })}
      {field('Bucket', 'bucket', t('storage.bucket.hint'))}
      {field('Access Key ID', 'accessKeyId')}
      {field('Secret Access Key', 'secretAccessKey', t(info.secretSet ? 'storage.secret.set' : 'storage.secret.unset'), {
        type: 'password', placeholder: info.secretSet ? '••••••••' : undefined,
      })}
      {field(t('storage.publicBaseUrl'), 'publicBaseUrl', t('storage.publicBaseUrl.hint'), { placeholder: 'https://pub-xxxx.r2.dev' })}
      {field(t('storage.prefix'), 'prefix', t('storage.prefix.hint'), { placeholder: 'pi-desktop' })}
      <Row title={t('storage.pathStyle')} hint={t('storage.pathStyle.hint')}>
        <Switch checked={form.pathStyle} onCheckedChange={(v) => set('pathStyle', v)} />
      </Row>
      <div className="flex items-center justify-end gap-2 px-4 py-3">
        {missing && <span className="mr-auto text-xs text-muted-foreground">{t('storage.needFirst', { field: fieldLabel(missing) })}</span>}
        <Button size="sm" variant="outline" disabled={busy !== null || (!!missing && missing !== 'publicBaseUrl')} onClick={() => void test()}>
          {busy === 'test' ? t('storage.testing') : t('storage.test')}
        </Button>
        <Button size="sm" disabled={busy !== null} onClick={() => void save()}>{busy === 'save' ? t('storage.saving') : t('storage.save')}</Button>
      </div>
    </Panel>
  );
}

export function StorageSection() {
  const t = useT();
  const [info, setInfo] = useState<ObjectStorageInfo | null>(null);
  useEffect(() => {
    void call('storage:get').then(setInfo).catch(fail);
  }, []);
  if (!info) return null;
  return (
    <div>
      <Heading title={t('storage.title')} sub={t('storage.sub')} />
      <Group title={t(info.ready ? 'storage.ready' : 'storage.notReady')} sub={t(info.ready ? 'storage.ready.sub' : 'storage.notReady.sub')}>
        <StoragePanel info={info} onSaved={setInfo} />
      </Group>
    </div>
  );
}
