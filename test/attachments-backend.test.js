// Main-process attachment import and IPC validation. Clipboard objects are fakes;
// these tests never read, replace, or clear the user's system clipboard.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { pathToFileURL } = require('node:url');
const { importAttachments, pickAttachments, clipboardAttachments, clipboardPaths, validatePromptPayload } = require('../electron/attachments');
const { LIMITS, validateAttachments } = require('../renderer/attachments');
const { SessionHub } = require('../electron/sessions');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-attachments-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
function write(name, bytes) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, bytes);
  return file;
}
const textFile = write('notes 中文.txt', 'attachment notes');
const raw = (data = PNG, name = 'pasted.png', mimeType = 'image/png') => ({ data, name, mimeType });
const native = (name) => `electron application/osclipboard;format="${name}"`;
const clipboardItem = (entries) => ({
  types: Object.keys(entries),
  async getType(type) {
    const value = entries[type];
    if (value instanceof Error) throw value;
    return new Blob([value]);
  },
});
const clipboard = (...items) => ({ async read() { return items.map(clipboardItem); } });
function chunk(type, data) {
  const buffer = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, buffer, checksum]);
}
function png(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc((width * 4 + 1) * height, 0);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
function bmp() {
  const bytes = Buffer.alloc(70, 0);
  bytes.write('BM'); bytes.writeUInt32LE(bytes.length, 2); bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14); bytes.writeInt32LE(2, 18); bytes.writeInt32LE(2, 22);
  bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28); bytes.writeUInt32LE(16, 34);
  bytes.fill(200, 54);
  return bytes;
}

describe('attachment backend import', () => {
  it('imports ordinary files by absolute reference without embedding their content', async () => {
    const result = await importAttachments([{ path: textFile }]);
    assert.deepEqual(result.errors, []);
    assert.equal(result.attachments.length, 1);
    const a = result.attachments[0];
    assert.equal(a.path, textFile);
    assert.equal(a.kind, 'file');
    assert.equal(a.name, 'notes 中文.txt');
    assert.equal(a.mimeType, 'text/plain');
    assert.equal(a.size, Buffer.byteLength('attachment notes'));
    assert.equal(a.data, undefined);
    validateAttachments(result.attachments);
  });

  it('sniffs real image format instead of trusting an extension or supplied MIME', async () => {
    const renamed = write('actually-png.pdf', Buffer.from(PNG, 'base64'));
    const result = await importAttachments([{ path: renamed }, raw(GIF, 'actually-gif.png', 'text/plain')]);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.attachments.map((a) => a.mimeType), ['image/png', 'image/gif']);
    assert.ok(result.attachments.every((a) => a.kind === 'image' && a.data && !Object.hasOwn(a, 'path')));
    assert.equal(result.attachments[0].data, PNG);
    validateAttachments(result.attachments);
  });

  it('converts BMP with public SDK and resizes long images to at most 2000 pixels', async () => {
    const result = await importAttachments([raw(bmp().toString('base64'), 'scan.bmp', 'image/bmp'), raw(png(2500, 20).toString('base64'), 'wide.png')]);
    assert.deepEqual(result.errors, []);
    assert.equal(result.attachments[0].mimeType, 'image/png');
    const sdk = await import('@earendil-works/pi-coding-agent');
    const checked = await sdk.resizeImage(Buffer.from(result.attachments[1].data, 'base64'), result.attachments[1].mimeType);
    assert.equal(checked.width, 2000);
    assert.ok(checked.height <= 2000);
    assert.ok(result.attachments.every((a) => a.data.length <= LIMITS.imageBytes));
  });

  it('rejects damaged images, SVG/HTML image bytes and invalid base64 with partial success', async () => {
    const damaged = write('damaged.png', Buffer.from(PNG, 'base64').subarray(0, 30));
    const result = await importAttachments([
      { path: textFile }, { path: damaged }, raw('data:image/png;base64,' + PNG),
      raw(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64'), 'vector.svg', 'image/svg+xml'),
      raw(Buffer.from('<html><body>not an image</body></html>').toString('base64'), 'page.png'),
    ]);
    assert.equal(result.attachments.length, 1);
    assert.equal(result.errors.length, 4);
    assert.ok(result.errors.every((e) => e.name && e.message));
    const svg = write('vector.svg', '<svg/>');
    const byPath = await importAttachments([{ path: svg }]);
    assert.equal(byPath.attachments[0].kind, 'file', 'SVG stays a path reference, never an inline image');
  });

  it('bounds source count, individual bytes, total bytes, and requires local regular files', async () => {
    const big = write('large.bin', '');
    fs.truncateSync(big, LIMITS.fileBytes + 1);
    const result = await importAttachments([{ path: big }, { path: tmp }, { path: 'relative.txt' }, { path: 'https://example.com/image.png' }, { path: '//server/share/file' }, { path: textFile }]);
    assert.equal(result.attachments.length, 1);
    assert.equal(result.errors.length, 5);
    assert.match(result.errors[0].message, /20 MiB/);
    const exact = write('exact.bin', '');
    fs.truncateSync(exact, LIMITS.fileBytes);
    const total = await importAttachments([{ path: exact }, { path: exact }, { path: exact }]);
    assert.equal(total.attachments.length, 2);
    assert.match(total.errors[0].message, /50 MiB/);
    const count = await importAttachments(Array.from({ length: 11 }, () => ({ path: textFile })));
    assert.equal(count.attachments.length, 10);
    assert.match(count.errors[0].message, /10 files/);
    assert.notEqual(count.attachments[0].id, count.attachments[1].id);
  });

  it('rejects source shape confusion and handles canceling the native picker', async () => {
    const invalid = await importAttachments([{ path: textFile, data: PNG }, { name: 'x', mimeType: 'image/png' }, null]);
    assert.equal(invalid.errors.length, 3);
    assert.deepEqual(await importAttachments(null), { attachments: [], errors: [{ name: 'Attachments', message: 'Choose a list of files or images to attach.' }] });
    const dialog = { async showOpenDialog(win, options) {
      assert.equal(win, 'window'); assert.ok(options.properties.includes('multiSelections'));
      return { canceled: true, filePaths: [] };
    } };
    assert.deepEqual(await pickAttachments(dialog, 'window'), { attachments: [], errors: [] });
  });
});

