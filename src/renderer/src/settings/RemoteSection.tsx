// Settings → 远程: share this machine's sessions with another Pi Desktop, and connect to someone else's
// (a Pi Desktop, or a plain pi running the `pi-remote` plugin).
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { RemoteActive, RemoteConnectionDraft, RemoteConnectionInfo, RemoteServeState } from '@shared/remote';
import { REMOTE_DEFAULT_PORT } from '@shared/remote';
import { useCopy } from '@/components/common/Copy';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { call, errText } from '@/lib/api';
import { cn } from '@/lib/utils';

const POLL_MS = 3000;
// The plugin's npm name (plugin/pi-remote/package.json); `pi install npm:<name>` fetches it.
const PLUGIN_INSTALL = 'pi install npm:@liuscraft/pi-remote';
const PLUGIN_START = '/remote start --lan';

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
function Group({ title, sub, children, action }: { title: string; sub?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="mt-7 first:mt-0">
      <div className="flex items-end justify-between gap-3 px-1">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
        </div>
        {action}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

const fail = (err: unknown) => toast.error(errText(err));

function ServePanel() {
  const [state, setState] = useState<RemoteServeState | null>(null);
  const [port, setPort] = useState('');
  const [reveal, setReveal] = useState(false);
  const { copied, copy } = useCopy();

  const load = useCallback(async () => {
    try {
      const next = await call('remote:serveGet');
      setState(next);
      setPort((p) => p || String(next.port));
    } catch (err) {
      fail(err);
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const patch = async (values: Parameters<typeof call<'remote:serveSet'>>[1]) => {
    try {
      setState(await call('remote:serveSet', values));
    } catch (err) {
      fail(err);
    }
  };
  if (!state) return null;
  const portValue = Number(port);
  const shown = reveal ? state.token : '•'.repeat(24);
  return (
    <Group title="共享这台电脑" sub="允许另一台电脑上的 Pi Desktop 使用这里的项目与会话。会话在这台电脑上运行，那边只是遥控。">
      <Panel>
        <Row title="允许远程连接" hint={state.error ? <span className="text-destructive">{state.error}</span> : state.listening ? `监听中 · ${state.clients} 个客户端已连接` : '关闭时不监听任何端口。'}>
          <Switch checked={state.enabled} onCheckedChange={(v) => void patch({ enabled: v })} />
        </Row>
        <Row title="允许局域网访问" hint="关闭时只接受本机连接（可配合 SSH 隧道 / Tailscale）。开启后同一网络里知道令牌的人都能连上；连接不加密，不要暴露到公网。">
          <Switch checked={state.lan} onCheckedChange={(v) => void patch({ lan: v })} />
        </Row>
        <Row
          title="通过 Cloudflare Tunnel 公开"
          hint={
            state.tunnelState === 'error' ? <span className="text-destructive">{state.tunnelError}</span>
              : state.tunnelState === 'starting' ? '正在建立隧道…'
                : state.tunnelState === 'ready' ? '隧道已建立，下方地址可从任何网络访问（HTTPS）。'
                  : '免账号、免端口映射：用 cloudflared 生成一个 trycloudflare.com 地址。需要先安装 cloudflared。'
          }
        >
          <Switch checked={state.tunnel} onCheckedChange={(v) => void patch({ tunnel: v })} />
        </Row>
        <Row title="端口">
          <Input className="h-8 w-24 font-mono" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} placeholder={String(REMOTE_DEFAULT_PORT)} />
          <Button size="sm" variant="outline" disabled={!portValue || portValue === state.port} onClick={() => void patch({ port: portValue })}>应用</Button>
        </Row>
        <Row title="访问令牌" hint="持有令牌就等于能在这台电脑上运行命令，请当作密码保管。重置后已连接的客户端会断开。" col>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-2.5 py-1.5 font-mono text-xs">{shown}</code>
            <Button size="sm" variant="outline" onClick={() => setReveal((v) => !v)}>{reveal ? '隐藏' : '显示'}</Button>
            <Button size="sm" variant="outline" onClick={() => copy(state.token)}>{copied ? '已复制' : '复制'}</Button>
            <Button size="sm" variant="ghost" onClick={() => void call('remote:serveRotate').then(setState).catch(fail)}>重置</Button>
          </div>
        </Row>
        {state.enabled && state.listening && (
          <Row title="连接地址" hint="在另一台电脑的 Pi Desktop 里添加连接时填写。" col>
            <div className="space-y-1">
              {state.urls.map((u) => (
                <div key={u} className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate font-mono text-xs">{u}</code>
                  <Button size="sm" variant="ghost" onClick={() => copy(u)}>{copied ? '已复制' : '复制'}</Button>
                </div>
              ))}
            </div>
          </Row>
        )}
      </Panel>
    </Group>
  );
}

const EMPTY: RemoteConnectionDraft = { name: '', url: '', token: '' };

function ConnectPanel() {
  const [connections, setConnections] = useState<RemoteConnectionInfo[]>([]);
  const [active, setActive] = useState<RemoteActive | null>(null);
  const [draft, setDraft] = useState<RemoteConnectionDraft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await call('remote:list');
      setConnections(r.connections);
      setActive(r.active);
    } catch (err) {
      fail(err);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!draft) return;
    try {
      setConnections(await call('remote:save', draft));
      setDraft(null);
    } catch (err) {
      fail(err);
    }
  };
  const connect = async (id: string) => {
    setBusy(id);
    try {
      setActive(await call('remote:connect', id));
      toast.success('已连接，主窗口已切换到远程会话');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };
  const disconnect = async () => {
    try {
      await call('remote:disconnect');
      setActive(null);
    } catch (err) {
      fail(err);
    }
  };
  const remove = async (id: string) => {
    try {
      setConnections(await call('remote:remove', id));
      if (active?.id === id) setActive(null);
    } catch (err) {
      fail(err);
    }
  };
  const edit = draft && draft.id ? draft : null;
  const set = (patch: Partial<RemoteConnectionDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  return (
    <Group
      title="连接到远程"
      sub="切换后主窗口显示对方的项目与会话；断开后回到这台电脑。"
      action={!draft && <Button size="sm" variant="outline" onClick={() => setDraft(EMPTY)}>添加连接…</Button>}
    >
      <Panel>
        {connections.length === 0 && !draft && <Row title="还没有连接" hint="添加另一台电脑的地址和访问令牌。" />}
        {connections.map((c) => {
          const isActive = active?.id === c.id;
          return (
            <Row key={c.id} title={<span className="flex items-center gap-2">{c.name}{isActive && <span className="rounded bg-success/15 px-1.5 text-[10px] font-normal text-success">使用中</span>}</span>} hint={<span className="font-mono">{c.url}</span>}>
              {isActive ? (
                <Button size="sm" variant="outline" onClick={() => void disconnect()}>断开</Button>
              ) : (
                <Button size="sm" disabled={busy !== null} onClick={() => void connect(c.id)}>{busy === c.id ? '连接中…' : '连接'}</Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setDraft({ id: c.id, name: c.name, url: c.url, token: '' })}>编辑</Button>
              <Button size="sm" variant="ghost" onClick={() => void remove(c.id)}>删除</Button>
            </Row>
          );
        })}
        {draft && (
          <Row title={edit ? '编辑连接' : '添加连接'} col>
            <div className="grid gap-2">
              <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="名称（可选，如：办公室台式机）" />
              <Input value={draft.url} onChange={(e) => set({ url: e.target.value })} placeholder="地址，如 192.168.1.20:7431" className="font-mono" />
              <Input value={draft.token ?? ''} onChange={(e) => set({ token: e.target.value })} type="password" placeholder={edit ? '访问令牌（留空保持不变）' : '访问令牌'} className="font-mono" />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>取消</Button>
                <Button size="sm" disabled={!draft.url.trim()} onClick={() => void save()}>保存</Button>
              </div>
            </div>
          </Row>
        )}
      </Panel>
    </Group>
  );
}

function PluginPanel() {
  const { copied, copy } = useCopy();
  const commands = [PLUGIN_INSTALL, PLUGIN_START];
  return (
    <Group title="没有安装 Pi Desktop 的电脑" sub="只装了 pi 命令行也可以被遥控：安装 pi-remote 插件，在 pi 里启动远程服务，再用上面的方式连接。">
      <Panel>
        <Row title="安装并启动" col>
          <div className="space-y-1.5">
            {commands.map((c) => <code key={c} className="block rounded-md border bg-muted/40 px-2.5 py-1.5 font-mono text-xs">{c}</code>)}
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" onClick={() => copy(commands.join('\n'))}>{copied ? '已复制' : '复制命令'}</Button>
            </div>
          </div>
        </Row>
        <Row title="令牌与地址" hint="启动后 pi 会显示地址和访问令牌；/remote status、/remote token 可随时再看。pi 退出后服务随之停止。" />
      </Panel>
    </Group>
  );
}

export function RemoteSection() {
  return (
    <>
      <Heading title="远程" sub="用一台电脑遥控另一台电脑上的 Pi 会话。" />
      <ServePanel />
      <ConnectPanel />
      <PluginPanel />
    </>
  );
}
