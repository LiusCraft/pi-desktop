// The connecting end of remote access: calls and the event stream of a remote host, shaped like the
// local `AgentClient` so the main process can route the UI to either.
import type { HostEvent } from '@shared/protocol';
import {
  REMOTE_API_VERSION,
  REMOTE_PATHS,
  REMOTE_RETRY_MS,
  REMOTE_STALE_MS,
  type RemoteLinkState,
  type RemotePing,
  type RemoteRpcResponse,
} from '@shared/remote';

const PING_TIMEOUT_MS = 5000;

export interface RemoteClientOptions {
  url: string;
  token: string;
  onEvent: (event: HostEvent) => void;
  onState: (state: RemoteLinkState) => void;
}

/** Why a remote could not be used, in words for the person who typed the address. */
function reach(err: unknown): Error {
  const code = (err as { cause?: { code?: string } })?.cause?.code;
  if (code === 'ECONNREFUSED') return new Error('Connection refused: remote access is not running at that address.');
  if (code === 'ENOTFOUND') return new Error('The address could not be found.');
  if ((err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError')
    return new Error('The remote did not answer in time.');
  return err instanceof Error ? err : new Error(String(err));
}

/** Which side is the older one, in words for the person who typed the address. */
function versionMismatch(ping: RemotePing): Error {
  const there = ping.kind === 'plugin' ? 'the pi-remote plugin there' : 'Pi Desktop there';
  const version = Number.isInteger(ping.version) ? `protocol v${ping.version}` : 'an unknown protocol';
  // A server too old to send a number is the older side by definition.
  if (!Number.isInteger(ping.version) || ping.version < REMOTE_API_VERSION)
    return new Error(`That remote speaks ${version}, older than v${REMOTE_API_VERSION} here: update ${there}.`);
  return new Error(`That remote speaks ${version}, newer than v${REMOTE_API_VERSION} here: update Pi Desktop here.`);
}

export async function pingRemote(url: string): Promise<RemotePing> {
  let res: Response;
  try {
    res = await fetch(url + REMOTE_PATHS.ping, { signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
  } catch (err) {
    throw reach(err);
  }
  const ping = (await res.json().catch(() => null)) as RemotePing | null;
  if (!ping || ping.app !== 'pi-remote') throw new Error('That address is not a Pi remote.');
  // The plugin is published on its own and the app ships a copy, so the two sides are updated separately.
  if (ping.version !== REMOTE_API_VERSION) throw versionMismatch(ping);
  return ping;
}

export class RemoteClient {
  private abort: AbortController | null = null;
  private closed = false;
  private state: RemoteLinkState = 'connecting';
  /** A freshly opened stream waiting for the read loop to take it. */
  private pending: Response | null = null;

  constructor(private readonly options: RemoteClientOptions) {}

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.options.token}` };
  }

  async call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.options.url + REMOTE_PATHS.rpc, {
        method: 'POST',
        headers: { ...this.headers(), 'content-type': 'application/json' },
        body: JSON.stringify({ method, args }),
      });
    } catch (err) {
      throw reach(err);
    }
    const body = (await res.json().catch(() => null)) as RemoteRpcResponse | null;
    if (!body) throw new Error(`The remote answered with HTTP ${res.status}.`);
    if (!body.ok) throw new Error(body.error);
    return body.value as T;
  }

  /** Open the event stream (and keep it open). Resolves once the first connection is up, rejects when the token is refused. */
  async start(): Promise<void> {
    this.closed = false;
    await this.connect();
    void this.pump();
  }

  private set(state: RemoteLinkState) {
    if (this.state === state) return;
    this.state = state;
    this.options.onState(state);
  }

  /** One attempt at the stream. */
  private async connect() {
    const abort = new AbortController();
    this.abort = abort;
    let res: Response;
    try {
      res = await fetch(this.options.url + REMOTE_PATHS.events, { headers: this.headers(), signal: abort.signal });
    } catch (err) {
      throw reach(err);
    }
    if (res.status === 401) throw new Error('Wrong access token.');
    if (!res.ok || !res.body) throw new Error(`The remote answered with HTTP ${res.status}.`);
    this.pending = res;
    this.set('connected');
  }

  private async pump() {
    let delay: number = REMOTE_RETRY_MS.min;
    while (!this.closed) {
      const res = this.pending;
      this.pending = null;
      if (res) {
        delay = REMOTE_RETRY_MS.min;
        await this.read(res);
        if (this.closed) return;
        this.set('reconnecting');
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, REMOTE_RETRY_MS.max);
      if (this.closed) return;
      try {
        await this.connect();
      } catch (err) {
        if ((err as Error).message === 'Wrong access token.') {
          // The token was rotated on the other side: retrying cannot help.
          this.options.onEvent({
            type: 'notify',
            sessionId: '',
            message: 'The remote refused the access token.',
            level: 'error',
          });
        }
        this.set('reconnecting');
      }
    }
  }

  /** Read events until the stream ends, errors, or goes silent. */
  private async read(res: Response) {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let stale: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(stale);
      stale = setTimeout(() => this.abort?.abort(), REMOTE_STALE_MS);
    };
    arm();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        arm();
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = frame
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trimStart())
            .join('\n');
          if (!data) continue;
          try {
            this.options.onEvent(JSON.parse(data) as HostEvent);
          } catch {
            // A frame that is not JSON is skipped; the stream carries on.
          }
        }
      }
    } catch {
      // Aborted or reset: the caller reconnects.
    } finally {
      clearTimeout(stale);
    }
  }

  close() {
    this.closed = true;
    this.abort?.abort();
  }
}
