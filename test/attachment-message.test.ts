// @ts-nocheck -- ported from untyped JS; these tests feed deliberately malformed input to runtime validators.
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { LIMITS, buildMessage, decodeUserContent, imageSource, validateAttachments } from '@shared/attachments';

const START = '[pi-desktop:attachments:v1]\n';
const END = '\n[/pi-desktop:attachments]';
const PNG = 'iVBORw0KGgo=';
const JPEG = '/9j/2Q==';
const image = (id = 'image-1', overrides = {}) => ({
  id,
  kind: 'image',
  name: 'same.png',
  mimeType: 'image/png',
  size: 8,
  data: PNG,
  ...overrides,
});
const file = (id = 'file-1', overrides = {}) => ({
  id,
  kind: 'file',
  name: 'notes.txt',
  mimeType: 'text/plain',
  size: 0,
  path: '/tmp/notes.txt',
  ...overrides,
});
const native = (built) => [{ type: 'text', text: built.message }, ...built.images];
const manifestOf = (message) => JSON.parse(message.slice(message.lastIndexOf(START) + START.length, -END.length));
const encodeManifest = (manifest, text = '') => `${text}\n\n${START}${JSON.stringify(manifest)}${END}`;
const validManifest = (text = '') => ({
  v: 1,
  textLength: text.length,
  items: [{ id: 'image-1', kind: 'image', name: 'same.png', mimeType: 'image/png', size: 8, imageIndex: 0 }],
});
const OMIT_CONVERSION = '[Image omitted: could not be converted to a supported inline image format.]';
const OMIT_RESIZE = '[Image omitted: could not be resized below the inline image size limit.]';
const CONVERSION = '[Image converted from image/heic to image/png.]';
const DIMENSIONS =
  '[Image: original 4000x2000, displayed at 2000x1000. Multiply coordinates by 2.00 to map to original image.]';

function expectPlain(text, images = []) {
  const decoded = decodeUserContent([{ type: 'text', text }, ...images]);
  assert.equal(decoded.text, text);
  assert.equal(decoded.clientId, undefined);
  return decoded;
}

describe('attachment module surfaces', () => {
  it('has fixed shared byte, count and dimension budgets', () => {
    assert.deepEqual(LIMITS, {
      count: 10,
      fileBytes: 20 * 1024 * 1024,
      sourceBytes: 50 * 1024 * 1024,
      imageBytes: 4.5 * 1024 * 1024,
      totalImageBytes: 20 * 1024 * 1024,
      manifestBytes: 65536,
      dimension: 2000,
    });
    assert.equal(Object.isFrozen(LIMITS), true);
  });
});