describe('native clipboard file formats', () => {
  it('parses macOS file URLs and XML NSFilenamesPboardType without network access', () => {
    const url = pathToFileURL(textFile).href;
    assert.deepEqual(clipboardPaths(native('public.file-url'), Buffer.from(url)), [textFile]);
    const xml = '<?xml version="1.0"?><!DOCTYPE plist PUBLIC "example" "https://example.invalid/file.dtd"><plist version="1.0"><array><string>/tmp/A &amp; B.txt</string><string>/tmp/&#x4e2d;&#25991;.txt</string></array></plist>';
    assert.deepEqual(clipboardPaths(native('NSFilenamesPboardType'), Buffer.from(xml)), ['/tmp/A & B.txt', '/tmp/中文.txt']);
    assert.deepEqual(clipboardPaths(native('public.file-url'), Buffer.from('file://remote/share/a.txt\nhttps://example.com/a.png\nfile:///tmp/a%00.txt')), []);
  });

  it('parses Windows FileNameW and CF_HDROP UTF16 DROPFILES header', () => {
    const list = Buffer.from('C:\\Users\\test\\a.txt\0D:\\photo.png\0\0', 'utf16le');
    assert.deepEqual(clipboardPaths(native('FileNameW'), list, 'win32'), ['C:\\Users\\test\\a.txt', 'D:\\photo.png']);
    const header = Buffer.alloc(20); header.writeUInt32LE(20, 0); header.writeUInt32LE(1, 16);
    assert.deepEqual(clipboardPaths(native('CF_HDROP'), Buffer.concat([header, list]), 'win32'), ['C:\\Users\\test\\a.txt', 'D:\\photo.png']);
    header.writeUInt32LE(100000, 0);
    assert.deepEqual(clipboardPaths(native('CF_HDROP'), Buffer.concat([header, list]), 'win32'), []);
    assert.deepEqual(clipboardPaths(native('FileNameW'), Buffer.from('\\\\server\\share\\a.txt\0\0', 'utf16le'), 'win32'), []);
  });

  it('parses Linux uri lists and GNOME copied-files, filtering comments and remote URLs', () => {
    assert.deepEqual(clipboardPaths('text/uri-list', Buffer.from('# file copy\r\nfile:///tmp/a%20b.txt\r\nhttps://example.com/no.png'), 'linux'), ['/tmp/a b.txt']);
    assert.deepEqual(clipboardPaths('x-special/gnome-copied-files', Buffer.from('cut\nfile:///tmp/a.txt\nfile:///tmp/b.txt'), 'linux'), ['/tmp/a.txt', '/tmp/b.txt']);
  });

  it('prefers actual copied files over an accompanying preview image and deduplicates formats', async () => {
    const result = await clipboardAttachments(clipboard({
      [native('public.file-url')]: pathToFileURL(textFile).href,
      'text/uri-list': pathToFileURL(textFile).href,
      'image/png': Buffer.from(PNG, 'base64'), 'text/plain': textFile,
    }));
    assert.equal(result.hasFiles, true);
    assert.equal(result.text, textFile);
    assert.deepEqual(result.errors, []);
    assert.equal(result.attachments.length, 1);
    assert.equal(result.attachments[0].kind, 'file');
  });

  it('does not substitute a preview for missing or unsupported file paths', async () => {
    const missing = await clipboardAttachments(clipboard({ [native('public.file-url')]: 'file:///missing/notes.txt', 'image/png': Buffer.from(PNG, 'base64') }));
    assert.equal(missing.hasFiles, true);
    assert.equal(missing.attachments.length, 0);
    assert.match(missing.errors[0].message, /no longer exists/);
    const network = await clipboardAttachments(clipboard({ [native('public.file-url')]: 'file://remote/share/a.txt', 'image/png': Buffer.from(PNG, 'base64') }));
    assert.equal(network.hasFiles, true);
    assert.equal(network.attachments.length, 0);
    assert.match(network.errors[0].message, /remote URLs/);
  });

  it('imports screenshot bytes with optional mixed text, not text URLs as downloads', async () => {
    const screenshot = await clipboardAttachments(clipboard({ 'image/png': Buffer.from(PNG, 'base64'), 'text/plain': 'look at this' }));
    assert.equal(screenshot.hasFiles, false);
    assert.equal(screenshot.text, 'look at this');
    assert.equal(screenshot.attachments[0].data, PNG);
    const text = await clipboardAttachments(clipboard({ 'text/uri-list': 'https://example.com/p.png', 'text/plain': 'https://example.com/p.png' }));
    assert.equal(text.hasFiles, false);
    assert.deepEqual(text.attachments, []);
    assert.deepEqual(text.errors, []);
    assert.equal(text.text, 'https://example.com/p.png');
  });
});

