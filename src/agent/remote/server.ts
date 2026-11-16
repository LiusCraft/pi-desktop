// The serving end of remote access: an HTTP server in front of whatever answers the agent host's calls
// (the Desktop's host process, or a session hub inside a plain pi). It owns authentication and the event
// fan-out; it knows nothing about sessions. See `@shared/remote` for the wire format.
import crypto from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import type { HostEvent } from '@shared/protocol';
import {
  isServedMethod,
  REMOTE_API_VERSION,
  REMOTE_HEARTBEAT_MS,
  REMOTE_MAX_BODY_BYTES,
  REMOTE_PATHS,
  type RemoteKind,
  type RemotePing,
  type RemoteRpcResponse,
} from '@shared/remote';

export interface RemoteBackend {
  kind: RemoteKind;
  call(method: string, args: unknown[]): Promise<unknown>;
}

export interface RemoteServerOptions {
  backend: RemoteBackend;
  token: string;
  port: number;
  /** Listen on every interface instead of loopback only. */
  lan: boolean;
  /** Called when the number of event streams changes. */
  onClients?: (count: number) => void;
}

export function newRemoteToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function tokenMatches(given: string, expected: string) {
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

const bearer = (req: http.IncomingMessage) => /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]?.trim() ?? '';

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > REMOTE_MAX_BODY_BYTES) {
        reject(new Error('The request is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Addresses a client on the same network (or the same machine) can try. */
export function remoteUrls(port: number, lan: boolean): string[] {
  const urls = [`http://127.0.0.1:${port}`];
  if (!lan) return urls;
  for (const list of Object.values(os.networkInterfaces())) {
    for (const addr of list ?? [])
      if (addr.family === 'IPv4' && !addr.internal) urls.push(`http://${addr.address}:${port}`);
  }
  return urls;
}

export class RemoteServer {
  private server: http.Server | null = null;
  private readonly streams = new Set<http.ServerResponse>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: RemoteServerOptions) {}

  get clients() {
    return this.streams.size;
  }

  /** The port actually bound (useful when 0 asked for any free one). */
  get port() {
    const addr = this.server?.address();
    return typeof addr === 'object' && addr ? addr.port : this.options.port;
  }

  start(): Promise<void> {
    if (this.server) return Promise.resolve();
    const server = http.createServer((req, res) => void this.handle(req, res));
    // A stream is meant to stay open for hours.
    server.requestTimeout = 0;
    server.keepAliveTimeout = 5000;
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once('error', (err) => {
        this.server = null;
        reject(err);
      });
      server.listen(this.options.port, this.options.lan ? '0.0.0.0' : '127.0.0.1', () => {
        this.heartbeat = setInterval(() => this.broadcastRaw(': keep-alive\n\n'), REMOTE_HEARTBEAT_MS);
        this.heartbeat.unref?.();
        resolve();
      });
    });
  }

  async stop() {
    const server = this.server;
    if (!server) return;
    this.server = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const res of this.streams) res.end();
    this.streams.clear();
    this.options.onClients?.(0);
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }

  /** Send one host event to every connected client. */
  publish(event: HostEvent) {
    if (!this.streams.size) return;
    this.broadcastRaw(`data: ${JSON.stringify(event)}\n\n`);
  }

  private broadcastRaw(chunk: string) {
    for (const res of this.streams) {
      try {
        res.write(chunk);
      } catch {
        this.streams.delete(res);
      }
    }
  }

  private json(res: http.ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  }

  private authorized(req: http.IncomingMessage) {
    const given = bearer(req);
    return given.length > 0 && tokenMatches(given, this.options.token);
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (path === REMOTE_PATHS.ping && req.method === 'GET') {
        const ping: RemotePing = {
          app: 'pi-remote',
          version: REMOTE_API_VERSION,
          kind: this.options.backend.kind,
          host: os.hostname(),
          platform: process.platform,
        };
        return this.json(res, 200, ping);
      }
      if (!this.authorized(req)) return this.json(res, 401, { ok: false, error: 'Wrong or missing access token.' });
      if (path === REMOTE_PATHS.events && req.method === 'GET') return this.openStream(req, res);
      if (path === REMOTE_PATHS.rpc && req.method === 'POST') return await this.rpc(req, res);
      return this.json(res, 404, { ok: false, error: 'Not found.' });
    } catch (err) {
      if (!res.headersSent) this.json(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
      else res.end();
    }
  }

  private openStream(req: http.IncomingMessage, res: http.ServerResponse) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(': connected\n\n');
    this.streams.add(res);
    this.options.onClients?.(this.streams.size);
    req.on('close', () => {
      if (this.streams.delete(res)) this.options.onClients?.(this.streams.size);
    });
  }

  private async rpc(req: http.IncomingMessage, res: http.ServerResponse) {
    let body: { method?: unknown; args?: unknown };
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      return this.json(res, 400, {
        ok: false,
        error: err instanceof Error ? err.message : 'Invalid request.',
      } satisfies RemoteRpcResponse);
    }
    if (!isServedMethod(body.method))
      return this.json(res, 400, {
        ok: false,
        error: `Unknown or unavailable method: ${String(body.method)}`,
      } satisfies RemoteRpcResponse);
    const args = Array.isArray(body.args) ? body.args : [];
    try {
      const value = await this.options.backend.call(body.method, args);
      this.json(res, 200, { ok: true, value: value ?? null } satisfies RemoteRpcResponse);
    } catch (err) {
      this.json(res, 200, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      } satisfies RemoteRpcResponse);
    }
  }
}
