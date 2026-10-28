/**
 * Backend of the Customize page: skills, connectors and plugins, mapped
 * onto pi. Skills are pi skills (SKILL.md folders), connectors are MCP servers
 * (`mcp.json`), plugins are pi packages (`packages` in settings.json). Everything is read
 * and written in pi's own files, so the CLI and the desktop always agree.
 */
import { tr } from '@shared/i18n/runtime';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import spawn from 'cross-spawn';
import {
  DefaultPackageManager, DefaultResourceLoader, parseFrontmatter, SettingsManager,
} from '@earendil-works/pi-coding-agent';
import type {
  ConnectorDraft, ConnectorInfo, CustomizeCatalog, CustomizeScope, PluginInfo, PromptInfo, SkillDraft, SkillInfo,
} from '@shared/protocol';

export interface CustomizeEnv {
  agentDir: string;
  /** The selected project, if any. Project-level entries live in `<project>/.pi`. */
  project: string | null;
  /** Project settings and resources are only honoured for trusted projects. */
  projectTrusted: boolean;
  /** The user declined the offer to import Claude Code's skills. */
  claudeSkillsDeclined: boolean;
}

/** Same home folder pi uses to find `~/.agents/skills`. */
const homeDir = () => process.env.HOME || os.homedir();
const agentsSkillsDir = () => path.join(homeDir(), '.agents', 'skills');
const claudeSkillsDir = () => path.join(process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(homeDir(), '.claude'), 'skills');

const NAME = /^[a-z0-9][a-z0-9_-]*$/i;
const userSettings = (env: CustomizeEnv) => path.join(env.agentDir, 'settings.json');
const projectSettings = (env: CustomizeEnv) => (env.project ? path.join(env.project, '.pi', 'settings.json') : null);
const mcpFile = (env: CustomizeEnv, scope: 'user' | 'project') => {
  if (scope === 'user') return path.join(env.agentDir, 'mcp.json');
  if (!env.project) throw new Error(tr('ag.needProject'));
  return path.join(env.project, '.pi', 'mcp.json');
};

