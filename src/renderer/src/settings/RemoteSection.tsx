// Settings → Remote: share this machine's sessions with another Pi Desktop, and connect to someone else's
// (a Pi Desktop, or a plain pi running the `pi-remote` plugin).
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { RemoteActive, RemoteConnectionDraft, RemoteConnectionInfo, RemoteServeState } from '@shared/remote';
import { REMOTE_DEFAULT_PORT } from '@shared/remote';
import { useCopy } from '@/components/common/Copy';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { call, errText } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Group, Heading, Panel, Row } from './ui';

const POLL_MS = 3000;
// The plugin's npm name (plugin/pi-remote/package.json); `pi install npm:<name>` fetches it.
const PLUGIN_INSTALL = 'pi install npm:@liuscraft/pi-remote';
const PLUGIN_START = '/remote start --lan';

const fail = (err: unknown) => toast.error(errText(err));

function ServePanel() {
  const t = useT();
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
    <Group title={t('remote.serve.title')} sub={t('remote.serve.sub')} tip={t('remote.serve.tip')}>
      <Panel>
        <Row title={t('remote.allow')} hint={state.error ? <span className="text-destructive">{state.error}</span> : state.listening ? t('remote.listening', { n: state.clients }) : t('remote.notListening')}>
          <Switch checked={state.enabled} onCheckedChange={(v) => void patch({ enabled: v })} />
        </Row>
        <Row title={t('remote.lan')} hint={t('remote.lan.hint')} tip={t('remote.lan.tip')}>
          <Switch checked={state.lan} onCheckedChange={(v) => void patch({ lan: v })} />
        </Row>
        <Row
          title={t('remote.tunnel')}
          hint={
            state.tunnelState === 'error' ? <span className="text-destructive">{state.tunnelError}</span>
              : state.tunnelState === 'starting' ? t('remote.tunnel.starting')
                : state.tunnelState === 'ready' ? t('remote.tunnel.ready')
                  : t('remote.tunnel.idle')
          }
        >
          <Switch checked={state.tunnel} onCheckedChange={(v) => void patch({ tunnel: v })} />
        </Row>
        <Row title={t('remote.port')}>
          <Input className="h-8 w-24 font-mono" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} placeholder={String(REMOTE_DEFAULT_PORT)} />
          <Button size="sm" variant="outline" disabled={!portValue || portValue === state.port} onClick={() => void patch({ port: portValue })}>{t('remote.apply')}</Button>
        </Row>
        <Row title={t('remote.token')} hint={t('remote.token.hint')} tip={t('remote.token.tip')} col>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-2.5 py-1.5 font-mono text-xs">{shown}</code>
            <Button size="sm" variant="outline" onClick={() => setReveal((v) => !v)}>{reveal ? t('remote.hide') : t('remote.show')}</Button>
            <Button size="sm" variant="outline" onClick={() => copy(state.token)}>{copied ? t('remote.copied') : t('remote.copy')}</Button>
            <Button size="sm" variant="ghost" onClick={() => void call('remote:serveRotate').then(setState).catch(fail)}>{t('remote.reset')}</Button>
          </div>
        </Row>
        {state.enabled && state.listening && (
          <Row title={t('remote.address')} hint={t('remote.address.hint')} col>
            <div className="space-y-1">
              {state.urls.map((u) => (
                <div key={u} className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate font-mono text-xs">{u}</code>
                  <Button size="sm" variant="ghost" onClick={() => copy(u)}>{copied ? t('remote.copied') : t('remote.copy')}</Button>
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
  const t = useT();
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
      toast.success(t('remote.connected'));
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
      title={t('remote.connect.title')}
      sub={t('remote.connect.sub')}
      tip={t('remote.connect.tip')}
      action={!draft && <Button size="sm" variant="outline" onClick={() => setDraft(EMPTY)}>{t('remote.addConnection')}</Button>}
    >
      <Panel>
        {connections.length === 0 && !draft && <Row title={t('remote.noConnections')} hint={t('remote.noConnections.hint')} />}
        {connections.map((c) => {
          const isActive = active?.id === c.id;
          return (
            <Row key={c.id} title={<span className="flex items-center gap-2">{c.name}{isActive && <span className="rounded bg-success/15 px-1.5 text-[10px] font-normal text-success">{t('remote.inUse')}</span>}</span>} hint={<span className="font-mono">{c.url}</span>}>
              {isActive ? (
                <Button size="sm" variant="outline" onClick={() => void disconnect()}>{t('remote.disconnect')}</Button>
              ) : (
                <Button size="sm" disabled={busy !== null} onClick={() => void connect(c.id)}>{busy === c.id ? t('remote.connecting') : t('remote.connect')}</Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setDraft({ id: c.id, name: c.name, url: c.url, token: '' })}>{t('remote.edit')}</Button>
              <Button size="sm" variant="ghost" onClick={() => void remove(c.id)}>{t('remote.delete')}</Button>
            </Row>
          );
        })}
        {draft && (
          <Row title={t(edit ? 'remote.editConnection' : 'remote.newConnection')} col>
            <div className="grid gap-2">
              <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder={t('remote.namePh')} />
              <Input value={draft.url} onChange={(e) => set({ url: e.target.value })} placeholder={t('remote.urlPh')} className="font-mono" />
              <Input value={draft.token ?? ''} onChange={(e) => set({ token: e.target.value })} type="password" placeholder={t(edit ? 'remote.tokenKeepPh' : 'remote.tokenPh')} className="font-mono" />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>{t('remote.cancel')}</Button>
                <Button size="sm" disabled={!draft.url.trim()} onClick={() => void save()}>{t('remote.save')}</Button>
              </div>
            </div>
          </Row>
        )}
      </Panel>
    </Group>
  );
}

function PluginPanel() {
  const t = useT();
  const { copied, copy } = useCopy();
  const commands = [PLUGIN_INSTALL, PLUGIN_START];
  return (
    <Group title={t('remote.plugin.title')} sub={t('remote.plugin.sub')} tip={t('remote.plugin.tip')}>
      <Panel>
        <Row title={t('remote.plugin.install')} col>
          <div className="space-y-1.5">
            {commands.map((c) => <code key={c} className="block rounded-md border bg-muted/40 px-2.5 py-1.5 font-mono text-xs">{c}</code>)}
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" onClick={() => copy(commands.join('\n'))}>{copied ? t('remote.copied') : t('remote.plugin.copy')}</Button>
            </div>
          </div>
        </Row>
        <Row title={t('remote.plugin.token')} hint={t('remote.plugin.token.hint')} tip={t('remote.plugin.token.tip')} />
      </Panel>
    </Group>
  );
}

export function RemoteSection() {
  const t = useT();
  return (
    <>
      <Heading title={t('remote.title')} sub={t('remote.sub')} />
      <ServePanel />
      <ConnectPanel />
      <PluginPanel />
    </>
  );
}
