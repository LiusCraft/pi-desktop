// The main process side of the agent host: forks the utilityProcess, correlates
// calls with results, and relays its event stream. A crashed host is restarted
// (and re-initialised) by the next call, so one bad tool run cannot wedge the app.
import { utilityProcess, type UtilityProcess } from 'electron';
import type { HostEvent, HostInitOptions, HostMethod, HostToMain, MainToHost } from '@shared/protocol';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export class AgentClient {
  private child: UtilityProcess | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<number, Pending>();
  private seq = 0;
  private stderr = '';
  private stopping = false;

  constructor(
    private readonly modulePath: string,
    private readonly init: () => HostInitOptions,
    private readonly onEvent: (event: HostEvent) => void,
  ) {}

  private spawn() {
    const child = utilityProcess.fork(this.modulePath, [], { serviceName: 'Pi Agent Host', stdio: 'pipe' });
    this.child = child;
    this.stderr = '';
    child.stdout?.on('data', (d: Buffer) => process.stdout.write(d));
    child.stderr?.on('data', (d: Buffer) => {
      this.stderr = (this.stderr + d.toString()).slice(-20000);
      process.stderr.write(d);
    });
    child.on('message', (msg: HostToMain) => {
      if (msg.kind === 'event') return this.onEvent(msg.event);
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.value);
      else p.reject(new Error(msg.error));
    });
    child.on('exit', (code) => {
      if (this.child !== child) return;
      this.child = null;
      this.ready = null;
      for (const p of this.pending.values()) p.reject(new Error(`The agent host exited (${code})`));
      this.pending.clear();
      if (!this.stopping) this.onEvent({ type: 'host_exit', code, stderr: this.stderr.slice(-4000) });
    });
    this.ready = this.send('host:init', [this.init()]).then(() => {});
  }

  private send(method: HostMethod, args: unknown[]): Promise<unknown> {
    const child = this.child;
    if (!child) return Promise.reject(new Error('The agent host is not running'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        child.postMessage({ kind: 'call', id, method, args } satisfies MainToHost);
      } catch (err) {
        this.pending.delete(id);
        reject(err as Error);
      }
    });
  }

  start() {
    if (!this.child) this.spawn();
    return this.ready!;
  }

  async call<T = unknown>(method: HostMethod, ...args: unknown[]): Promise<T> {
    if (!this.child) this.spawn();
    await this.ready;
    return (await this.send(method, args)) as T;
  }

  /** Orderly shutdown: dispose sessions, then end the process. */
  async stop() {
    if (!this.child) return;
    this.stopping = true;
    const child = this.child;
    await Promise.race([this.send('host:shutdown', []).catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
    child.kill();
  }
}
