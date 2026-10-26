import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAgents } from '../src/agent/agents';

let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-agents-'));
  fs.writeFileSync(path.join(dir, 'reviewer.md'), '---\ndescription: Reviews a diff\nmodel: anthropic/claude-sonnet-5-5\ntools: read, grep\n---\nYou review code.\n');
  fs.writeFileSync(path.join(dir, 'explore.md'), '---\nname: explore\ndescription: My explorer\n---\nBe thorough.\n');
  fs.writeFileSync(path.join(dir, 'no-description.md'), '---\nname: broken\n---\nbody\n');
  fs.writeFileSync(path.join(dir, 'bad name.md'), '---\ndescription: x\n---\nbody\n');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored');
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('loadAgents', () => {
  it('returns the built-ins when there is no folder', () => {
    expect(loadAgents(path.join(dir, 'missing')).map((a) => a.name)).toEqual(['explore', 'plan']);
    expect(loadAgents(undefined).map((a) => a.name)).toEqual(['explore', 'plan']);
  });

  it('adds user agents, lets a user file replace a built-in, and skips invalid files', () => {
    const agents = loadAgents(dir);
    expect(agents.map((a) => a.name).sort()).toEqual(['explore', 'plan', 'reviewer']);
    const reviewer = agents.find((a) => a.name === 'reviewer')!;
    expect(reviewer).toMatchObject({ description: 'Reviews a diff', model: 'anthropic/claude-sonnet-5-5', tools: ['read', 'grep'], source: 'user' });
    expect(reviewer.body).toBe('You review code.');
    expect(agents.find((a) => a.name === 'explore')).toMatchObject({ description: 'My explorer', source: 'user' });
    expect(agents.find((a) => a.name === 'plan')?.source).toBe('builtin');
  });
});

describe('saveAgent / removeAgent', () => {
  it('writes a file that loads back, renames by moving it, and removing a built-in override restores the built-in', async () => {
    const { saveAgent, removeAgent } = await import('../src/agent/agents');
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-agents-save-'));
    try {
      let cat = saveAgent(d, { name: 'tester', description: 'Runs: tests "quickly"', body: 'Run the suite.', model: 'a/b', tools: ['read', 'grep'] });
      expect(cat.agents.find((a) => a.name === 'tester')).toMatchObject({ description: 'Runs: tests "quickly"', model: 'a/b', tools: ['read', 'grep'], source: 'user' });

      cat = saveAgent(d, { originalName: 'tester', name: 'checker', description: 'd', body: 'b' });
      expect(cat.agents.map((a) => a.name)).toContain('checker');
      expect(cat.agents.map((a) => a.name)).not.toContain('tester');
      expect(fs.existsSync(path.join(d, 'tester.md'))).toBe(false);

      cat = saveAgent(d, { originalName: 'plan', name: 'plan', description: 'mine', body: 'custom plan' });
      expect(cat.agents.find((a) => a.name === 'plan')).toMatchObject({ overrides: true, body: 'custom plan' });
      cat = removeAgent(d, 'plan');
      expect(cat.agents.find((a) => a.name === 'plan')).toMatchObject({ source: 'builtin' });
      expect(() => removeAgent(d, 'explore')).toThrow();

      expect(() => saveAgent(d, { name: 'bad name', description: 'd', body: 'b' })).toThrow();
      expect(() => saveAgent(d, { name: 'x', description: '', body: 'b' })).toThrow();
      expect(() => saveAgent(d, { name: 'checker', description: 'dup', body: 'b' })).toThrow(/已经有/);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });
});
