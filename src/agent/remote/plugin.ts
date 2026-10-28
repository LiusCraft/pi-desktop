// `pi-remote`: the pi extension that lets another Pi Desktop drive sessions on a machine that has only the
// pi CLI. `/remote start` runs a session hub inside the pi process (sharing pi's logins and models) and
// serves it with the same remote protocol Pi Desktop serves, so the Desktop connects to either alike.
import os from 'node:os';
import path from 'node:path';
import { getAgentDir, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { HOST_CHANNELS } from '@shared/protocol';
import { tr } from '@shared/i18n/runtime';
import { isRemotePort, isTerminalMethod, isTransferMethod, REMOTE_DEFAULT_PORT, REMOTE_PORT_RANGE, REMOTE_WORKSPACE_METHODS, type RemoteServeSettings, type RemoteWorkspaceMethod } from '@shared/remote';
import { sessionHandlers } from '../handlers';
import { SessionHub } from '../hub';
import { Store } from '../store';
import { newRemoteToken, remoteUrls, RemoteServer } from './server';
import { transferCall } from './transfer';
import { Tunnel } from './tunnel';
import { ProjectBook, workspaceCall } from './workspace';

const ENV_HOME = 'PI_REMOTE_HOME';
const HOME_DIR_NAME = '.pi-remote';
const CONFIG_KEY = 'remote';
const AUTOSTART_FLAG = 'remote';
const COMMAND = 'remote';

type Config = Pick<RemoteServeSettings, 'port' | 'lan' | 'tunnel' | 'token'>;

/** Where the plugin keeps its own state (session list, config); pi's own folder is left alone. */
const homeDir = () => process.env[ENV_HOME]?.trim() || path.join(os.homedir(), HOME_DIR_NAME);

interface Running {
  server: RemoteServer;
  hub: SessionHub;
  config: Config;
  tunnel: Tunnel;
  /** Public address once the tunnel is up. */
  tunnelUrl?: string;
  tunnelError?: string;
}

/**
 * The running server outlives the extension runtime: /reload builds a new one, which must find the old
 * server (still holding the port) instead of racing it. Quitting pi is what ends the served sessions.
 */
const RUNNING = Symbol.for('pi-remote.running');
const shared = globalThis as { [RUNNING]?: Running | null };

export default function piRemote(pi: ExtensionAPI) {
  const state = {
    get running() { return shared[RUNNING] ?? null; },
    set running(value: Running | null) { shared[RUNNING] = value; },
  };
  const store = () => new Store(homeDir());

  function config(patch: Partial<Config> = {}): Config {
    const s = store();
    const saved = s.get<Partial<Config>>(CONFIG_KEY, {});
    const next: Config = { port: saved.port ?? REMOTE_DEFAULT_PORT, lan: saved.lan === true, tunnel: saved.tunnel === true, token: saved.token || newRemoteToken(), ...patch };
    if (!saved.token || Object.keys(patch).length) s.set(CONFIG_KEY, next);
    return next;
  }

  async function start(patch: Partial<Config>): Promise<Running> {
    if (state.running) await stop();
    const cfg = config(patch);
    const dataDir = homeDir();
    const book = new ProjectBook(new Store(dataDir));
    let server!: RemoteServer;
    const hub = new SessionHub({ dataDir, agentDir: getAgentDir(), emit: (event) => server.publish(event) });
    const ready = hub.init().then(() => hub);
    const handlers = sessionHandlers(ready, () => null);
    server = new RemoteServer({
      token: cfg.token,
      port: cfg.port,
      lan: cfg.lan,
      backend: {
        kind: 'plugin',
        call: async (method, args) => {
          if (isTerminalMethod(method)) throw new Error(tr('remote.terminal.unavailable'));
          if (isTransferMethod(method)) return transferCall(dataDir, method, args);
          if ((REMOTE_WORKSPACE_METHODS as readonly string[]).includes(method)) return workspaceCall(book, method as RemoteWorkspaceMethod, args);
          const handler = handlers[method as (typeof HOST_CHANNELS)[number]];
          if (!handler) throw new Error(`Unknown method: ${method}`);
          return handler(...args);
        },
      },
    });
    await ready;
    await server.start();
    const tunnel = new Tunnel();
    const current: Running = { server, hub, config: cfg, tunnel };
    state.running = current;
    if (cfg.tunnel) {
      const result = await tunnel.start(server.port);
      current.tunnelUrl = result.url;
      if (result.state === 'error') current.tunnelError = result.error;
    }
    return current;
  }

  async function stop() {
    const current = state.running;
    state.running = null;
    if (!current) return;
    current.tunnel.stop();
    await current.server.stop();
    await current.hub.shutdown();
  }

  function describe(r: Running) {
    const urls = [...(r.tunnelUrl ? [r.tunnelUrl] : []), ...remoteUrls(r.config.port, r.config.lan)];
    return [
      `Remote access is on (${r.config.lan ? 'all network interfaces' : 'this machine only'}).`,
      ...urls.map((u) => `  ${u}`),
      ...(r.tunnelError ? [`Tunnel failed: ${r.tunnelError}`] : []),
      `Access token: ${r.config.token}`,
      'Add it in Pi Desktop: Settings → Remote → Connect to a remote.',
    ].join('\n');
  }

  pi.registerFlag(AUTOSTART_FLAG, { description: 'Serve sessions to remote Pi Desktop clients on start', type: 'boolean', default: false });

  pi.registerCommand(COMMAND, {
    description: 'Remote access for Pi Desktop: start [--lan] [--tunnel] [--port N] | stop | status | token | rotate',
    handler: async (args, ctx) => {
      const [sub = 'status', ...rest] = args.trim().split(/\s+/).filter(Boolean);
      try {
        if (sub === 'start') {
          const patch: Partial<Config> = {};
          if (rest.includes('--lan')) patch.lan = true;
          if (rest.includes('--local')) patch.lan = false;
          if (rest.includes('--tunnel')) patch.tunnel = true;
          if (rest.includes('--no-tunnel')) patch.tunnel = false;
          const at = rest.indexOf('--port');
          if (at >= 0) {
            const port = Number(rest[at + 1]);
            if (!isRemotePort(port)) throw new Error(`--port needs a number between ${REMOTE_PORT_RANGE.min} and ${REMOTE_PORT_RANGE.max}.`);
            patch.port = port;
          }
          ctx.ui.notify(describe(await start(patch)), 'info');
        } else if (sub === 'stop') {
          await stop();
          ctx.ui.notify('Remote access is off.', 'info');
        } else if (sub === 'rotate') {
          const was = state.running;
          const cfg = config({ token: newRemoteToken() });
          if (was) ctx.ui.notify(describe(await start({ token: cfg.token })), 'info');
          else ctx.ui.notify(`New access token: ${cfg.token}`, 'info');
        } else if (sub === 'token') {
          ctx.ui.notify(`Access token: ${config().token}`, 'info');
        } else if (sub === 'status') {
          ctx.ui.notify(state.running ? `${describe(state.running)}\nConnected clients: ${state.running.server.clients}` : 'Remote access is off. Run /remote start.', 'info');
        } else {
          ctx.ui.notify(`Unknown option "${sub}". Use: start [--lan] [--tunnel] [--port N] | stop | status | token | rotate`, 'warning');
        }
      } catch (err) {
        ctx.ui.notify(err instanceof Error ? err.message : String(err), 'error');
      }
    },
  });

  pi.on('session_start', async (_event, ctx) => {
    if (pi.getFlag(AUTOSTART_FLAG) !== true || state.running) return;
    try {
      ctx.ui.notify(describe(await start({})), 'info');
    } catch (err) {
      ctx.ui.notify(`Remote access could not start: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  });
}
