import { createAssistantMessageEventStream, type AssistantMessage, type AssistantMessageEvent } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { MaskBlocked, Redactor, previewMasking } from '../src/agent/request-hook/redact';
import { restoreStream, splitOpenTail } from '../src/agent/request-hook/restore';
import { DEFAULT_REDACT_SETTINGS, normalizeRedactSettings, type RedactSettings } from '../src/shared/request-log';

const on = (over: Partial<RedactSettings> = {}): RedactSettings => normalizeRedactSettings({ ...DEFAULT_REDACT_SETTINGS, secrets: true, personal: true, ...over });
const mask = (text: string, s = on()) => previewMasking(text, s);

describe('secret rules', () => {
  it('masks keys by their shape', () => {
    const keys = [
      'sk-ant-api03-abcdefghijklmnopqrstuvwx', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'AKIAABCDEFGHIJKLMNOP',
      'xoxb-1234567890-abcdefghij', 'hf_abcdefghijklmnopqrstuvwxyz0123456789', 'npm_abcdefghijklmnopqrstuvwxyz0123456789',
    ];
    for (const key of keys) {
      const { text, masked } = mask(`use ${key} now`);
      expect(text, key).toMatch(/^use \{\{API_KEY_[0-9a-f]{8}\}\} now$/);
      expect(masked.API_KEY).toBe(1);
    }
  });

  it('masks private keys, JWTs and the password in a URL', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nabc\ndef\n-----END RSA PRIVATE KEY-----';
    expect(mask(`k:\n${pem}\nend`).text).toMatch(/^k:\n\{\{PRIVATE_KEY_[0-9a-f]{8}\}\}\nend$/);
    expect(mask('t eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk').masked.JWT).toBe(1);
    const url = mask('postgres://admin:hunter2hunter2@db.local/app');
    expect(url.text).toMatch(/^postgres:\/\/admin:\{\{PASSWORD_[0-9a-f]{8}\}\}@db\.local\/app$/);
  });

  it('masks the value of a secret-named field and keeps the name', () => {
    expect(mask('DB_PASSWORD=correct-horse-battery').text).toMatch(/^DB_PASSWORD=\{\{PASSWORD_[0-9a-f]{8}\}\}$/);
    expect(mask('{"api_key": "abcd1234efgh5678"}').text).toMatch(/^\{"api_key": "\{\{PASSWORD_[0-9a-f]{8}\}\}"\}$/);
    expect(mask('password = short').text).toBe('password = short');
  });
});

describe('personal data rules', () => {
  it('masks emails and mainland mobile numbers', () => {
    const { text, masked } = mask('mail a.b@example.com or call 13812345678');
    expect(text).toMatch(/^mail \{\{EMAIL_[0-9a-f]{8}\}\} or call \{\{PHONE_[0-9a-f]{8}\}\}$/);
    expect(masked).toEqual({ EMAIL: 1, PHONE: 1 });
  });

  it('leaves an 11-digit id alone', () => {
    expect(mask('order_id: 13812345678').text).toBe('order_id: 13812345678');
    expect(mask('订单号 13812345678').text).toBe('订单号 13812345678');
  });

  it('masks only checksum-valid ID and card numbers', () => {
    expect(mask('id 11010519491231002X').masked.ID_CARD).toBe(1);
    expect(mask('id 110105194912310021').masked.ID_CARD).toBeUndefined();
    expect(mask('card 4111111111111111').masked.BANK_CARD).toBe(1);
    expect(mask('card 4111111111111112').masked.BANK_CARD).toBeUndefined();
  });

  it('does nothing while the switches are off', () => {
    expect(mask('a@b.com sk-ant-api03-abcdefghijklmnopqrstuvwx', on({ secrets: false, personal: false })).text).toContain('a@b.com');
  });
});