describe('prompt attachment validation and forwarding', () => {
  it('accepts legacy text, mixed normalized descriptors and attachment-only prompts', async () => {
    assert.deepEqual(await validatePromptPayload('hello'), { text: 'hello', attachments: [] });
    const { attachments } = await importAttachments([{ path: textFile }, raw()]);
    const payload = { text: '', attachments, clientId: 'client-1' };
    assert.deepEqual(await validatePromptPayload(payload), payload);
  });

  it('does not trust raw renderer descriptors or silently resize them at send time', async () => {
    const { attachments: [image] } = await importAttachments([raw()]);
    await assert.rejects(validatePromptPayload({ text: 'x', attachments: [{ ...image, path: '/tmp/unexpected' }] }), /schema/);
    await assert.rejects(validatePromptPayload({ text: 'x', attachments: [{ ...image, data: Buffer.from('<svg/>').toString('base64') }] }), /MIME/);
    await assert.rejects(validatePromptPayload({ text: 'x', attachments: [{ ...image, data: Buffer.from(PNG, 'base64').subarray(0, 30).toString('base64') }] }), /damaged|normalized/);
    await assert.rejects(validatePromptPayload({ text: '', attachments: [{ ...image, data: png(2500, 20).toString('base64') }] }), /normalized/);
    await assert.rejects(validatePromptPayload({ text: 'x', attachments: [{ ...image, data: 'AAAA'.repeat(LIMITS.imageBytes / 4 + 1) }] }), /4.5 MiB/);
    await assert.rejects(validatePromptPayload({ text: 'x', attachments: Array.from({ length: 5 }, (_, i) => ({ ...image, id: String(i), data: 'AAAA'.repeat(LIMITS.imageBytes / 4) })) }), /20 MiB/);
    await assert.rejects(validatePromptPayload({ text: 'x', attachments: [], clientId: { malicious: true } }), /identifier/);
  });

  it('revalidates changed/deleted file references and source sizes', async () => {
    const mutable = write('mutable.txt', 'hello');
    const { attachments } = await importAttachments([{ path: mutable }]);
    fs.writeFileSync(mutable, 'changed');
    await assert.rejects(validatePromptPayload({ text: 'x', attachments }), /changed/);
    fs.rmSync(mutable);
    await assert.rejects(validatePromptPayload({ text: 'x', attachments }), /ENOENT/);
    await assert.rejects(validatePromptPayload({ text: 'x', attachments: [{ ...attachments[0], path: '//server/share/a' }] }), /local file/);
  });

  function fakeHub(modelInput = ['text', 'image']) {
    const calls = [];
    const hub = new SessionHub({ store: { get() { return [{ id: 's' }]; }, set() {} }, userData: tmp, getEnv: () => ({}) });
    const pi = { ready: Promise.resolve(), async send(command) {
      calls.push(command);
      if (command.type === 'get_state') return { model: { input: modelInput } };
      return { accepted: true };
    } };
    hub.ensure = () => pi;
    return { hub, calls, pi };
  }

  it('starts an idle follow-up as a prompt, forwards images and preserves queued failures', async () => {
    const { hub, calls, pi } = fakeHub();
    const { attachments } = await importAttachments([raw()]);
    await hub.prompt('s', { text: 'look', attachments, clientId: 'turn-1' }, 'followUp');
    assert.equal(calls.at(-1).type, 'prompt');
    assert.equal(calls.at(-1).images[0].data, PNG);
    assert.match(calls.at(-1).message, /turn-1/);
    hub.status.set('s', 'running');
    await hub.prompt('s', { text: 'then look', attachments }, 'followUp');
    assert.equal(calls.at(-1).type, 'follow_up');
    assert.equal(calls.at(-1).images[0].data, PNG);
    await hub.prompt('s', { text: 'now', attachments }, 'steer');
    assert.equal(calls.at(-1).streamingBehavior, 'steer');
    pi.send = async (command) => { calls.push(command); throw new Error('queue rejected'); };
    const before = calls.length;
    await assert.rejects(hub.prompt('s', 'queued', 'followUp'), /queue rejected/);
    assert.equal(calls.length, before + 1, 'no blind prompt retry after a failed follow_up');
    assert.equal(calls.at(-1).type, 'follow_up');
  });

  it('checks current model image input capability and leaves text-only prompts compatible', async () => {
    const { hub, calls } = fakeHub(['text']);
    const { attachments } = await importAttachments([raw()]);
    await assert.rejects(hub.prompt('s', { text: 'look', attachments }), /does not support image/);
    assert.deepEqual(calls.map((c) => c.type), ['get_state']);
    await hub.prompt('s', 'hello');
    assert.deepEqual(calls.at(-1), { type: 'prompt', message: 'hello' });
  });
});