describe('attachment message round trips', () => {
  it('leaves text-only messages exactly untouched and emits no manifest', () => {
    for (const text of ['', '  \n\t', '你好 👨‍👩‍👦\r\n next \n', START + '{}\n' + END]) {
      assert.deepEqual(buildMessage({ text, attachments: [] }), { message: text, images: [] });
      assert.deepEqual(decodeUserContent(text), { text, attachments: [] });
    }
    assert.deepEqual(buildMessage(), { message: '', images: [] });
  });

  it('preserves empty, Unicode, CRLF, trailing whitespace and marker-containing prompt text', () => {
    for (const text of [
      '',
      'a',
      '  leading\t\ntrailing  \n\n',
      '\r\n正文 🦊 e\u0301\u2028\u2029\r\n',
      `quote\n${START}{not:json}${END}\n`,
    ]) {
      const attachments = [file(), image()];
      const built = buildMessage({ text, attachments, clientId: 'turn-123' });
      assert.deepEqual(decodeUserContent(native(built)), { text, attachments, clientId: 'turn-123' });
      assert.equal(manifestOf(built.message).textLength, text.length);
    }
  });

  it('round trips escaped filenames and paths without interpolating them into plain text', () => {
    const attachments = [
      file('weird-file', {
        name: '报价 " [pi-desktop:attachments:v1]\n[/pi-desktop:attachments]\t\\ .txt',
        path: '/tmp/目录 "\\with\nlines\u2028\u2029.txt',
      }),
      image('weird-image', { name: '🦊 "\\\n\t\u2028\u2029.png' }),
    ];
    const built = buildMessage({ text: 'exact \n', attachments });
    assert.deepEqual(decodeUserContent(native(built)), { text: 'exact \n', attachments });
    const json = built.message.slice(built.message.lastIndexOf(START) + START.length, -END.length);
    assert.equal(/[\r\n\u2028\u2029]/.test(json), false);
    assert.equal(built.message.includes('\\u2028'), true);
  });

  it('keeps image-only indexes and duplicate filenames ordered around file references', () => {
    const attachments = [
      image('one'),
      file('two', { name: 'same.png', path: 'C:\\Users\\test\\same.png' }),
      image('three', { data: JPEG, mimeType: 'image/jpeg', size: 4 }),
      file('four', { name: 'same.png', path: '\\\\server\\share\\same.png' }),
    ];
    const built = buildMessage({ text: '', attachments, clientId: 'duplicate-names' });
    assert.deepEqual(built.images, [
      { type: 'image', data: PNG, mimeType: 'image/png' },
      { type: 'image', data: JPEG, mimeType: 'image/jpeg' },
    ]);
    assert.deepEqual(
      manifestOf(built.message).items.map((item) => item.imageIndex),
      [0, undefined, 1, undefined],
    );
    assert.deepEqual(decodeUserContent(native(built)), { text: '', attachments, clientId: 'duplicate-names' });
  });

  it('stores metadata only, with no file content or duplicate base64 bytes in the manifest', () => {
    const built = buildMessage({ text: 'hello', attachments: [image(), file()], clientId: 'client' });
    const manifest = manifestOf(built.message);
    assert.deepEqual(manifest, {
      v: 1,
      textLength: 5,
      clientId: 'client',
      items: [
        { id: 'image-1', kind: 'image', name: 'same.png', mimeType: 'image/png', size: 8, imageIndex: 0 },
        { id: 'file-1', kind: 'file', name: 'notes.txt', mimeType: 'text/plain', size: 0, path: '/tmp/notes.txt' },
      ],
    });
    assert.equal(built.message.includes(PNG), false);
    assert.equal(
      manifest.items.some((item) => 'data' in item),
      false,
    );
  });

  it('does not mutate descriptors, block arrays or manifest data', () => {
    const attachments = Object.freeze([Object.freeze(image()), Object.freeze(file())]);
    assert.equal(validateAttachments(attachments), attachments);
    const built = buildMessage({ text: 'x', attachments });
    const blocks = Object.freeze(native(built).map(Object.freeze));
    const before = JSON.stringify(blocks);
    decodeUserContent(blocks);
    assert.equal(JSON.stringify(blocks), before);
  });

  it('joins native text blocks without inventing whitespace', () => {
    const built = buildMessage({ text: '\n你好\t', attachments: [image()] });
    const split = 8;
    assert.deepEqual(
      decodeUserContent([
        { type: 'text', text: built.message.slice(0, split) },
        { type: 'unknown', text: 'ignored' },
        ...built.images,
        { type: 'text', text: built.message.slice(split) },
        null,
      ]),
      { text: '\n你好\t', attachments: [image()] },
    );
  });
});