describe('words, rules and actions', () => {
  it('masks words whatever their case', () => {
    const { text } = mask('Nightjar and NIGHTJAR', on({ secrets: false, personal: false, words: ['nightjar'] }));
    expect(text).toMatch(/^\{\{TERM_[0-9a-f]{8}\}\} and \{\{TERM_[0-9a-f]{8}\}\}$/);
  });

  it('masks a custom prefix and a custom regex', () => {
    const s = on({ secrets: false, personal: false, rules: [{ pattern: 'gw_', regex: false }, { pattern: 'ID-\\d{4}', regex: true }] });
    expect(mask('k gw_abc123 and ID-4242', s).masked).toEqual({ CUSTOM: 2 });
  });

  it('sends allowed values as written', () => {
    expect(mask('team@example.com', on({ allow: ['team@example.com'] })).text).toBe('team@example.com');
  });

  it('warns without masking, and blocks without the value in the message', () => {
    const warn = mask('a@b.com', on({ actions: { EMAIL: 'warn' } }));
    expect(warn).toMatchObject({ text: 'a@b.com', warned: { EMAIL: 1 }, masked: {} });
    expect(mask('a@b.com', on({ actions: { EMAIL: 'block' } })).blocked).toBe('EMAIL');
    const pass = new Redactor().begin(on({ actions: { EMAIL: 'block' } }));
    expect(() => pass.maskText('a@b.com')).toThrow(MaskBlocked);
    try {
      pass.maskText('a@b.com');
    } catch (e) {
      expect((e as Error).message).toContain('7');
      expect((e as Error).message).not.toContain('a@b.com');
    }
  });

  it('ignores a custom regex that does not compile', () => {
    expect(mask('x', on({ rules: [{ pattern: '(', regex: true }] })).text).toBe('x');
  });
});

describe('placeholders', () => {
  it('are the same for the same value and different for others', () => {
    const r = new Redactor();
    const a = r.begin(on()).maskText('a@b.com a@b.com c@d.com').split(' ');
    expect(a[0]).toBe(a[1]);
    expect(a[0]).not.toBe(a[2]);
  });

  it('mask a known value again where no rule finds it, and restore it', () => {
    const r = new Redactor();
    const first = r.begin(on()).maskText('PASSWORD=correct-horse-battery');
    const again = r.begin(on()).maskText('the password is correct-horse-battery, ok?');
    expect(again).toMatch(/^the password is \{\{PASSWORD_[0-9a-f]{8}\}\}, ok\?$/);
    expect(r.restore(first)).toBe('PASSWORD=correct-horse-battery');
    expect(r.restore(again)).toBe('the password is correct-horse-battery, ok?');
  });

  it('are not masked twice', () => {
    const r = new Redactor();
    const once = r.begin(on()).maskText('a@b.com');
    expect(r.begin(on()).maskText(once)).toBe(once);
  });
});

