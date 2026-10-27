// The agent host's calls, bound to one session hub. Pi Desktop's host process and the `pi-remote` plugin
// (a hub living inside a plain pi) serve the very same set, so a remote client cannot tell them apart.
import { TEMPORARY_WORKSPACE } from '@shared/activity';
import type { HOST_CHANNELS } from '@shared/protocol';
import * as git from './git';
import { readCustomizeFile } from './customize';
import type { SessionHub } from './hub';
import type { Scheduler } from './scheduler';

export type HostChannel = (typeof HOST_CHANNELS)[number];
type Handler = (...args: any[]) => unknown;

/** `getScheduler` is null where there is none (the plugin): the scheduled-task calls then say so. */
export function sessionHandlers(ready: Promise<SessionHub>, getScheduler: () => Scheduler | null): Record<HostChannel, Handler> {
  const withHub = (fn: (hub: SessionHub, ...args: any[]) => unknown): Handler => async (...args) => fn(await ready, ...args);
  const scheduler = () => {
    const s = getScheduler();
    if (!s) throw new Error('Scheduled tasks are not available on this host.');
    return s;
  };
  return {
    'sessions:list': withHub((h) => h.list()),
    'sessions:create': withHub((h, opts) => h.create(opts)),
    'sessions:open': withHub((h, id) => h.open(id)),
    // Only this call is the user typing; tasks, peers and PR events reach `hub.prompt` directly.
    'sessions:prompt': withHub(async (h, id, payload, behavior) => {
      const result = await h.prompt(id, payload, behavior);
      const m = h.meta(id);
      h.activity.recordPrompt(m.kind, id, m.scratch ? TEMPORARY_WORKSPACE : m.projectPath);
      return result;
    }),
    'sessions:respond': withHub((h, id, requestId, response) => h.respond(id, requestId, response)),
    'sessions:setMode': withHub((h, id, mode) => h.setMode(id, mode)),
    'sessions:setStyle': withHub((h, id, style) => h.setStyle(id, style)),
    'sessions:update': withHub((h, id, patch) => h.update(id, patch)),
    'sessions:archive': withHub((h, id) => h.archive(id)),
    'sessions:unarchive': withHub((h, id) => h.unarchive(id)),
    'sessions:inspect': withHub((h, id) => h.inspect(id)),
    'sessions:remove': withHub((h, id) => h.remove(id)),
    'sessions:spawn': withHub((h, fromId, task, key) => h.spawn(fromId, task, key)),
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
    'sessions:side': withHub((h, id, input) => h.side(id, input)),
    'sessions:sideGet': withHub((h, id) => h.sideGet(id)),
    'sessions:sideStage': withHub((h, id, quote) => h.sideStage(id, quote)),
    'sessions:sideAbort': withHub((h, id) => h.sideAbort(id)),
    'sessions:sideReset': withHub((h, id) => h.sideReset(id)),
    'sessions:changes': withHub((h, id) => h.changes(id)),
    'sessions:commits': withHub((h, id) => h.commits(id)),
    'sessions:commitChanges': withHub((h, id, hash) => h.commitChanges(id, hash)),
    'sessions:changeContent': withHub((h, id, file, hash) => h.changeContent(id, file, hash)),
    'sessions:pr': withHub((h, id) => h.prStatus(id)),
    'sessions:prThreads': withHub((h, id) => h.prThreads(id)),
    'sessions:prReply': withHub((h, id, threadId, body) => h.prReply(id, threadId, body)),
    'sessions:prResolve': withHub((h, id, threadId, resolved) => h.prResolve(id, threadId, resolved)),
    'sessions:files': withHub((h, id) => h.files(id)),
    'sessions:readFile': withHub((h, id, rel) => h.readFile(id, rel)),
    'sessions:search': withHub((h, id, query, caseSensitive) => h.search(id, query, caseSensitive)),
    'sessions:readImage': withHub((h, id, rel) => h.readImage(id, rel)),
    'sessions:context': withHub((h, id) => h.context(id)),
    'sessions:stopTask': withHub((h, id, toolCallId) => h.stopTask(id, toolCallId)),
    'sessions:importable': withHub((h, dir) => h.importable(dir)),
    'sessions:import': withHub((h, file) => h.importSession(file)),
    'git:branch': (dir) => git.currentBranch(dir),
    'git:branches': (dir) => git.branches(dir),
    'agents:list': withHub((h) => h.agentCatalog()),
    'agents:tools': withHub((h) => h.toolOptions()),
    'agents:save': withHub((h, draft) => h.saveAgent(draft)),
    'agents:remove': withHub((h, name) => h.removeAgent(name)),
    'customize:list': withHub((h, project) => h.customize.list(project)),
    'customize:readFile': (file) => readCustomizeFile(file),
    'customize:skillSetDisabled': withHub((h, file, disabled, project) => h.customize.setSkillDisabled(file, disabled, project)),
    'customize:skillCreate': withHub((h, draft, project) => h.customize.createSkill(draft, project)),
    'customize:claudeImport': withHub((h, project) => h.customize.importClaudeSkills(project)),
    'customize:claudeDismiss': withHub((h, project) => h.customize.dismissClaudeSkills(project)),
    'customize:connectorSave': withHub((h, draft, project) => h.customize.saveConnector(draft, project)),
    'customize:connectorSetEnabled': withHub((h, name, scope, enabled, project) => h.customize.setConnectorEnabled(name, scope, enabled, project)),
    'customize:connectorRemove': withHub((h, name, scope, project) => h.customize.removeConnector(name, scope, project)),
    'customize:pluginInstall': withHub((h, source, scope, project) => h.customize.installPlugin(source, scope, project)),
    'customize:pluginRemove': withHub((h, source, scope, project) => h.customize.removePlugin(source, scope, project)),
    'customize:pluginUpdate': withHub((h, source, project) => h.customize.updatePlugins(source, project)),
    'activity:get': withHub((h) => h.activity.get()),
    'tasks:list': withHub(() => scheduler().list()),
    'tasks:save': withHub((_h, draft) => scheduler().save(draft)),
    'tasks:setEnabled': withHub((_h, id, enabled) => scheduler().setEnabled(id, enabled)),
    'tasks:remove': withHub((_h, id) => scheduler().remove(id)),
    'tasks:run': withHub((_h, id) => scheduler().runNow(id)),
    'artifacts:list': withHub((h) => h.artifacts.list()),
    'artifacts:remove': withHub(async (h, id, unpublish) => {
      await h.artifacts.remove(id, unpublish);
      return h.artifacts.list();
    }),
    'artifacts:publish': withHub((h, id) => h.artifacts.publish(id)),
    'artifacts:unpublish': withHub((h, id) => h.artifacts.unpublish(id)),
    'storage:get': withHub((h) => h.storage.info()),
    'storage:save': withHub((h, draft) => h.storage.save(draft)),
    'storage:test': withHub((h, draft) => h.storage.test(draft)),
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
}