function readJson(file: string): Record<string, any> {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

// ------------------------------------------------------------ skills

/** Skills that are switched off are not loaded at all, so they are read from the `-path` entries. */
function disabledSkillFiles(settingsFile: string | null, baseDir: string): string[] {
  if (!settingsFile) return [];
  const list = readJson(settingsFile).skills;
  if (!Array.isArray(list)) return [];
  return list
    .filter((e): e is string => typeof e === 'string' && e.startsWith('-'))
    .map((e) => e.slice(1))
    .map((p) => (path.isAbsolute(p) ? p : path.resolve(baseDir, p)));
}

function describeSkillFile(file: string): { name: string; description: string; manualOnly: boolean } | null {
  try {
    const { frontmatter: fm } = parseFrontmatter<Record<string, unknown>>(fs.readFileSync(file, 'utf8'));
    const base = path.basename(file).toLowerCase() === 'skill.md' ? path.basename(path.dirname(file)) : path.basename(file, path.extname(file));
    return {
      name: String(fm.name ?? base),
      description: String(fm.description ?? ''),
      manualOnly: fm['disable-model-invocation'] === true,
    };
  } catch {
    return null;
  }
}

/** Resources that came out of a package are `package`, whatever scope installed the package. */
const scopeOf = (info: { scope?: string; origin?: string }): CustomizeScope => (info.origin === 'package' ? 'package' : info.scope === 'project' ? 'project' : 'user');
const norm = (p: string) => path.resolve(p).toLowerCase();

async function loadResources(env: CustomizeEnv) {
  const cwd = env.project ?? env.agentDir;
  const settingsManager = SettingsManager.create(cwd, env.agentDir, { projectTrusted: env.projectTrusted });
  const loader = new DefaultResourceLoader({
    cwd, agentDir: env.agentDir, settingsManager, noExtensions: true, noThemes: true, noContextFiles: true,
  });
  await loader.reload();
  return { loader, settingsManager };
}

function collectSkills(env: CustomizeEnv, loaded: ReturnType<DefaultResourceLoader['getSkills']>): SkillInfo[] {
  const out: SkillInfo[] = loaded.skills.map((s) => ({
    name: s.name,
    description: s.description,
    file: s.filePath,
    scope: scopeOf(s.sourceInfo),
    origin: s.sourceInfo.origin === 'package' ? s.sourceInfo.source : path.dirname(path.dirname(s.filePath)),
    disabled: false,
    manualOnly: s.disableModelInvocation,
  }));
  const seen = new Set(out.map((s) => norm(s.file)));
  const off: [string, CustomizeScope][] = [
    ...disabledSkillFiles(userSettings(env), env.agentDir).map((f): [string, CustomizeScope] => [f, 'user']),
    ...disabledSkillFiles(env.projectTrusted ? projectSettings(env) : null, env.project ? path.join(env.project, '.pi') : '').map((f): [string, CustomizeScope] => [f, 'project']),
  ];
  for (const [given, scope] of off) {
    const file = fs.existsSync(given) && fs.statSync(given).isDirectory() ? path.join(given, 'SKILL.md') : given;
    if (seen.has(norm(file)) || !fs.existsSync(file)) continue;
    const info = describeSkillFile(file);
    if (!info) continue;
    seen.add(norm(file));
    out.push({ ...info, file, scope, origin: path.dirname(path.dirname(file)), disabled: true });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The settings file and base folder that own a skill's on/off switch. */
function skillSwitchTarget(env: CustomizeEnv, file: string) {
  const inside = (root: string | null) => !!root && (norm(file) === norm(root) || norm(file).startsWith(`${norm(root)}${path.sep}`));
  if (inside(env.project) && projectSettings(env)) return projectSettings(env)!;
  return userSettings(env);
}

export async function setSkillDisabled(env: CustomizeEnv, file: string, disabled: boolean) {
  const target = skillSwitchTarget(env, file);
  const settings = readJson(target);
  const list: string[] = Array.isArray(settings.skills) ? settings.skills.filter((e: unknown) => typeof e === 'string') : [];
  const base = target === userSettings(env) ? env.agentDir : path.join(env.project!, '.pi');
  const same = (entry: string) => entry.startsWith('-') && norm(path.resolve(base, entry.slice(1))) === norm(file);
  const next = list.filter((e) => !same(e));
  if (disabled) next.push(`-${file}`);
  if (next.length) settings.skills = next;
  else delete settings.skills;
  writeJson(target, settings);
  return catalog(env);
}

export async function createSkill(env: CustomizeEnv, draft: SkillDraft) {
  const name = draft.name.trim();
  const description = draft.description.trim().replace(/\s+/g, ' ');
  const body = draft.body.trim();
  if (!NAME.test(name)) throw new Error(tr('ag.nameRule'));
  if (!description) throw new Error(tr('ag.skillNeedDescription'));
  if (!body) throw new Error(tr('ag.skillNeedBody'));
  if (draft.scope === 'project' && !env.project) throw new Error(tr('ag.needProjectShort'));
  const root = draft.home === 'agents'
    ? (draft.scope === 'project' ? path.join(env.project!, '.agents', 'skills') : agentsSkillsDir())
    : (draft.scope === 'project' ? path.join(env.project!, '.pi', 'skills') : path.join(env.agentDir, 'skills'));
  const dir = path.join(root, name);
  if (fs.existsSync(dir)) throw new Error(tr('ag.skillExists', { name }));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}\n`, 'utf8');
  return catalog(env);
}

/**
 * Claude Code's skills are never loaded on their own. They are offered once: `claudeSkillsDir()` is
 * listed here until it is added to pi's skill paths (import) or the user declines.
 */
function claudeSkillsOffer(env: CustomizeEnv): { dir: string; count: number } | null {
  if (env.claudeSkillsDeclined) return null;
  const dir = claudeSkillsDir();
  const settings = readJson(userSettings(env));
  const paths: unknown[] = Array.isArray(settings.skills) ? settings.skills : [];
  if (paths.some((e) => typeof e === 'string' && !e.startsWith('-') && norm(path.resolve(env.agentDir, e)) === norm(dir))) return null;
  try {
    const count = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'SKILL.md'))).length;
    return count ? { dir, count } : null;
  } catch {
    return null;
  }
}

/** Load Claude Code's skills in place (a path in pi's settings), so edits made in either tool stay in sync. */
export async function importClaudeSkills(env: CustomizeEnv) {
  const file = userSettings(env);
  const settings = readJson(file);
  const list: unknown[] = Array.isArray(settings.skills) ? settings.skills : [];
  settings.skills = [...list, claudeSkillsDir()];
  writeJson(file, settings);
  return catalog(env);
}

/** Only files that belong to the catalog may be previewed. */
export function readCustomizeFile(file: string): string {
  if (!/\.(md|json)$/i.test(file)) throw new Error(tr('ag.onlyMdJson'));
  const text = fs.readFileSync(file, 'utf8');
  return text.length > 200_000 ? `${text.slice(0, 200_000)}\n\n${tr('ag.truncated')}` : text;
}

// ------------------------------------------------------------ connectors (MCP servers)

function collectConnectors(env: CustomizeEnv): ConnectorInfo[] {
  const cache = readJson(path.join(env.agentDir, 'mcp-cache.json')).servers ?? {};
  const out: ConnectorInfo[] = [];
  const scopes: ('user' | 'project')[] = env.project ? ['user', 'project'] : ['user'];
  for (const scope of scopes) {
    const servers = readJson(mcpFile(env, scope)).mcpServers;
    if (!servers || typeof servers !== 'object') continue;
    for (const [name, raw] of Object.entries<any>(servers)) {
      if (!raw || typeof raw !== 'object') continue;
      const http = typeof raw.url === 'string';
      const stdio = typeof raw.command === 'string';
      // A project entry without command/url only overrides a user entry; it is not a server of its own.
      if (!http && !stdio) continue;
      out.push({
        name, scope,
        transport: http ? 'http' : 'stdio',
        target: http ? raw.url : [raw.command, ...(Array.isArray(raw.args) ? raw.args : [])].join(' '),
        command: stdio ? raw.command : undefined,
        args: stdio && Array.isArray(raw.args) ? raw.args.map(String) : undefined,
        url: http ? raw.url : undefined,
        pairs: Object.entries<any>((http ? raw.headers : raw.env) ?? {}).map(([k, v]) => `${k}${http ? ': ' : '='}${v}`),
        description: typeof raw.description === 'string' ? raw.description : undefined,
        enabled: raw.enabled !== false,
        tools: (cache[name]?.tools ?? []).map((t: any) => ({ name: String(t.name), description: String(t.description ?? '') })),
      });
    }
  }
  return out;
}

const splitPair = (line: string, sep: string): [string, string] | null => {
  const i = line.indexOf(sep);
  return i > 0 ? [line.slice(0, i).trim(), line.slice(i + 1).trim()] : null;
};

export function saveConnector(env: CustomizeEnv, draft: ConnectorDraft) {
  const name = draft.name.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(tr('ag.nameRuleShort'));
  const file = mcpFile(env, draft.scope);
  const config = readJson(file);
  const servers: Record<string, any> = config.mcpServers && typeof config.mcpServers === 'object' ? config.mcpServers : {};
  const key = (n: string) => n.replace(/-/g, '_').toLowerCase();
  const clash = Object.keys(servers).find((n) => key(n) === key(name) && n !== (draft.originalName ?? ''));
  if (clash) throw new Error(tr('ag.connectorExists', { name: clash }));
  const previous = draft.originalName ? servers[draft.originalName] : undefined;
  const entry: Record<string, any> = {};
  if (draft.transport === 'http') {
    const url = draft.url?.trim() ?? '';
    if (!/^https?:\/\//i.test(url)) throw new Error(tr('ag.needHttpUrl'));
    entry.url = url;
    const headers = Object.fromEntries((draft.pairs ?? []).map((l) => splitPair(l, ':')).filter((p): p is [string, string] => !!p));
    if (Object.keys(headers).length) entry.headers = headers;
    // Keep what the form does not edit (OAuth settings and the like).
    for (const k of ['auth', 'oauth']) if (previous?.[k]) entry[k] = previous[k];
  } else {
    const command = draft.command?.trim() ?? '';
    if (!command) throw new Error(tr('ag.needCommand'));
    entry.command = command;
    if (draft.args?.length) entry.args = draft.args;
    const env_ = Object.fromEntries((draft.pairs ?? []).map((l) => splitPair(l, '=')).filter((p): p is [string, string] => !!p));
    if (Object.keys(env_).length) entry.env = env_;
    if (previous?.cwd) entry.cwd = previous.cwd;
  }
  if (draft.description?.trim()) entry.description = draft.description.trim();
  for (const k of ['enabled', 'exposure', 'toolExposure', 'timeout']) if (previous?.[k] !== undefined) entry[k] = previous[k];
  if (draft.originalName && draft.originalName !== name) delete servers[draft.originalName];
  servers[name] = entry;
  writeJson(file, { ...config, mcpServers: servers });
  return catalog(env);
}

export function setConnectorEnabled(env: CustomizeEnv, name: string, scope: 'user' | 'project', enabled: boolean) {
  const file = mcpFile(env, scope);
  const config = readJson(file);
  const entry = config.mcpServers?.[name];
  if (!entry) throw new Error(tr('ag.connectorMissing', { name }));
  if (enabled) delete entry.enabled;
  else entry.enabled = false;
  writeJson(file, config);
  return catalog(env);
}

export function removeConnector(env: CustomizeEnv, name: string, scope: 'user' | 'project') {
  const file = mcpFile(env, scope);
  const config = readJson(file);
  if (config.mcpServers?.[name]) delete config.mcpServers[name];
  writeJson(file, config);
  return catalog(env);
}

// ------------------------------------------------------------ plugins (pi packages)

/**
 * pi runs npm/git with inherited stdio and no `windowsHide`, which pops a console window on
 * Windows. Swap its two spawn helpers (private in the typings) for hidden, piped ones.
 */
function hideChildWindows(pm: DefaultPackageManager) {
  const patch = pm as unknown as {
    spawnCommand: (command: string, args: string[], options?: { cwd?: string }) => ReturnType<typeof spawn>;
    spawnCaptureCommand: (command: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }) => ReturnType<typeof spawn>;
  };
  const hidden = (command: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }) =>
    spawn(command, args, { cwd: options?.cwd, env: { ...process.env, ...options?.env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  patch.spawnCommand = (command, args, options) => {
    const child = hidden(command, args, options);
    child.stdout?.resume();
    child.stderr?.resume();
    return child;
  };
  patch.spawnCaptureCommand = hidden;
  return pm;
}

function packageManager(env: CustomizeEnv) {
  const cwd = env.project ?? env.agentDir;
  const settingsManager = SettingsManager.create(cwd, env.agentDir, { projectTrusted: env.projectTrusted });
  return hideChildWindows(new DefaultPackageManager({ cwd, agentDir: env.agentDir, settingsManager }));
}

export async function installPlugin(env: CustomizeEnv, source: string, scope: 'user' | 'project') {
  const s = source.trim();
  if (!s) throw new Error(tr('ag.needPackage'));
  if (scope === 'project' && !env.project) throw new Error(tr('ag.needProjectShort'));
  await packageManager(env).installAndPersist(s, { local: scope === 'project' });
  return catalog(env);
}

export async function removePlugin(env: CustomizeEnv, source: string, scope: 'user' | 'project') {
  const removed = await packageManager(env).removeAndPersist(source, { local: scope === 'project' });
  if (!removed) throw new Error(tr('ag.pluginNotIn', { source, scope: tr(scope === 'project' ? 'ag.scopeProject' : 'ag.scopeGlobal') }));
  return catalog(env);
}

export async function updatePlugins(env: CustomizeEnv, source: string | null) {
  await packageManager(env).update(source ?? undefined);
  return catalog(env);
}

// ------------------------------------------------------------ catalog

export async function catalog(env: CustomizeEnv): Promise<CustomizeCatalog> {
  const { loader } = await loadResources(env);
  const plugins: PluginInfo[] = packageManager(env).listConfiguredPackages().map((p) => ({
    source: p.source, scope: p.scope, installedPath: p.installedPath, filtered: p.filtered,
  }));
  const prompts: PromptInfo[] = loader.getPrompts().prompts.map((p) => ({
    name: p.name, description: p.description, file: p.filePath, scope: scopeOf(p.sourceInfo),
  }));
  return {
    skills: collectSkills(env, loader.getSkills()),
    connectors: collectConnectors(env),
    plugins,
    prompts,
    dirs: {
      agent: env.agentDir,
      skills: path.join(env.agentDir, 'skills'),
      agentsSkills: agentsSkillsDir(),
      prompts: path.join(env.agentDir, 'prompts'),
    },
    claudeSkills: claudeSkillsOffer(env),
    project: env.project,
    projectTrusted: env.projectTrusted,
  };
}