describe('payload', () => {
  it("masks the user's strings and keeps ids, names, signatures and schemas", () => {
    const r = new Redactor();
    const payload = {
      model: 'claude-x',
      system: 'mail a@b.com',
      tools: [{ name: 'a@b.com', description: 'send to a@b.com', input_schema: { properties: { to: { description: 'a@b.com' } } } }],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'my key sk-ant-api03-abcdefghijklmnopqrstuvwx' }] },
        { role: 'assistant', content: [{ type: 'thinking', thinking: 'a@b.com', signature: 'sig-a@b.com' }, { type: 'tool_use', id: 'toolu_1', name: 'write', input: { name: 'a@b.com' } }] },
      ],
    };
    const out = r.begin(on()).maskPayload(payload) as typeof payload;
    expect(out.model).toBe('claude-x');
    expect(out.system).toMatch(/^mail \{\{EMAIL_/);
    expect(out.tools[0].name).toBe('a@b.com');
    expect(out.tools[0].description).toMatch(/^send to \{\{EMAIL_/);
    expect(out.tools[0].input_schema).toEqual(payload.tools[0].input_schema);
    expect(out.messages[0].content[0]).toMatchObject({ text: expect.stringMatching(/^my key \{\{API_KEY_/) });
    expect(out.messages[1].content[0]).toEqual(payload.messages[1].content[0]);
    expect(out.messages[1].content[1]).toMatchObject({ id: 'toolu_1', name: 'write', input: { name: expect.stringMatching(/^\{\{EMAIL_/) } });
    expect(payload.system).toBe('mail a@b.com'); // the original is untouched
  });

  it('leaves data URIs alone', () => {
    const uri = 'data:image/png;base64,a@b.comAAAA';
    expect(new Redactor().begin(on()).maskPayload({ image_url: { url: uri } })).toEqual({ image_url: { url: uri } });
  });
});

describe('restoring a stream', () => {
  const msg = (content: AssistantMessage['content']): AssistantMessage =>
    ({ role: 'assistant', content, api: 'x', provider: 'p', model: 'm', stopReason: 'stop', timestamp: 0, usage: {} }) as unknown as AssistantMessage;

  async function run(deltas: string[], redactor: Redactor, active = true) {
    const source = createAssistantMessageEventStream();
    const full = deltas.join('');
    let text = '';
    const events: AssistantMessageEvent[] = [{ type: 'start', partial: msg([]) }, { type: 'text_start', contentIndex: 0, partial: msg([{ type: 'text', text: '' }]) }];
    for (const d of deltas) {
      text += d;
      events.push({ type: 'text_delta', contentIndex: 0, delta: d, partial: msg([{ type: 'text', text }]) });
    }
    const final = msg([{ type: 'text', text: full }]);
    events.push({ type: 'text_end', contentIndex: 0, content: full, partial: final }, { type: 'done', reason: 'stop', message: final });
    const out = restoreStream(source, redactor, () => active);
    for (const e of events) source.push(e);
    source.end();
    const seen: AssistantMessageEvent[] = [];
    for await (const e of out) seen.push(e);
    return { seen, result: await out.result() };
  }

  const deltaText = (seen: AssistantMessageEvent[]) => seen.flatMap((e) => (e.type === 'text_delta' ? [e.delta] : [])).join('');

  it('restores a placeholder however the chunks cut it', async () => {
    const r = new Redactor();
    const placeholder = r.begin(on()).maskText('a@b.com');
    const text = `write to ${placeholder}, thanks`;
    for (let cut = 1; cut < text.length; cut++) {
      const { seen, result } = await run([text.slice(0, cut), text.slice(cut)], r);
      expect(deltaText(seen), `cut at ${cut}`).toBe('write to a@b.com, thanks');
      expect((result.content[0] as { text: string }).text).toBe('write to a@b.com, thanks');
    }
  });

  it('restores a placeholder spread over many chunks, and passes a stray brace', async () => {
    const r = new Redactor();
    const placeholder = r.begin(on()).maskText('a@b.com');
    const { seen } = await run([...`x ${placeholder} {y`], r);
    expect(deltaText(seen)).toBe('x a@b.com {y');
  });

  it('does not touch a stream with nothing masked', async () => {
    const { seen } = await run(['hello {{EMAIL_00000000}}'], new Redactor(), false);
    expect(deltaText(seen)).toBe('hello {{EMAIL_00000000}}');
  });

  it('restores tool-call arguments, escaped inside the streamed JSON', async () => {
    const r = new Redactor();
    const value = 'pa"ss\\word-long';
    const placeholder = r.placeholderFor('PASSWORD', value);
    const raw = `{"path":"${placeholder}"}`;
    const source = createAssistantMessageEventStream();
    const call = (args: Record<string, string>) => msg([{ type: 'toolCall', id: 't', name: 'w', arguments: args }]);
    const out = restoreStream(source, r, () => true);
    source.push({ type: 'toolcall_delta', contentIndex: 0, delta: raw.slice(0, 12), partial: call({}) });
    source.push({ type: 'toolcall_delta', contentIndex: 0, delta: raw.slice(12), partial: call({}) });
    const final = call({ path: placeholder });
    source.push({ type: 'toolcall_end', contentIndex: 0, toolCall: final.content[0] as never, partial: final });
    source.push({ type: 'done', reason: 'toolUse', message: final });
    source.end();
    const seen: AssistantMessageEvent[] = [];
    for await (const e of out) seen.push(e);
    const streamed = seen.flatMap((e) => (e.type === 'toolcall_delta' ? [e.delta] : [])).join('');
    expect(JSON.parse(streamed)).toEqual({ path: value });
    expect(((await out.result()).content[0] as unknown as { arguments: { path: string } }).arguments.path).toBe(value);
  });

  it('keeps reasoning as the vendor wrote it', async () => {
    const r = new Redactor();
    const placeholder = r.begin(on()).maskText('a@b.com');
    const source = createAssistantMessageEventStream();
    const out = restoreStream(source, r, () => true);
    const final = msg([{ type: 'thinking', thinking: placeholder, thinkingSignature: 's' }]);
    source.push({ type: 'done', reason: 'stop', message: final });
    source.end();
    expect(((await out.result()).content[0] as { thinking: string }).thinking).toBe(placeholder);
  });

  it('splits only an open tail', () => {
    expect(splitOpenTail('ab {{API_KEY_3f')).toEqual(['ab ', '{{API_KEY_3f']);
    expect(splitOpenTail('ab {')).toEqual(['ab ', '{']);
    expect(splitOpenTail('ab {{A_12345678}}')).toEqual(['ab {{A_12345678}}', '']);
    expect(splitOpenTail('ab {{A_12345678}')).toEqual(['ab ', '{{A_12345678}']);
    expect(splitOpenTail('plain')).toEqual(['plain', '']);
  });
});
