// Remote access: one Pi Desktop (or a plain pi with the `pi-remote` plugin) serves its sessions over
// HTTP, and another Pi Desktop drives them. Everything the UI does is already one typed call into the
// agent host plus one stream of host events, so the wire protocol is exactly that:
//
//   POST /v1/rpc     { method, args }  →  { ok, value } | { ok: false, error }
//   GET  /v1/events  Server-Sent Events, one `HostEvent` per message
//   GET  /v1/ping    who is there (no token needed)
//
// Every request except the ping carries `Authorization: Bearer <token>`. The token is full control of
// the machine (sessions run shell commands), so it is a secret, and the server listens on loopback
// unless the owner opts in to the network.
import { HOST_CHANNELS } from './protocol';

export const REMOTE_API_VERSION = 1;
export const REMOTE_DEFAULT_PORT = 7431;
/** Unprivileged ports only. */
export const REMOTE_PORT_RANGE = { min: 1024, max: 65535 } as const;
export const isRemotePort = (port: unknown): port is number =>
  Number.isInteger(port) && (port as number) >= REMOTE_PORT_RANGE.min && (port as number) <= REMOTE_PORT_RANGE.max;
export const REMOTE_PATHS = { ping: '/v1/ping', rpc: '/v1/rpc', events: '/v1/events' } as const;
/** An SSE comment line keeps idle proxies and NATs from closing the stream. */
export const REMOTE_HEARTBEAT_MS = 15_000;
/** A silent stream for this long means the link is dead even though the socket looks open. */
export const REMOTE_STALE_MS = REMOTE_HEARTBEAT_MS * 3;
export const REMOTE_RETRY_MS = { min: 1000, max: 15_000 } as const;
export const REMOTE_MAX_BODY_BYTES = 32 * 1024 * 1024;

/** What serves the sessions on the other end. */
export type RemoteKind = 'desktop' | 'plugin';

export interface RemotePing {
  app: 'pi-remote';
  version: number;
  kind: RemoteKind;
  /** The machine's name, shown in the connection list. */
  host: string;
  platform: string;
}

/** The calls beyond the agent host's own: the workspace lists live with whoever serves them. */
export const REMOTE_WORKSPACE_METHODS = [
  'projects:list',
  'projects:addPath',
  'projects:remove',
  'work:folders',
  'work:addPath',
  'work:useFolder',
  'work:removeFolder',
  'work:update',
  'remote:browse',
] as const;
export type RemoteWorkspaceMethod = (typeof REMOTE_WORKSPACE_METHODS)[number];

/** Calls that move file contents between the machines: what the client's own disk holds can't be read by the server. */
export const REMOTE_TRANSFER_METHODS = ['attachments:upload', 'artifacts:site'] as const;
export type RemoteTransferMethod = (typeof REMOTE_TRANSFER_METHODS)[number];
export const isTransferMethod = (method: string): method is RemoteTransferMethod =>
  (REMOTE_TRANSFER_METHODS as readonly string[]).includes(method);

/** Terminal tabs run on the serving machine. Only a Desktop serves them: a plain pi has no pseudo-terminal. */
export const REMOTE_TERMINAL_METHODS = [
  'terminal:list',
  'terminal:create',
  'terminal:attach',
  'terminal:text',
  'terminal:write',
  'terminal:resize',
  'terminal:close',
] as const;
export type RemoteTerminalMethod = (typeof REMOTE_TERMINAL_METHODS)[number];
export const isTerminalMethod = (method: string): method is RemoteTerminalMethod =>
  (REMOTE_TERMINAL_METHODS as readonly string[]).includes(method);
/** Whether the other end can run terminals. */
export const remoteHasTerminals = (kind: RemoteKind) => kind === 'desktop';

/** How long a file a client uploaded stays on the server's disk. */
export const REMOTE_UPLOAD_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
/** Raw bytes of one upload call; base64 and the JSON around it must stay under `REMOTE_MAX_BODY_BYTES`. */
export const REMOTE_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
/** Raw bytes of the files of one artifact a client may fetch for its preview. */
export const REMOTE_ARTIFACT_MAX_BYTES = 16 * 1024 * 1024;

/** One file a client sends to attach to a prompt. */
export interface RemoteUpload {
  name: string;
  /** Base64. */
  data: string;
}

/** The page of an artifact, as the client fetches it for a preview. */
export interface RemoteArtifactSite {
  version: number;
  /** Left out when the client already holds this version. */
  files?: { rel: string; data: string }[];
}

/** Calls that need the serving machine's own UI (browser logins) and so are never served. */
const NOT_SERVED: ReadonlySet<string> = new Set(['models:login', 'models:loginRespond', 'models:loginCancel']);

const SERVED: ReadonlySet<string> = new Set<string>(
  [...HOST_CHANNELS, ...REMOTE_WORKSPACE_METHODS, ...REMOTE_TRANSFER_METHODS, ...REMOTE_TERMINAL_METHODS].filter(
    (m) => !NOT_SERVED.has(m),
  ),
);
export const isServedMethod = (method: unknown): method is string => typeof method === 'string' && SERVED.has(method);

export interface RemoteRpcRequest {
  method: string;
  args: unknown[];
}
export type RemoteRpcResponse = { ok: true; value: unknown } | { ok: false; error: string };

/** One directory listing for the folder prompt of a remote project. */
export interface RemoteListing {
  path: string;
  parent: string | null;
  dirs: { name: string; path: string }[];
}

// ------------------------------------------------------------ the machine that serves

/** Persisted choice of the machine that serves its sessions. */
export interface RemoteServeSettings {
  enabled: boolean;
  port: number;
  /** Listen on every interface; off keeps the server on 127.0.0.1 (use an SSH or VPN tunnel). */
  lan: boolean;
  /** Also publish it through a Cloudflare quick tunnel (needs `cloudflared`), for reaching it from outside the network. */
  tunnel: boolean;
  token: string;
}
export interface RemoteServeState extends RemoteServeSettings {
  /** The server is accepting connections. */
  listening: boolean;
  /** Why it could not start. */
  error?: string;
  /** Addresses a client can try, for the owner to copy. */
  urls: string[];
  clients: number;
  tunnelState: 'off' | 'starting' | 'ready' | 'error';
  /** The public https address while the tunnel is up. */
  tunnelUrl?: string;
  tunnelError?: string;
  /** Folder of the bundled `pi-remote` plugin, for `pi install`; null when it is not on disk. */
  pluginDir: string | null;
}

// ------------------------------------------------------------ the machine that connects

/** A saved remote: where it is and the secret that opens it. */
export interface RemoteConnection {
  id: string;
  name: string;
  url: string;
  token: string;
}
/** Connection list entry for the UI: the token never leaves the main process. */
export type RemoteConnectionInfo = Omit<RemoteConnection, 'token'> & { hasToken: boolean };
export interface RemoteConnectionDraft {
  id?: string;
  name: string;
  url: string;
  /** Omitted when editing keeps the stored token. */
  token?: string;
}

export type RemoteLinkState = 'connecting' | 'connected' | 'reconnecting';
/** Which remote the windows are currently showing, if any. */
export interface RemoteActive {
  id: string;
  name: string;
  kind: RemoteKind;
  host: string;
  state: RemoteLinkState;
}

/** `http://host:port` from whatever the user typed (a bare `host:port` is fine). */
export function normalizeRemoteUrl(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error('Enter the address of the remote.');
  const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('The address must start with http:// or https://.');
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}
