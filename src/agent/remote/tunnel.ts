// Reach the remote server from outside the local network through a Cloudflare quick tunnel
// (`cloudflared tunnel --url`): an https://<random>.trycloudflare.com address that needs no account,
// no open port and no router setup. The tunnel only carries traffic; the access token still guards it.
import { spawn, type ChildProcess } from 'node:child_process';

const BINARY = 'cloudflared';
const URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const START_TIMEOUT_MS = 30_000;
const STDERR_TAIL = 2000;

export type TunnelState = 'off' | 'starting' | 'ready' | 'error';
export interface TunnelStatus {
  state: TunnelState;
  url?: string;
  error?: string;
}

export class Tunnel {
  private child: ChildProcess | null = null;
  private status: TunnelStatus = { state: 'off' };

  /** `command` replaces the cloudflared executable (and any leading arguments); tests use it. */
  constructor(private readonly env: NodeJS.ProcessEnv = process.env, private readonly command: string[] = [BINARY]) {}

  get current(): TunnelStatus {
    return this.status;
  }

  /** Start the tunnel to a local port; the status moves to `ready` (with the public URL) or `error`. */
  start(port: number): Promise<TunnelStatus> {
    this.stop();
    this.status = { state: 'starting' };
    return new Promise((resolve) => {
      let tail = '';
      const finish = (status: TunnelStatus) => {
        clearTimeout(timer);
        this.status = status;
        resolve(status);
      };
      let child: ChildProcess;
      try {
        child = spawn(this.command[0], [...this.command.slice(1), 'tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { env: this.env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
      } catch (err) {
        return finish({ state: 'error', error: (err as Error).message });
      }
      this.child = child;
      const timer = setTimeout(() => {
        this.stop();
        finish({ state: 'error', error: 'cloudflared did not report a tunnel address in time.' });
      }, START_TIMEOUT_MS);
      child.stderr?.on('data', (chunk: Buffer) => {
        tail = (tail + chunk.toString()).slice(-STDERR_TAIL);
        const url = URL_PATTERN.exec(tail)?.[0];
        if (url && this.status.state === 'starting') finish({ state: 'ready', url });
      });
      child.on('error', (err: NodeJS.ErrnoException) => {
        this.child = null;
        finish({ state: 'error', error: err.code === 'ENOENT' ? 'cloudflared is not installed or not on PATH. Install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/.' : err.message });
      });
      child.on('exit', (code) => {
        if (this.child !== child) return;
        this.child = null;
        // A tunnel that ends on its own is a failure; one we stopped is already `off`.
        finish({ state: 'error', error: `cloudflared exited (${code}). ${tail.trim().split('\n').slice(-2).join(' ')}`.trim() });
      });
    });
  }

  stop() {
    const child = this.child;
    this.child = null;
    this.status = { state: 'off' };
    child?.kill();
  }
}
