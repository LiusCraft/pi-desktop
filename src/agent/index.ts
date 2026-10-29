// Agent host: an Electron utilityProcess that runs every pi session in-process
// through the SDK. The main process talks to it over the parent port with
// id-correlated calls; session events flow back as a single event stream.
import { setActiveLocale } from '@shared/i18n/runtime';
import type { HostMethod, HostToMain, MainToHost } from '@shared/protocol';
import { importAttachments } from './attachments';
import * as git from './git';
import { sessionHandlers } from './handlers';
import { applyChildPath } from './env';
import { SessionHub } from './hub';
import { isTransferMethod } from '@shared/remote';
import { transferCall } from './remote/transfer';
import { Scheduler } from './scheduler';
import { Store } from './store';

interface ParentPort {
  on(event: 'message', listener: (e: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}
// SAFETY: Electron utilityProcess adds parentPort to process; its presence is checked below.
const port = (process as unknown as { parentPort?: ParentPort }).parentPort;
if (!port) throw new Error('The agent host must run as an Electron utilityProcess');

applyChildPath();

function send(message: HostToMain) {
  try {
    port!.postMessage(message);
  } catch {
    // Something in an event was not structured-cloneable: fall back to plain data.
    port!.postMessage(JSON.parse(JSON.stringify(message)));
  }
}

let dataDir = '';
let hub: SessionHub | null = null;
let scheduler: Scheduler | null = null;
let resolveReady!: (hub: SessionHub) => void;
const ready = new Promise<SessionHub>((resolve) => (resolveReady = resolve));

type Handler = (...args: any[]) => unknown;
const withHub = (fn: (hub: SessionHub, ...args: any[]) => unknown): Handler => async (...args) => fn(await ready, ...args);

const handlers: Record<HostMethod, Handler> = {
  'host:locale': (locale) => setActiveLocale(locale),
  'host:init': async (options) => {
    const { agentDir, demo, locale } = options;
    dataDir = options.dataDir;
    setActiveLocale(locale);
    if (hub) return;
    hub = new SessionHub({ dataDir, agentDir, demoModel: demo, emit: (event) => send({ kind: 'event', event }) });
    await hub.init();
    // The scheduler writes the task list; the pages showing it read it again (see HOST_RESOURCES).
    scheduler = new Scheduler(new Store(dataDir), hub, () => send({ kind: 'event', event: { type: 'changed', resource: 'tasks' } }));
    hub.scheduler = scheduler;
    scheduler.start();
    resolveReady(hub);
  },
  'host:cancelLogins': withHub((h) => h.admin.cancelAll()),
  'host:meta': withHub((h, id) => ({ ...h.meta(id) })),
  'host:importAttachments': (sources) => importAttachments(sources),
  'host:transfer': (method, args) => {
    if (!isTransferMethod(method)) throw new Error(`Unknown transfer: ${method}`);
    return transferCall(dataDir, method, args);
  },
  'host:worktree': (dir) => git.worktreeInfo(dir),
  'host:shutdown': async () => {
    scheduler?.stop();
    await hub?.shutdown();
  },

  ...sessionHandlers(ready, () => scheduler),
};

port.on('message', async ({ data }) => {
  const msg = data as MainToHost;
  if (msg?.kind !== 'call') return;
  const handler = handlers[msg.method];
  try {
    if (!handler) throw new Error(`Unknown agent host method: ${msg.method}`);
    const value = await handler(...msg.args);
    send({ kind: 'result', id: msg.id, ok: true, value });
  } catch (err) {
    send({ kind: 'result', id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// A stray rejection inside a tool or extension must not take every session down.
process.on('unhandledRejection', (reason) => {
  console.error('[agent host] unhandled rejection:', reason);
});
