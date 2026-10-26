// Customize → Connectors: MCP servers from pi's mcp.json (personal) and <project>/.pi/mcp.json.
// Pi connects to enabled servers when a session starts, so changes apply to new sessions.
import { useState } from 'react';
import { PencilIcon, PlugZapIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import type { ConnectorDraft, ConnectorInfo, CustomizeCatalog } from '@shared/protocol';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { call, errText } from '@/lib/api';
import { fname } from '@/lib/format';
import { dialogs } from '@/store/dialogs';
import { BackButton, Empty, Field, Heading, Panel, Segmented } from './ui';

interface Props {
  catalog: CustomizeCatalog;
  project: string | null;
  onCatalog: (c: CustomizeCatalog) => void;
}

const blank: ConnectorDraft = { name: '', scope: 'user', transport: 'stdio', command: '', args: [], url: '', pairs: [], description: '' };

/** A command line the way a person types it: quoted parts stay together. */
const splitArgs = (line: string) => [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
const joinArgs = (args: string[] = []) => args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ');

function ConnectorForm({ project, initial, onDone, onCatalog }: Omit<Props, 'catalog'> & { initial: ConnectorDraft; onDone: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [args, setArgs] = useState(joinArgs(initial.args));
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<ConnectorDraft>) => setDraft({ ...draft, ...patch });
  const http = draft.transport === 'http';
  const save = async () => {
    setBusy(true);
    try {
      const body: ConnectorDraft = { ...draft, args: splitArgs(args), pairs: (draft.pairs ?? []).filter((l) => l.trim()) };
      onCatalog(await call('customize:connectorSave', body, project));
      toast.success('已保存，新建的会话会连接它');
      onDone();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <BackButton onClick={onDone}>返回连接器列表</BackButton>
      <Heading title={initial.originalName ? `编辑 ${initial.originalName}` : '添加连接器'} sub="连接器是 MCP 服务器：给模型多一批可以调用的工具，比如搜索、数据库、浏览器。" />
      <div className="space-y-4 rounded-xl border bg-card p-4">
        <Field label="类型">
          <Segmented value={draft.transport} onChange={(transport) => set({ transport, pairs: [] })} options={[{ id: 'stdio', label: '本地命令' }, { id: 'http', label: '远程地址' }]} />
        </Field>
        <Field label="名称" hint="字母、数字、- 和 _；工具会以 mcp__名称__工具 的形式出现。">
          <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="filesystem" spellCheck={false} />
        </Field>
        {http ? (
          <>
            <Field label="地址" hint="支持 streamable HTTP 的 MCP 地址，通常以 /mcp 结尾。">
              <Input value={draft.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://example.com/mcp" spellCheck={false} />
            </Field>
            <Field label="请求头" hint="每行一个，格式 Name: value；值里可以写 ${ENV_VAR}。">
              <Textarea value={(draft.pairs ?? []).join('\n')} onChange={(e) => set({ pairs: e.target.value.split('\n') })} rows={3} className="font-mono text-xs" placeholder={'Authorization: Bearer ${DOCS_TOKEN}'} />
            </Field>
          </>
        ) : (
          <>
            <Field label="命令">
              <Input value={draft.command} onChange={(e) => set({ command: e.target.value })} placeholder="npx" spellCheck={false} />
            </Field>
            <Field label="参数" hint="用空格分隔，带空格的参数用引号括起来。">
              <Input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-y @modelcontextprotocol/server-filesystem ." spellCheck={false} />
            </Field>
            <Field label="环境变量" hint="每行一个，格式 KEY=value；值里可以写 ${ENV_VAR}。">
              <Textarea value={(draft.pairs ?? []).join('\n')} onChange={(e) => set({ pairs: e.target.value.split('\n') })} rows={3} className="font-mono text-xs" placeholder="API_KEY=${MY_KEY}" />
            </Field>
          </>
        )}
        <Field label="说明（可选）">
          <Input value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="Search and read the product documentation" />
        </Field>
        <Field label="保存位置" hint={draft.scope === 'user' ? '所有项目都会连接，写入 pi 的 mcp.json。' : `只在 ${project ? fname(project) : '当前项目'} 里连接，写入项目的 .pi/mcp.json。`}>
          <Segmented value={draft.scope} onChange={(scope) => set({ scope })} options={[{ id: 'user', label: '个人' }, { id: 'project', label: '项目', disabled: !project || !!initial.originalName }]} />
        </Field>
        <div className="flex gap-2 pt-1">
          <Button onClick={() => void save()} disabled={busy}>保存</Button>
          <Button variant="ghost" onClick={onDone}>取消</Button>
        </div>
      </div>
    </>
  );
}

function ConnectorDetail({ c, onBack, onEdit, onRemove, onToggle }: { c: ConnectorInfo; onBack: () => void; onEdit: () => void; onRemove: () => void; onToggle: (on: boolean) => void }) {
  return (
    <>
      <BackButton onClick={onBack}>返回连接器列表</BackButton>
      <Heading
        title={c.name}
        sub={c.description || (c.transport === 'http' ? '远程 MCP 服务器' : '本地 MCP 服务器')}
        action={
          <div className="flex shrink-0 items-center gap-2">
            <Switch checked={c.enabled} onCheckedChange={onToggle} aria-label={c.enabled ? '停用' : '启用'} />
            <Button size="sm" variant="outline" onClick={onEdit}><PencilIcon className="size-3.5" />编辑</Button>
            <Button size="sm" variant="outline" className="text-destructive" onClick={onRemove}><Trash2Icon className="size-3.5" />删除</Button>
          </div>
        }
      />
      <div className="mb-4 rounded-xl border bg-card px-4 py-3 text-sm">
        <div className="flex items-center gap-2"><Badge variant="secondary">{c.scope === 'user' ? '个人' : '项目'}</Badge><Badge variant="secondary">{c.transport === 'http' ? 'HTTP' : 'stdio'}</Badge></div>
        <div className="mt-2 break-all font-mono text-xs text-muted-foreground">{c.target}</div>
      </div>
      <h3 className="mb-2 text-sm font-medium text-muted-foreground">工具{c.tools.length ? ` · ${c.tools.length}` : ''}</h3>
      <Panel>
        {c.tools.map((t) => (
          <div key={t.name} className="px-4 py-2.5">
            <div className="font-mono text-sm">{t.name}</div>
            {t.description && <div className="mt-0.5 line-clamp-3 text-xs text-muted-foreground">{t.description}</div>}
          </div>
        ))}
        {!c.tools.length && <Empty>还没有记录到工具。pi 第一次成功连接这个服务器之后，这里会列出它的工具。</Empty>}
      </Panel>
    </>
  );
}

export function ConnectorsSection({ catalog, project, onCatalog }: Props) {
  const [open, setOpen] = useState<{ name: string; scope: 'user' | 'project' } | null>(null);
  const [form, setForm] = useState<ConnectorDraft | null>(null);
  const run = async (fn: () => Promise<CustomizeCatalog>) => {
    try {
      onCatalog(await fn());
    } catch (err) {
      toast.error(errText(err));
    }
  };

  if (form) return <ConnectorForm project={project} initial={form} onCatalog={onCatalog} onDone={() => setForm(null)} />;
  const current = open && catalog.connectors.find((c) => c.name === open.name && c.scope === open.scope);
  if (current) {
    const edit = (): ConnectorDraft => ({
      originalName: current.name, name: current.name, scope: current.scope, transport: current.transport,
      command: current.command ?? '', args: current.args ?? [], url: current.url ?? '', pairs: current.pairs, description: current.description ?? '',
    });
    return (
      <ConnectorDetail
        c={current}
        onBack={() => setOpen(null)}
        onEdit={() => setForm(edit())}
        onRemove={async () => {
          if (!(await dialogs.confirm(`删除 ${current.name}？`, '只会从配置文件里移除这个连接器，不影响服务器本身。', '删除', true))) return;
          await run(() => call('customize:connectorRemove', current.name, current.scope, project));
          setOpen(null);
        }}
        onToggle={(on) => void run(() => call('customize:connectorSetEnabled', current.name, current.scope, on, project))}
      />
    );
  }

  return (
    <>
      <Heading
        title="Connectors"
        sub="MCP 服务器：把外部工具和数据接给模型。新建的会话才会连接改动。"
        action={<Button size="sm" className="shrink-0" onClick={() => setForm({ ...blank })}><PlusIcon className="size-4" />添加连接器</Button>}
      />
      <Panel>
        {catalog.connectors.map((c) => (
          <div key={`${c.scope}:${c.name}`} className="flex items-center gap-3 px-4 py-3">
            <button className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={() => setOpen({ name: c.name, scope: c.scope })}>
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40"><PlugZapIcon className="size-4 text-muted-foreground" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-sm font-medium">{c.name}</span>
                  <Badge variant="secondary">{c.scope === 'user' ? '个人' : '项目'}</Badge>
                  {c.tools.length > 0 && <span className="text-xs text-muted-foreground">{c.tools.length} 个工具</span>}
                </span>
                <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">{c.description || c.target}</span>
              </span>
            </button>
            <Switch checked={c.enabled} onCheckedChange={(on) => void run(() => call('customize:connectorSetEnabled', c.name, c.scope, on, project))} aria-label={c.enabled ? '停用' : '启用'} />
          </div>
        ))}
        {!catalog.connectors.length && <Empty>还没有连接器。点「添加连接器」接入一个 MCP 服务器。</Empty>}
      </Panel>
    </>
  );
}
