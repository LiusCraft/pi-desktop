import { describe, expect, it } from 'vitest';
import { createDesktopKit, type KitHost, type KitRequest } from '../src/agent/desktop-kit';
import { QUESTION_LIMITS, type UiResponse } from '../src/shared/protocol';

function load(reply: UiResponse) {
  const tools = new Map<string, any>();
  const requests: KitRequest[] = [];
  const pi = { on: () => {}, getAllTools: () => [], registerTool: (t: any) => tools.set(t.name, t) };
  const state = { mode: 'plan', profile: 'code', outputStyle: 'default', allowed: new Set<string>() } as KitHost['state'];
  createDesktopKit({ state, ask: async (r) => (requests.push(r), reply), setMode: () => {} })(pi as any);
  return { tool: tools.get('pidesk_ask_question'), requests };
}

const questions = [
  { question: 'Which database?', header: 'A very long header indeed', options: [{ label: 'SQLite', preview: '```sql\nSELECT 1;\n```' }, { label: 'Postgres' }] },
  { question: 'Which extras?', header: 'Extras', multiSelect: true, options: [{ label: 'Auth', preview: 'ignored' }, { label: 'Cache' }] },
];

describe('pidesk_ask_question', () => {
  it('sends all questions in one request, trims headers and drops previews on multi-select', async () => {
    const { tool, requests } = load({ answers: [{ selected: ['SQLite'] }, { selected: ['Auth'], other: 'Metrics' }] });
    await tool.execute('call-1', { questions }, undefined);
    const req = requests[0];
    if (req.kind !== 'questions') throw new Error('expected a questions request');
    expect(req.toolCallId).toBe('call-1');
    expect(req.questions[0].header).toHaveLength(QUESTION_LIMITS.header);
    expect(req.questions[0].options[0].preview).toMatch(/SELECT 1/);
    expect(req.questions[1].multiSelect).toBe(true);
    expect(req.questions[1].options[0].preview).toBeUndefined();
  });

  it('reports each answer, including free-text ones, back to the model', async () => {
    const { tool } = load({ answers: [{ selected: ['SQLite'] }, { selected: ['Auth'], other: 'Metrics' }] });
    const result = await tool.execute('call-1', { questions }, undefined);
    expect(result.details.status).toBe('answered');
    expect(result.content[0].text).toContain('Which database?\n  → "SQLite"');
    expect(result.content[0].text).toContain('"Auth", their own answer: "Metrics"');
  });

  it('tells the model not to guess when the user dismisses it', async () => {
    const { tool } = load({ cancelled: true });
    const result = await tool.execute('call-1', { questions }, undefined);
    expect(result.details.status).toBe('cancelled');
    expect(result.content[0].text).toMatch(/dismissed/);
  });
});
