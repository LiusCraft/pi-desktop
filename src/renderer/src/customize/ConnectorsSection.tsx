// Customize → Connectors: MCP servers from pi's mcp.json (personal) and <project>/.pi/mcp.json.
// Pi connects to enabled servers when a session starts, so changes apply to new sessions.
import { useState } from 'react';
import { PencilIcon, PlugZapIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import {
  DEFAULT_MCP_EXPOSURE,
  MCP_EXPOSURES,
  type ConnectorDraft,
  type ConnectorInfo,
  type CustomizeCatalog,
} from '@shared/protocol';
import { Tip } from '@/components/common/Tip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { call, errText } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { fname } from '@/lib/format';
import { dialogs } from '@/store/dialogs';
import { BackButton, Empty, Field, Heading, Panel, Segmented } from './ui';

interface Props {
  catalog: CustomizeCatalog;
  project: string | null;
  onCatalog: (c: CustomizeCatalog) => void;
}

const blank: ConnectorDraft = {
  name: '',
  scope: 'user',
  transport: 'stdio',
  command: '',
  args: [],
  url: '',
  pairs: [],
  description: '',
  exposure: DEFAULT_MCP_EXPOSURE,
};

/** A command line the way a person types it: quoted parts stay together. */
const splitArgs = (line: string) => [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
const joinArgs = (args: string[] = []) => args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ');

function ConnectorForm({
  project,
  initial,
  onDone,
  onCatalog,
}: Omit<Props, 'catalog'> & { initial: ConnectorDraft; onDone: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState(initial);
  const [args, setArgs] = useState(joinArgs(initial.args));
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<ConnectorDraft>) => setDraft({ ...draft, ...patch });
  const http = draft.transport === 'http';
  const save = async () => {
    setBusy(true);
    try {
      const body: ConnectorDraft = {
        ...draft,
        args: splitArgs(args),
        pairs: (draft.pairs ?? []).filter((l) => l.trim()),
      };
      onCatalog(await call('customize:connectorSave', body, project));
      toast.success(t('connectors.saved'));
      onDone();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <BackButton onClick={onDone}>{t('connectors.back')}</BackButton>
      <Heading
        title={initial.originalName ? t('connectors.edit', { name: initial.originalName }) : t('connectors.add')}
        sub={t('connectors.form.sub')}
      />
      <div className="space-y-4 rounded-xl border bg-card p-4">
        <Field label={t('connectors.type')}>
          <Segmented
            value={draft.transport}
            onChange={(transport) => set({ transport, pairs: [] })}
            options={[
              { id: 'stdio', label: t('connectors.local') },
              { id: 'http', label: t('connectors.remote') },
            ]}
          />
        </Field>
        <Field label={t('skills.name')} hint={t('connectors.name.hint')}>
          <Input
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="filesystem"
            spellCheck={false}
          />
        </Field>
        {http ? (
          <>
            <Field label={t('connectors.url')} hint={t('connectors.url.hint')}>
              <Input
                value={draft.url}
                onChange={(e) => set({ url: e.target.value })}
                placeholder="https://example.com/mcp"
                spellCheck={false}
              />
            </Field>
            <Field label={t('connectors.headers')} hint={t('connectors.headers.hint')}>
              <Textarea
                value={(draft.pairs ?? []).join('\n')}
                onChange={(e) => set({ pairs: e.target.value.split('\n') })}
                rows={3}
                className="font-mono text-xs"
                placeholder={'Authorization: Bearer ${DOCS_TOKEN}'}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label={t('connectors.command')}>
              <Input
                value={draft.command}
                onChange={(e) => set({ command: e.target.value })}
                placeholder="npx"
                spellCheck={false}
              />
            </Field>
            <Field label={t('connectors.args')} hint={t('connectors.args.hint')}>
              <Input
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder="-y @modelcontextprotocol/server-filesystem ."
                spellCheck={false}
              />
            </Field>
            <Field label={t('connectors.env')} hint={t('connectors.env.hint')}>
              <Textarea
                value={(draft.pairs ?? []).join('\n')}
                onChange={(e) => set({ pairs: e.target.value.split('\n') })}
                rows={3}
                className="font-mono text-xs"
                placeholder="API_KEY=${MY_KEY}"
              />
            </Field>
          </>
        )}
        <Field label={t('connectors.descOptional')}>
          <Input
            value={draft.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="Search and read the product documentation"
          />
        </Field>
        <Field label={t('connectors.exposure')} hint={t('connectors.exposure.hint')}>
          <div className="flex items-center gap-2">
            <Segmented
              value={draft.exposure ?? DEFAULT_MCP_EXPOSURE}
              onChange={(exposure) => set({ exposure })}
              options={MCP_EXPOSURES.map((id) => ({ id, label: t(`connectors.exposure.${id}`) }))}
            />
            <Tip>{t('connectors.exposure.tip')}</Tip>
          </div>
        </Field>
        <Field
          label={t('connectors.saveTo')}
          hint={
            draft.scope === 'user'
              ? t('connectors.saveUser')
              : t('connectors.saveProject', { name: project ? fname(project) : t('skills.thisProject') })
          }
        >
          <Segmented
            value={draft.scope}
            onChange={(scope) => set({ scope })}
            options={[
              { id: 'user', label: t('skills.personal') },
              { id: 'project', label: t('skills.projectOpt'), disabled: !project || !!initial.originalName },
            ]}
          />
        </Field>
        <div className="flex gap-2 pt-1">
          <Button onClick={() => void save()} disabled={busy}>
            {t('connectors.save')}
          </Button>
          <Button variant="ghost" onClick={onDone}>
            {t('connectors.cancel')}
          </Button>
        </div>
      </div>
    </>
  );
}

function ConnectorDetail({
  c,
  onBack,
  onEdit,
  onRemove,
  onToggle,
}: {
  c: ConnectorInfo;
  onBack: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onToggle: (on: boolean) => void;
}) {
  const t = useT();
  return (
    <>
      <BackButton onClick={onBack}>{t('connectors.back')}</BackButton>
      <Heading
        title={c.name}
        sub={c.description || t(c.transport === 'http' ? 'connectors.remoteServer' : 'connectors.localServer')}
        action={
          <div className="flex shrink-0 items-center gap-2">
            <Switch
              checked={c.enabled}
              onCheckedChange={onToggle}
              aria-label={t(c.enabled ? 'connectors.disable' : 'connectors.enable')}
            />
            <Button size="sm" variant="outline" onClick={onEdit}>
              <PencilIcon className="size-3.5" />
              {t('connectors.editBtn')}
            </Button>
            <Button size="sm" variant="outline" className="text-destructive" onClick={onRemove}>
              <Trash2Icon className="size-3.5" />
              {t('connectors.deleteBtn')}
            </Button>
          </div>
        }
      />
      <div className="mb-4 rounded-xl border bg-card px-4 py-3 text-sm">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{t(c.scope === 'user' ? 'skills.personal' : 'skills.projectOpt')}</Badge>
          <Badge variant="secondary">{c.transport === 'http' ? 'HTTP' : 'stdio'}</Badge>
        </div>
        <div className="mt-2 font-mono text-xs break-all text-muted-foreground">{c.target}</div>
      </div>
      <h3 className="mb-2 text-sm font-medium text-muted-foreground">
        {t('connectors.tools')}
        {c.tools.length ? ` · ${c.tools.length}` : ''}
      </h3>
      <Panel>
        {c.tools.map((tool) => (
          <div key={tool.name} className="px-4 py-2.5">
            <div className="font-mono text-sm">{tool.name}</div>
            {tool.description && (
              <div className="mt-0.5 line-clamp-3 text-xs text-muted-foreground">{tool.description}</div>
            )}
          </div>
        ))}
        {!c.tools.length && <Empty>{t('connectors.noTools')}</Empty>}
      </Panel>
    </>
  );
}

export function ConnectorsSection({ catalog, project, onCatalog }: Props) {
  const t = useT();
  const [open, setOpen] = useState<{ name: string; scope: 'user' | 'project' } | null>(null);
  const [form, setForm] = useState<ConnectorDraft | null>(null);
  const run = async (fn: () => Promise<CustomizeCatalog>) => {
    try {
      onCatalog(await fn());
    } catch (err) {
      toast.error(errText(err));
    }
  };

  if (form)
    return <ConnectorForm project={project} initial={form} onCatalog={onCatalog} onDone={() => setForm(null)} />;
  const current = open && catalog.connectors.find((c) => c.name === open.name && c.scope === open.scope);
  if (current) {
    const edit = (): ConnectorDraft => ({
      originalName: current.name,
      name: current.name,
      scope: current.scope,
      transport: current.transport,
      command: current.command ?? '',
      args: current.args ?? [],
      url: current.url ?? '',
      pairs: current.pairs,
      description: current.description ?? '',
      exposure: current.exposure,
    });
    return (
      <ConnectorDetail
        c={current}
        onBack={() => setOpen(null)}
        onEdit={() => setForm(edit())}
        onRemove={async () => {
          if (
            !(await dialogs.confirm(
              t('connectors.confirmTitle', { name: current.name }),
              t('connectors.confirmBody'),
              t('connectors.deleteBtn'),
              true,
            ))
          )
            return;
          await run(() => call('customize:connectorRemove', current.name, current.scope, project));
          setOpen(null);
        }}
        onToggle={(on) =>
          void run(() => call('customize:connectorSetEnabled', current.name, current.scope, on, project))
        }
      />
    );
  }

  return (
    <>
      <Heading
        title={t('connectors.title')}
        sub={t('connectors.sub')}
        tip={t('connectors.tip')}
        action={
          <Button size="sm" className="shrink-0" onClick={() => setForm({ ...blank })}>
            <PlusIcon className="size-4" />
            {t('connectors.add')}
          </Button>
        }
      />
      <Panel>
        {catalog.connectors.map((c) => (
          <div key={`${c.scope}:${c.name}`} className="flex items-center gap-3 px-4 py-3">
            <button
              className="flex min-w-0 flex-1 items-start gap-3 text-left"
              onClick={() => setOpen({ name: c.name, scope: c.scope })}
            >
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
                <PlugZapIcon className="size-4 text-muted-foreground" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-sm font-medium">{c.name}</span>
                  <Badge variant="secondary">{t(c.scope === 'user' ? 'skills.personal' : 'skills.projectOpt')}</Badge>
                  {c.tools.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {t('connectors.nTools', { n: c.tools.length })}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">
                  {c.description || c.target}
                </span>
              </span>
            </button>
            <Switch
              checked={c.enabled}
              onCheckedChange={(on) =>
                void run(() => call('customize:connectorSetEnabled', c.name, c.scope, on, project))
              }
              aria-label={t(c.enabled ? 'connectors.disable' : 'connectors.enable')}
            />
          </div>
        ))}
        {!catalog.connectors.length && <Empty>{t('connectors.empty')}</Empty>}
      </Panel>
    </>
  );
}
