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
    'sessions:state': withHub((h, id) => h.sessionState(id)),
    // Only this call is the user typing; tasks, peers and PR events reach `hub.prompt` directly.
    'sessions:prompt': withHub(async (h, id, payload, behavior) => {
      const result = await h.prompt(id, payload, behavior);
      const m = h.meta(id);
      h.activity.recordPrompt(m.kind, id, m.scratch ? TEMPORARY_WORKSPACE : m.projectPath);
      // The activity page counts prompts: a new one changes what it shows.
      h.resourceChanged('activity');
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
    'sessions:compactedHistory': withHub((h, id) => h.compactedHistory(id)),
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
    'sessions:workIdeas': withHub((h) => h.workIdeas()),
    'sessions:changes': withHub((h, id) => h.changes(id)),
    'sessions:setBase': withHub((h, id, ref) => h.setBase(id, ref)),
    'sessions:commits': withHub((h, id) => h.commits(id)),
    'sessions:commitChanges': withHub((h, id, hash) => h.commitChanges(id, hash)),
    'sessions:changeContent': withHub((h, id, file, hash) => h.changeContent(id, file, hash)),
    'sessions:pr': withHub((h, id) => h.prStatus(id)),
    'sessions:prThreads': withHub((h, id) => h.prThreads(id)),
    'sessions:prReply': withHub((h, id, threadId, body) => h.prReply(id, threadId, body)),
    'sessions:prResolve': withHub((h, id, threadId, resolved) => h.prResolve(id, threadId, resolved)),
    'sessions:files': withHub((h, id) => h.files(id)),
    'sessions:existing': withHub((h, id, paths) => h.existing(id, paths)),
    'sessions:readFile': withHub((h, id, rel) => h.readFile(id, rel)),
    'sessions:search': withHub((h, id, query, caseSensitive) => h.search(id, query, caseSensitive)),
    'sessions:readImage': withHub((h, id, rel) => h.readImage(id, rel)),
    'sessions:readMedia': withHub((h, id, rel) => h.readMedia(id, rel)),
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
    'customize:promptCreate': withHub((h, draft, project) => h.customize.createPrompt(draft, project)),
    'customize:promptDelete': withHub((h, file, project) => h.customize.deletePrompt(file, project)),
    'customize:claudeImport': withHub((h, project) => h.customize.importClaudeSkills(project)),
    'customize:claudeDismiss': withHub((h, project) => h.customize.dismissClaudeSkills(project)),
    'customize:connectorSave': withHub((h, draft, project) => h.customize.saveConnector(draft, project)),
    'customize:connectorSetEnabled': withHub((h, name, scope, enabled, project) => h.customize.setConnectorEnabled(name, scope, enabled, project)),
    'customize:connectorRemove': withHub((h, name, scope, project) => h.customize.removeConnector(name, scope, project)),
    'customize:skillDelete': withHub((h, file, project) => h.customize.deleteSkill(file, project)),
    'customize:skillsFromGitRemove': withHub((h, repo, project) => h.customize.removeSkillRepo(repo, project)),
    'customize:skillsFromGit': withHub((h, repo, subdir, project) => h.customize.installSkillRepo(repo, subdir, project)),
    'customize:pluginInstall': withHub((h, source, scope, project) => h.customize.installPlugin(source, scope, project)),
    'customize:pluginRemove': withHub((h, source, scope, project) => h.customize.removePlugin(source, scope, project)),
    'customize:pluginUpdate': withHub((h, source, project) => h.customize.updatePlugins(source, project)),
    'customize:pluginResources': withHub((h, source, scope, project) => h.customize.pluginResources(source, scope, project)),
    'customize:pluginSetResource': withHub((h, source, scope, resource, enabled, project) => h.customize.setPluginResource(source, scope, resource, enabled, project)),
    'activity:get': withHub((h) => h.activity.get()),
    'requests:getSettings': withHub((h) => h.requests.getSettings()),
    'requests:saveSettings': withHub((h, draft) => h.requests.saveSettings(draft)),
    'requests:list': withHub((h, query) => h.requests.list(query)),
    'requests:summary': withHub((h, query) => h.requests.summary(query)),
    'requests:preview': withHub((h, text, settings) => h.requests.preview(text, settings)),
    'tasks:list': withHub(() => scheduler().list()),
    'tasks:save': withHub((_h, draft) => scheduler().save(draft)),
    'tasks:setEnabled': withHub((_h, id, enabled) => scheduler().setEnabled(id, enabled)),
    'tasks:remove': withHub((_h, id) => scheduler().remove(id)),
    'tasks:run': withHub((_h, id) => scheduler().runNow(id)),
    'artifacts:list': withHub((h) => h.artifacts.list()),
    'artifacts:fromFile': withHub((h, sessionId, rel) => {
      const saved = h.artifacts.save({ source: h.resolvePath(sessionId, rel) });
      // The list the Artifacts page shows is the host's: announce the new one.
      h.resourceChanged('artifacts');
      return saved;
    }),
    'artifacts:remove': withHub(async (h, id, unpublish) => {
      await h.artifacts.remove(id, unpublish);
      return h.artifacts.list();
    }),
    'artifacts:publish': withHub((h, id) => h.artifacts.publish(id)),
    'artifacts:unpublish': withHub((h, id) => h.artifacts.unpublish(id)),
    'storage:get': withHub((h) => h.storage.info()),
    'storage:save': withHub((h, draft) => h.storage.save(draft)),
    'storage:test': withHub((h, draft) => h.storage.test(draft)),
    'web:get': withHub((h) => h.web.info()),
    'web:save': withHub((h, draft) => h.web.save(draft)),
    'web:test': withHub((h, engine, key) => h.web.test(engine, key)),
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
