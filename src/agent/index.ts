// Agent host: an Electron utilityProcess that runs every pi session in-process
// through the SDK. The main process talks to it over the parent port with
// id-correlated calls; session events flow back as a single event stream.
import type { HostMethod, HostToMain, MainToHost } from '@shared/protocol';
import { importAttachments } from './attachments';
import * as git from './git';
import { applyChildPath } from './env';
import { SessionHub } from './hub';

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

let hub: SessionHub | null = null;
let resolveReady!: (hub: SessionHub) => void;
const ready = new Promise<SessionHub>((resolve) => (resolveReady = resolve));

type Handler = (...args: any[]) => unknown;
const withHub = (fn: (hub: SessionHub, ...args: any[]) => unknown): Handler => async (...args) => fn(await ready, ...args);

const handlers: Record<HostMethod, Handler> = {
  'host:init': async ({ dataDir, agentDir, demo }) => {
    if (hub) return;
    hub = new SessionHub({ dataDir, agentDir, demoModel: demo, emit: (event) => send({ kind: 'event', event }) });
    await hub.init();
    resolveReady(hub);
  },
  'host:cancelLogins': withHub((h) => h.admin.cancelAll()),
  'host:meta': withHub((h, id) => ({ ...h.meta(id) })),
  'host:importAttachments': (sources) => importAttachments(sources),
  'host:shutdown': async () => {
    await hub?.shutdown();
  },

  'sessions:list': withHub((h) => h.list()),
  'sessions:create': withHub((h, opts) => h.create(opts)),
  'sessions:open': withHub((h, id) => h.open(id)),
  'sessions:prompt': withHub((h, id, payload, behavior) => h.prompt(id, payload, behavior)),
  'sessions:respond': withHub((h, id, requestId, response) => h.respond(id, requestId, response)),
  'sessions:setMode': withHub((h, id, mode) => h.setMode(id, mode)),
  'sessions:setStyle': withHub((h, id, style) => h.setStyle(id, style)),
  'sessions:update': withHub((h, id, patch) => h.update(id, patch)),
  'sessions:archive': withHub((h, id) => h.archive(id)),
  'sessions:abort': withHub((h, id) => h.abort(id)),
  'sessions:clearQueue': withHub((h, id) => h.clearQueue(id)),
  'sessions:newContext': withHub((h, id) => h.newContext(id)),
  'sessions:compact': withHub((h, id, instructions) => h.compact(id, instructions)),
  'sessions:stats': withHub((h, id) => h.stats(id)),
  'sessions:exportHtml': withHub((h, id) => h.exportHtml(id)),
  'sessions:clone': withHub((h, id) => h.clone(id)),
  'sessions:messageAction': withHub((h, id, entryId, action) => h.messageAction(id, entryId, action)),
  'sessions:setModel': withHub((h, id, model) => h.setModel(id, model)),
  'sessions:setThinking': withHub((h, id, level) => h.setThinking(id, level)),
  'sessions:commands': withHub((h, id) => h.commands(id)),
  'sessions:suggest': withHub((h, id, options) => h.suggest(id, options)),
  'sessions:bash': withHub((h, id, command) => h.bash(id, command)),
  'sessions:changes': withHub((h, id) => h.changes(id)),
  'sessions:pr': withHub((h, id) => h.prStatus(id)),
  'sessions:files': withHub((h, id) => h.files(id)),
  'sessions:readFile': withHub((h, id, rel) => h.readFile(id, rel)),
  'sessions:readImage': withHub((h, id, rel) => h.readImage(id, rel)),
  'sessions:context': withHub((h, id) => h.context(id)),
  'sessions:stopTask': withHub((h, id, toolCallId) => h.stopTask(id, toolCallId)),
  'sessions:importable': withHub((h, dir) => h.importable(dir)),
  'sessions:import': withHub((h, file) => h.importSession(file)),
  'git:branch': (dir) => git.currentBranch(dir),
  'models:list': withHub((h) => h.listModels()),
  'models:levels': withHub((h, model) => h.thinkingLevels(model)),
  'models:catalog': withHub((h) => h.admin.catalog()),
  'models:login': withHub((h, provider, authType, name) => h.admin.login(provider, authType, name)),
  'models:loginRespond': withHub((h, loginId, requestId, value) => h.admin.respond(loginId, requestId, value)),
  'models:loginCancel': withHub((h, loginId) => h.admin.cancel(loginId)),
  'models:logout': withHub((h, provider) => h.admin.logout(provider)),
  'models:endpointSave': withHub((h, draft) => h.admin.saveEndpoint(draft)),
  'models:endpointRemove': withHub((h, id) => h.admin.removeEndpoint(id)),
  'models:endpointDiscover': withHub((h, draft) => h.admin.discover(draft)),
  'models:refresh': withHub((h) => h.admin.refresh()),
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
