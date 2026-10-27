import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalog, createSkill, importClaudeSkills, removeConnector, saveConnector, setConnectorEnabled, setSkillDisabled, type CustomizeEnv } from '../src/agent/customize';
import { setActiveLocale } from '../src/shared/i18n/runtime';

// These assertions read the host's Chinese messages.
setActiveLocale('zh');

/** pi also loads ~/.agents/skills, so only look at the skills this test made. */
const mine = (c: { skills: { name: string; disabled: boolean }[] }) => c.skills.filter((s) => ['alpha', 'beta'].includes(s.name)).map((s) => [s.name, s.disabled]);

let root: string;
let env: CustomizeEnv;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-customize-'));
  const agentDir = path.join(root, 'agent');
  const project = path.join(root, 'project');
  fs.mkdirSync(path.join(agentDir, 'skills', 'alpha'), { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(agentDir, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: First skill\n---\nDo alpha.\n');
  env = { agentDir, project, projectTrusted: true, claudeSkillsDeclined: false };
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('customize skills', () => {
  it('lists a skill, keeps it listed once disabled, and brings it back', async () => {
    const file = path.join(env.agentDir, 'skills', 'alpha', 'SKILL.md');
    expect(mine(await catalog(env))).toEqual([['alpha', false]]);
    const off = await setSkillDisabled(env, file, true);
    expect(mine(off)).toEqual([['alpha', true]]);
    const on = await setSkillDisabled(env, file, false);
    expect(mine(on)).toEqual([['alpha', false]]);
    expect(JSON.parse(fs.readFileSync(path.join(env.agentDir, 'settings.json'), 'utf8')).skills).toBeUndefined();
  });

  it('creates a project skill and rejects duplicates', async () => {
    const draft = { name: 'beta', description: 'Second', body: 'Do beta.', scope: 'project' as const };
    const made = await createSkill(env, draft);
    expect(made.skills.find((s) => s.name === 'beta')?.scope).toBe('project');
    await expect(createSkill(env, draft)).rejects.toThrow('已经有');
  });
});

describe('customize skills outside pi\'s folder', () => {
  const saved = { HOME: process.env.HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
  let home: string;
  beforeAll(() => {
    home = path.join(root, 'home');
    fs.mkdirSync(path.join(home, '.claude', 'skills', 'gamma'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'skills', 'gamma', 'SKILL.md'), '---\nname: gamma\ndescription: From Claude\n---\nDo gamma.\n');
    process.env.HOME = home;
    delete process.env.CLAUDE_CONFIG_DIR;
  });
  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('creates a skill in the shared .agents folder', async () => {
    const made = await createSkill(env, { name: 'delta', description: 'Shared', body: 'Do delta.', scope: 'user', home: 'agents' });
    expect(fs.existsSync(path.join(home, '.agents', 'skills', 'delta', 'SKILL.md'))).toBe(true);
    expect(made.dirs.agentsSkills).toBe(path.join(home, '.agents', 'skills'));
  });

  it('offers Claude Code skills without loading them, until imported or declined', async () => {
    const before = await catalog(env);
    expect(before.claudeSkills).toEqual({ dir: path.join(home, '.claude', 'skills'), count: 1 });
    expect(before.skills.some((s) => s.name === 'gamma')).toBe(false);
    expect((await catalog({ ...env, claudeSkillsDeclined: true })).claudeSkills).toBeNull();

    const after = await importClaudeSkills(env);
    expect(after.claudeSkills).toBeNull();
    expect(after.skills.find((s) => s.name === 'gamma')?.scope).toBe('user');
  });
});

describe('customize connectors', () => {
  it('saves, toggles, renames and removes an MCP server without touching other keys', async () => {
    const file = path.join(env.agentDir, 'mcp.json');
    fs.writeFileSync(file, JSON.stringify({ mcpServers: {}, other: 1 }));
    let c = saveConnector(env, { name: 'docs', scope: 'user', transport: 'http', url: 'https://example.com/mcp', pairs: ['Authorization: Bearer ${T}'] });
    expect((await c).connectors).toMatchObject([{ name: 'docs', transport: 'http', enabled: true }]);
    c = setConnectorEnabled(env, 'docs', 'user', false);
    expect((await c).connectors[0].enabled).toBe(false);
    c = saveConnector(env, { originalName: 'docs', name: 'docs2', scope: 'user', transport: 'stdio', command: 'npx', args: ['-y', 'x'], pairs: ['K=V'] });
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(saved.other).toBe(1);
    expect(saved.mcpServers).toEqual({ docs2: { command: 'npx', args: ['-y', 'x'], env: { K: 'V' }, enabled: false } });
    expect((await c).connectors[0].target).toBe('npx -y x');
    c = removeConnector(env, 'docs2', 'user');
    expect((await c).connectors).toEqual([]);
  });

  it('rejects bad input', () => {
    expect(() => saveConnector(env, { name: 'bad name', scope: 'user', transport: 'stdio', command: 'x' })).toThrow();
    expect(() => saveConnector(env, { name: 'ok', scope: 'user', transport: 'http', url: 'ftp://x' })).toThrow('http');
  });
});