describe('strict attachment validation', () => {
  it('accepts exactly ten items and rejects extra items or non-arrays', () => {
    const attachments = Array.from({ length: LIMITS.count }, (_, index) => file(`file-${index}`));
    assert.equal(validateAttachments(attachments), attachments);
    assert.throws(() => validateAttachments([...attachments, file('extra')]), /10 attachments/);
    for (const value of [null, undefined, {}, '', 4]) assert.throws(() => validateAttachments(value), /array/);
  });

  it('validates complete descriptor schemas, IDs, MIME, kinds, names and absolute paths', () => {
    const bad = [
      null,
      [],
      {},
      image(''),
      image(1),
      image('one', { kind: 'video' }),
      image('one', { name: '' }),
      image('one', { id: 'a'.repeat(257) }),
      image('one', { name: 'a'.repeat(4097) }),
      image('one', { mimeType: '' }),
      file('one', { mimeType: 'bad type' }),
      image('one', { mimeType: 'image/svg+xml' }),
      image('one', { mimeType: 'image/jpg' }),
      image('one', { mimeType: 'image/png; charset=utf-8' }),
      image('one', { data: 'data:image/png;base64,' + PNG }),
      image('one', { path: '/unwanted.png' }),
      file('one', { data: PNG }),
      image('one', { width: 1 }),
      file('one', { path: './relative.txt' }),
      file('one', { path: '~/notes.txt' }),
      file('one', { path: 'C:relative.txt' }),
      file('one', { path: '\\root-relative.txt' }),
      file('one', { path: 'file:///tmp/notes.txt' }),
      file('one', { path: '/tmp/null\0.txt' }),
      file('one', { name: 'null\0.txt' }),
    ];
    for (const attachment of bad)
      assert.throws(() => validateAttachments([attachment]), Error, JSON.stringify(attachment));
    assert.throws(() => validateAttachments([file('same'), image('same')]), /unique/);
    for (const key of ['id', 'kind', 'name', 'mimeType', 'size', 'data']) {
      const attachment = image();
      delete attachment[key];
      assert.throws(() => validateAttachments([attachment]), /schema/);
    }
    for (const absolute of ['/tmp/notes.txt', 'C:\\temp\\notes.txt', 'Z:/notes.txt', '\\\\server\\share\\notes.txt']) {
      assert.doesNotThrow(() => validateAttachments([file('path', { path: absolute })]));
    }
  });

  it('checks finite integer source sizes, per-file and aggregate source budgets', () => {
    for (const size of [-1, 0.1, NaN, Infinity, '8', LIMITS.fileBytes + 1])
      assert.throws(() => validateAttachments([file('size', { size })]), /20 MiB/);
    assert.doesNotThrow(() => validateAttachments([file('one', { size: LIMITS.fileBytes })]));
    const sources = [
      file('one', { size: LIMITS.fileBytes }),
      file('two', { size: LIMITS.fileBytes }),
      image('three', { size: LIMITS.sourceBytes - LIMITS.fileBytes * 2 }),
    ];
    assert.doesNotThrow(() => validateAttachments(sources));
    sources[2].size++;
    assert.throws(() => validateAttachments(sources), /50 MiB/);
  });

  it('budgets images by base64 UTF8 bytes, independently of original source sizes', () => {
    const maxData = 'A'.repeat(LIMITS.imageBytes);
    assert.doesNotThrow(() => validateAttachments([image('max', { data: maxData, size: LIMITS.fileBytes })]));
    assert.throws(() => validateAttachments([image('max', { data: maxData + 'AAAA' })]), /4.5 MiB/);
    const images = Array.from({ length: 4 }, (_, index) => image(`big-${index}`, { data: maxData }));
    images.push(image('last', { data: 'A'.repeat(LIMITS.totalImageBytes - LIMITS.imageBytes * 4) }));
    assert.doesNotThrow(() => validateAttachments(images));
    images[4].data += 'AAAA';
    assert.throws(() => validateAttachments(images), /20 MiB/);
  });

  it('rejects noncanonical raw base64 and unsafe render sources', () => {
    for (const data of [
      '',
      'A',
      'AAA',
      '====',
      'AA=A',
      '=AAA',
      'AAA===',
      'A===',
      'AA==\n',
      'AA-=',
      'AB==',
      'AAB=',
      ' AA==',
      'AA== ',
      123,
      null,
      'https://host/image.png',
    ]) {
      assert.equal(imageSource(image('bad', { data })), '', String(data));
      assert.throws(() => validateAttachments([image('bad', { data })]), Error, String(data));
    }
    for (const data of ['AA==', 'AAA=', 'AAAA', PNG, JPEG])
      assert.equal(imageSource(image('good', { data })), `data:image/png;base64,${data}`);
    for (const mimeType of [
      'image/svg+xml',
      'image/bmp',
      'image/png\n',
      'image/png;foo',
      'Image/PNG',
      'text/html',
      '__proto__',
      'toString',
      'image/png;base64,AA==',
    ]) {
      assert.equal(imageSource(image('mime', { mimeType })), '', mimeType);
    }
    for (const mimeType of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      assert.equal(imageSource(image('mime', { mimeType })), `data:${mimeType};base64,${PNG}`);
    }
    assert.equal(imageSource(file()), '');
    assert.equal(imageSource(null), '');
    assert.equal(imageSource({ type: 'image', data: PNG, mimeType: 'image/png' }), '');
  });

  it('bounds UTF8 manifest bytes rather than JavaScript string length', () => {
    const large = file('large', { name: '😀'.repeat(1500), path: '/' + '字'.repeat(23000) });
    assert.throws(() => buildMessage({ text: '', attachments: [large] }), /64 KiB/);
    assert.throws(() => buildMessage({ text: 1, attachments: [] }), /text.*string/);
    assert.throws(() => buildMessage({ text: '', attachments: [file()], clientId: '' }), /client ID/);
  });
});

