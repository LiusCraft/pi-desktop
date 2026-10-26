import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalog, createSkill, removeConnector, saveConnector, setConnectorEnabled, setSkillDisabled, type CustomizeEnv } from '../src/agent/customize';

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
  env = { agentDir, project, projectTrusted: true };
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