describe('strict manifest parsing', () => {
  it('preserves malformed, embedded, middle and unknown version markers verbatim', () => {
    const valid = encodeManifest(validManifest('abc'), 'abc');
    const malformed = [
      START + '{}',
      `${START}{broken json}${END}`,
      valid + '\nextra',
      valid + '\n',
      'prefix' + valid,
      valid.replace('[pi-desktop:attachments:v1]', '[pi-desktop:attachments:v2]'),
      valid.replace('\n\n' + START, '\n' + START),
      valid.replace(END, '\n[/pi-desktop:attachments:v1]'),
      valid.replace('"v":1,', '"v":1,\n'),
      valid.replace('"v":1,', '"v":1,\r'),
      valid.replace('"v":1,', '"v":1,\u2028'),
      valid.replace(END, END + ' '),
      valid.replace('"textLength":3', '"textLength":2'),
      valid.replace('"textLength":3', '"textLength":4'),
    ];
    for (const text of malformed) expectPlain(text);
  });

  it('rejects invalid schemas, unknown properties, counts, paths and image index integrity', () => {
    const variants = [
      { v: 2 },
      { v: '1' },
      { clientId: null },
      { clientId: '' },
      { textLength: -1 },
      { textLength: 0.5 },
      { extra: true },
      { items: [] },
      { items: null },
      { items: {} },
      { items: [null] },
      { items: [{ ...validManifest().items[0], imageIndex: -1 }] },
      { items: [{ ...validManifest().items[0], imageIndex: 1 }] },
      { items: [{ ...validManifest().items[0], imageIndex: '0' }] },
      { items: [{ ...validManifest().items[0], data: PNG }] },
      { items: [{ ...validManifest().items[0], path: '/unexpected' }] },
      { items: [{ ...validManifest().items[0], kind: 'file' }] },
      { items: [{ ...validManifest().items[0], mimeType: 'image/svg+xml' }] },
      { items: [{ ...validManifest().items[0], size: -1 }] },
      { items: [{ ...validManifest().items[0], size: LIMITS.fileBytes + 1 }] },
      { items: [{ ...file(), path: 'relative.txt' }] },
      { items: [{ ...file(), imageIndex: 0 }] },
      { items: [validManifest().items[0], { ...validManifest().items[0], id: 'second', imageIndex: 0 }] },
      { items: [validManifest().items[0], { ...validManifest().items[0], imageIndex: 1 }] },
      { items: Array.from({ length: 11 }, (_, index) => ({ ...file(`file-${index}`) })) },
      { items: Array.from({ length: 3 }, (_, index) => ({ ...file(`file-${index}`, { size: LIMITS.fileBytes }) })) },
    ];
    for (const variation of variants) expectPlain(encodeManifest({ ...validManifest(), ...variation }));
    for (const key of ['v', 'textLength', 'items']) {
      const manifest = validManifest();
      delete manifest[key];
      expectPlain(encodeManifest(manifest));
    }
    for (const value of [null, [], 1, 'value']) expectPlain(encodeManifest(value));
  });

  it('does not hide a valid manifest when extra native images break index integrity', () => {
    const built = buildMessage({ text: 'look', attachments: [image()] });
    const decoded = expectPlain(built.message, [...built.images, ...built.images]);
    assert.equal(decoded.attachments.length, 2);
    assert.deepEqual(
      decoded.attachments.map((attachment) => attachment.name),
      ['Image 1.png', 'Image 2.png'],
    );
  });

  it('bounds incoming manifest bytes before parsing and preserves oversize metadata', () => {
    const large = validManifest();
    large.items = [file('huge', { path: '/' + '字'.repeat(23000) })];
    expectPlain(encodeManifest(large));
    const stringOversize = validManifest();
    stringOversize.items = [file('huge', { path: '/' + 'a'.repeat(LIMITS.manifestBytes) })];
    expectPlain(encodeManifest(stringOversize));
  });
});

describe('native image recovery and SDK normalization hints', () => {
  it('recovers generic safe names from native flat and standard base64 image blocks', () => {
    const decoded = decodeUserContent([
      { type: 'text', text: 'first\n' },
      { type: 'image', data: PNG, mimeType: 'image/png' },
      { type: 'text', text: 'second' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: JPEG } },
    ]);
    assert.equal(decoded.text, 'first\nsecond');
    assert.deepEqual(decoded.attachments, [
      { id: 'native-image-1', kind: 'image', name: 'Image 1.png', mimeType: 'image/png', size: 8, data: PNG },
      { id: 'native-image-2', kind: 'image', name: 'Image 2.jpg', mimeType: 'image/jpeg', size: 4, data: JPEG },
    ]);
  });

  it('does not fetch URL/file sources or render native unsafe MIME/base64', () => {
    const blocks = [
      { type: 'image', source: { type: 'url', url: 'https://example.com/pixel.png' } },
      { type: 'image', source: { type: 'file', file_id: 'file-id' } },
      { type: 'image', mimeType: 'image/svg+xml', data: 'PHN2Zz48L3N2Zz4=' },
      { type: 'image', mimeType: 'image/png', data: 'javascript:alert(1)' },
    ];
    const result = decodeUserContent(blocks);
    assert.equal(result.attachments.length, blocks.length);
    assert.equal(
      result.attachments.every((attachment) => attachment.missing && imageSource(attachment) === ''),
      true,
    );
    assert.match(result.notice, /unavailable/);
  });

  it('retains named metadata for absent or invalid image data with explicit missing state', () => {
    const built = buildMessage({ text: 'lost', attachments: [image(), file()] });
    for (const blocks of [
      [{ type: 'text', text: built.message }],
      [
        { type: 'text', text: built.message },
        { type: 'image', mimeType: 'image/png', data: 'bad' },
      ],
    ]) {
      const result = decodeUserContent(blocks);
      assert.equal(result.text, 'lost');
      assert.deepEqual(result.attachments, [
        { id: 'image-1', kind: 'image', name: 'same.png', mimeType: 'image/png', size: 8, missing: true },
        file(),
      ]);
      assert.match(result.notice, /unavailable/);
    }
  });

  it('strips only exact proven SDK suffix hints and surfaces them as a notice', () => {
    const text = '\t keep this \n\n';
    const built = buildMessage({ text, attachments: [image()] });
    const normalized = [
      { type: 'text', text: `${built.message}\n\n${CONVERSION}\n${DIMENSIONS}` },
      { type: 'image', mimeType: 'image/webp', data: JPEG },
    ];
    const result = decodeUserContent(normalized);
    assert.equal(result.text, text);
    assert.equal(result.attachments[0].name, 'same.png');
    assert.equal(result.attachments[0].size, 8);
    assert.equal(result.attachments[0].mimeType, 'image/webp');
    assert.equal(result.attachments[0].data, JPEG);
    assert.equal(result.notice, `${CONVERSION}\n${DIMENSIONS}`);
    assert.equal(imageSource(result.attachments[0]), `data:image/webp;base64,${JPEG}`);
  });

  it('recognizes both SDK omission messages and never silently drops named images', () => {
    const built = buildMessage({ text: 'lost', attachments: [image()] });
    for (const hint of [OMIT_CONVERSION, OMIT_RESIZE]) {
      const result = decodeUserContent(`${built.message}\n\n${hint}`);
      assert.equal(result.text, 'lost');
      assert.equal(result.attachments[0].name, 'same.png');
      assert.equal(result.attachments[0].missing, true);
      assert.match(result.notice, /Image omitted:/);
      assert.match(result.notice, /unavailable/);
    }
  });

  it('never guesses surviving image names after partial SDK omissions', () => {
    const built = buildMessage({
      text: 'look',
      attachments: [image('native-image-1', { name: 'first.png' }), file(), image('two', { name: 'second.png' })],
      clientId: 'partial',
    });
    const result = decodeUserContent([{ type: 'text', text: `${built.message}\n\n${OMIT_RESIZE}` }, built.images[1]]);
    assert.equal(result.text, 'look');
    assert.equal(result.clientId, 'partial');
    assert.deepEqual(
      result.attachments.slice(0, 3).map((attachment) => [attachment.name, !!attachment.missing, attachment.data]),
      [
        ['first.png', true, undefined],
        ['notes.txt', false, undefined],
        ['second.png', true, undefined],
      ],
    );
    assert.equal(result.attachments[3].name, 'Image 1.png');
    assert.equal(result.attachments[3].data, PNG);
    assert.equal(new Set(result.attachments.map((attachment) => attachment.id)).size, result.attachments.length);
    assert.match(result.notice, /reliably matched/);
  });

  it('handles all omitted images and partial data loss without hints conservatively', () => {
    const built = buildMessage({ text: 'look', attachments: [image('one'), image('two')] });
    const missing = decodeUserContent(`${built.message}\n\n${OMIT_CONVERSION}\n${OMIT_RESIZE}`);
    assert.equal(missing.attachments.length, 2);
    assert.equal(
      missing.attachments.every((attachment) => attachment.missing),
      true,
    );
    const partial = decodeUserContent([{ type: 'text', text: built.message }, built.images[0]]);
    assert.equal(partial.attachments.length, 3);
    assert.equal(partial.attachments[0].missing, true);
    assert.equal(partial.attachments[1].missing, true);
    assert.equal(partial.attachments[2].data, PNG);
  });

  it('keeps matching phrases in original text and rejects approximate or unproven suffixes', () => {
    const text = `User examples:\n${CONVERSION}\n${DIMENSIONS}\n${OMIT_RESIZE}\n`;
    const built = buildMessage({ text, attachments: [image()] });
    assert.equal(decodeUserContent(native(built)).text, text);
    expectPlain(`hello\n\n${CONVERSION}`);
    expectPlain(`hello\n\n${OMIT_RESIZE}`);
    for (const suffix of [
      CONVERSION.replace('.]', ' .]'),
      CONVERSION.replace('heic', 'png'),
      CONVERSION.replace('image/png', 'image/svg+xml'),
      DIMENSIONS.replace('2.00', '2.0'),
      DIMENSIONS.replace('2.00', '3.00'),
      DIMENSIONS.replace('4000', '0'),
      OMIT_RESIZE.replace('below', 'under'),
      CONVERSION + '\nextra',
      CONVERSION + '\n',
      CONVERSION + ' ',
      `${OMIT_RESIZE}\n${OMIT_CONVERSION}`,
      `${CONVERSION}\n${CONVERSION}`,
      `${DIMENSIONS}\n${DIMENSIONS}`,
    ])
      expectPlain(`${built.message}\n\n${suffix}`, built.images);
    expectPlain(`${built.message}\n${CONVERSION}`, built.images);
    expectPlain(`${built.message}\n\n\n${CONVERSION}`, built.images);
    const fileOnly = buildMessage({ text: 'look', attachments: [file()] });
    expectPlain(`${fileOnly.message}\n\n${OMIT_RESIZE}`);
    const badManifest = built.message.replace('"textLength":' + text.length, '"textLength":1');
    expectPlain(`${badManifest}\n\n${CONVERSION}`, built.images);
  });

  it('tolerates empty or unknown native content without throwing', () => {
    for (const content of [null, undefined, {}, 5, [], [null, { type: 'text', text: null }]]) {
      assert.deepEqual(decodeUserContent(content), { text: '', attachments: [] });
    }
  });
});
