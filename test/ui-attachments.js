// Real Electron attachment-composer regression, entirely offline with mock IPC.
const path = require('node:path');
if (!process.versions.electron) {
  const fs = require('node:fs'), env = { ...process.env };
  const userData = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'pi-attachments-ui-'));
  delete env.ELECTRON_RUN_AS_NODE;
  env.PI_UI_USER_DATA = userData;
  const child = require('node:child_process').spawn(require('electron'), [__filename], { env, stdio: 'inherit' });
  child.on('error', (err) => { console.error(err); process.exit(1); });
  child.on('exit', (code) => { fs.rmSync(userData, { recursive: true, force: true }); process.exit(code ?? 1); });
} else {
  const assert = require('node:assert/strict');
  const { app, BrowserWindow, ipcMain } = require('electron');
  const A = require('../renderer/attachments');
  app.setPath('userData', process.env.PI_UI_USER_DATA);
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7xkAAAAASUVORK5CYII=';
  const PNG2 = Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.from([0])]).toString('base64');
  const model = { provider: 'fixture', id: 'vision', name: 'Vision fixture', input: ['text', 'image'], contextWindow: 1000000 };
  const project = '/fixture/project', sessions = [], histories = new Map(), opened = [], prompts = [], imports = [], rpcCalls = [], errors = [], requests = [];
  let win, serial = 0, pickResult = { attachments: [], errors: [] }, resolvePicker, deferPicker = false, failPrompt = false, queued = [];
  let deferPrompt = false, resolvePrompt, deferImport = false, resolveImport, deferClipboard = false, resolveClipboard, clipboardResult;
  const image = (name = 'Screenshot.png', data = PNG) => ({ id: `image-${++serial}`, kind: 'image', name, mimeType: 'image/png', size: Buffer.from(data, 'base64').length, data });
  const localFile = () => ({ id: `file-${++serial}`, kind: 'file', name: 'local.txt', mimeType: 'text/plain', size: 12, path: '/fixture/local.txt' });
  const makeSession = (kind, title) => {
    const meta = { id: `session-${sessions.length + 1}`, kind, title, projectPath: project, cwd: project, mode: 'auto', updatedAt: Date.now() + sessions.length, branch: 'fixture' };
    sessions.push(meta); histories.set(meta.id, []); return meta;
  };
  const other = makeSession('code', 'Other code session');
  const emit = (id, event) => win.webContents.send('pi:event', { sessionId: id, event });
  const content = (payload) => { const b = A.buildMessage(typeof payload === 'string' ? { text: payload } : payload); return [{ type: 'text', text: b.message }, ...b.images]; };
  const confirm = (prompt) => {
    const message = { role: 'user', content: content(prompt.payload) };
    histories.get(prompt.id).push(message);
    emit(prompt.id, { type: 'message_end', message });
    emit(prompt.id, { type: 'agent_settled' });
    return message;
  };
  const stats = { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0 };
  const replies = {
    'app:info': () => ({ version: 'test', platform: process.platform, keyProviders: [] }), 'app:theme': () => null, 'app:notify': () => null,
    'projects:list': () => [{ path: project, name: 'Fixture' }], 'sessions:list': () => sessions, 'cowork:folders': () => [], 'sessions:importable': () => [],
    'models:list': () => ({ models: [model], defaultModel: 'fixture/vision' }), 'models:levels': () => ['off'],
    'sessions:create': (_e, options) => makeSession(options.kind, `Created ${options.kind} ${sessions.length}`),
    'sessions:open': (_e, id) => { opened.push(id); return { meta: sessions.find((s) => s.id === id), state: { model, thinkingLevel: 'off' }, messages: histories.get(id), stats }; },
    'sessions:changes': () => [], 'sessions:files': () => [], 'sessions:pr': () => null,
    'sessions:update': (_e, id, patch) => Object.assign(sessions.find((s) => s.id === id), patch),
    'sessions:prompt': (_e, id, payload, mode) => {
      prompts.push({ id, payload, mode });
      if (failPrompt) { failPrompt = false; throw new Error('Fixture validation rejected'); }
      const acknowledge = () => { if (mode === 'followUp') queued.push(A.buildMessage(payload).message); return { disposition: mode === 'followUp' ? 'queued' : 'started' }; };
      return deferPrompt ? new Promise((resolve) => { resolvePrompt = () => resolve(acknowledge()); }) : acknowledge();
    },
    'sessions:rpc': (_e, id, command) => {
      rpcCalls.push({ id, command });
      if (command.type === 'clear_queue') { const result = { steering: [], followUp: queued }; queued = []; return result; }
      if (command.type === 'abort') emit(id, { type: 'agent_settled' });
      return { ...stats, commands: [], levels: ['off'] };
    },
    'attachments:import': (_e, sources) => { imports.push(sources); const result = { attachments: sources.map((s) => image(s.name, s.data)), errors: [] }; return deferImport ? new Promise((resolve) => { resolveImport = () => resolve(result); }) : result; },
    'attachments:pick': () => deferPicker ? new Promise((resolve) => { resolvePicker = resolve; }) : pickResult,
    'attachments:clipboard': () => { const result = clipboardResult || { attachments: [localFile()], errors: [], hasFiles: true, text: 'local.txt' }; return deferClipboard ? new Promise((resolve) => { resolveClipboard = () => resolve(result); }) : result; },
  };
  for (const [channel, handler] of Object.entries(replies)) ipcMain.handle(channel, handler);
  const run = (fn, ...args) => win.webContents.executeJavaScript(`(${fn})(${args.map((a) => JSON.stringify(a)).join(',')})`);
  const wait = async (fn, ...args) => { for (let i = 0; i < 120; i++) { if (await run(fn, ...args)) return; await new Promise((r) => setTimeout(r, 20)); } throw new Error(`UI condition timed out: ${fn}`); };
  const tick = () => new Promise((r) => setTimeout(r, 70));
  const click = (selector) => run((s) => document.querySelector(s).click(), selector);
  const type = (selector, value) => run((s, v) => { const e = document.querySelector(s); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, selector, value);
  const open = async (title) => { await run((t) => [...document.querySelectorAll('.cn-s, #recents li')].find((e) => e.textContent.includes(t)).click(), title); await wait((t) => document.querySelector('#sessName').textContent === t, title); await tick(); };
  const paste = (selector, options) => run((s, o) => {
    const data = new DataTransfer();
    for (const f of o.files || []) data.items.add(new File([Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))], f.name, { type: 'image/png' }));
    for (const [type, text] of Object.entries(o.types || {})) data.setData(type, text);
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    document.querySelector(s).dispatchEvent(event); return event.defaultPrevented;
  }, selector, options);
  const screenshotPaste = async (selector = '#codeInput', data = PNG) => { await paste(selector, { files: [{ name: 'Screenshot.png', data }] }); await wait(() => !document.querySelector('.attachment-status')?.textContent.includes('Preparing')); await tick(); };
  const removeAll = (rack = '#codeAttachments') => run((s) => { while (document.querySelector(s + ' [data-remove]')) document.querySelector(s + ' [data-remove]').click(); }, rack);
  const count = () => run(() => document.querySelectorAll('#codeMsgs .e-user').length);
  const send = async (selector = '#codeSend') => { const before = prompts.length; await click(selector); for (let i = 0; i < 120 && prompts.length === before; i++) await tick(); assert.equal(prompts.length, before + 1); await wait(() => !document.querySelector('#codeInput').readOnly); return prompts.at(-1); };
  const waitMain = async (fn) => { for (let i = 0; i < 100 && !fn(); i++) await tick(); assert.ok(fn(), 'main-process condition timed out'); };
  const escape = () => run(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  const queue = async () => { const n = prompts.length; await run(() => document.querySelector('#codeInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }))); await waitMain(() => prompts.length === n + 1); return prompts.at(-1); };

  app.whenReady().then(async () => {
    win = new BrowserWindow({ show: false, useContentSize: true, width: 1100, height: 900, webPreferences: { preload: path.resolve(__dirname, '../electron/preload.js'), partition: 'attachments-test' } });
    win.webContents.on('preload-error', (_e, _p, err) => errors.push(err.message));
    win.webContents.on('console-message', ({ level, message }) => { if (level === 'error' && !/ERR_|Content Security/.test(message)) errors.push(message); });
    win.webContents.session.webRequest.onBeforeRequest({ urls: ['https://*/*', 'http://*/*'] }, (d, cb) => { requests.push(d.url); cb({ cancel: true }); });
    await win.loadFile(path.resolve(__dirname, '../renderer/index.html'));
    await wait(() => document.querySelector('#codeModelName').textContent === 'Vision fixture');

    // Actual DataTransfer/File screenshot import, removal, image-only welcome send.
    assert.equal(await paste('#codeInput', { files: [{ name: 'Screenshot.png', data: PNG }] }), true);
    await wait(() => document.querySelectorAll('#codeAttachments .attachment-tile').length === 1);
    assert.equal(imports[0][0].data, PNG); assert.equal(imports[0][0].mimeType, 'image/png');
    await click('#codeAttachments [data-remove]');
    assert.equal(await run(() => document.querySelectorAll('#codeAttachments .attachment-tile').length), 0);
    await screenshotPaste();
    const first = await send(), code = sessions.find((s) => s.id === first.id);
    assert.equal(first.payload.text, ''); assert.equal(first.payload.attachments[0].kind, 'image'); assert.ok(first.payload.clientId);
    assert.equal(typeof first.payload, 'object'); assert.equal(await count(), 1);
    const authoritative = confirm(first); emit(first.id, { type: 'message_end', message: authoritative }); await tick();
    assert.equal(await count(), 1, 'authoritative image manifest reconciles optimistic message without duplication');
    assert.equal(await run(() => document.querySelectorAll('.e-user .bubble').length), 0, 'image-only sends have no empty bubble');

    // Multiple images and local file references live above, outside exact text.
    pickResult = { attachments: [image('first.png'), image('second.png', PNG2), localFile()], errors: [] };
    await click('#codeAttach'); await wait(() => document.querySelectorAll('#codeAttachments .attachment-tile').length === 3);
    const exact = '  first line\n\n\tlast line  \n'; await type('#codeInput', exact);
    const mixed = await send(); assert.equal(mixed.payload.text, exact); assert.equal(mixed.payload.attachments.length, 3); confirm(mixed); await tick();
    const gallery = await run(() => { const e = [...document.querySelectorAll('.e-user')].at(-1), g = e.querySelector('.user-attachments'), b = e.querySelector('.bubble'); return { tiles: g.children.length, images: g.querySelectorAll('img').length, text: b.textContent, outside: !b.contains(g), above: g.getBoundingClientRect().bottom <= b.getBoundingClientRect().top + 1 }; });
    assert.deepEqual(gallery, { tiles: 3, images: 2, text: exact, outside: true, above: true });
    await run(() => [...document.querySelectorAll('.e-user')].at(-1).querySelector('[data-preview]').click());
    await wait(() => document.querySelector('dialog.attachment-dialog[open] img'));
    assert.equal(await run(() => document.querySelector('.attachment-dialog img').getAttribute('src').startsWith('data:image/png;base64,')), true);
    await click('.attachment-dialog button');
    const opensBefore = opened.length;
    await new Promise((r) => { win.webContents.once('did-finish-load', r); win.webContents.reload(); });
    await wait(() => document.querySelector('#codeModelName').textContent === 'Vision fixture'); await open(code.title);
    assert.equal(opened.length, opensBefore + 1); assert.equal(opened.at(-1), code.id);
    assert.equal(await count(), 2); assert.equal(await run(() => [...document.querySelectorAll('.e-user .bubble')].at(-1).textContent), exact);
    assert.equal(await run(() => document.querySelectorAll('.e-user .attachment-tile').length), 4);

    // Code and Cowork welcome drafts, then Cowork's shared thread composer.
    await click('#newSession'); await type('#codeInput', 'Code welcome draft'); await screenshotPaste();
    await click('#modeSwitch [data-mode="chat"]'); await type('#input', 'Cowork welcome draft'); await screenshotPaste('#input', PNG2);
    await click('#modeSwitch [data-mode="code"]');
    assert.equal(await run(() => document.querySelector('#codeInput').value), 'Code welcome draft');
    assert.equal(await run(() => document.querySelectorAll('#codeAttachments .attachment-tile').length), 1);
    await click('#modeSwitch [data-mode="chat"]');
    assert.equal(await run(() => document.querySelector('#input').value), 'Cowork welcome draft');
    assert.equal(await run(() => document.querySelectorAll('#attachments .attachment-tile').length), 1);
    const coworkPrompt = await send('#sendBtn'), cowork = sessions.find((s) => s.id === coworkPrompt.id); confirm(coworkPrompt); await tick();
    assert.equal(cowork.kind, 'cowork'); assert.equal(coworkPrompt.payload.attachments.length, 1);
    await type('#codeInput', 'Cowork thread draft'); await screenshotPaste('#codeInput', PNG2);
    await open(code.title); await type('#codeInput', 'Code thread draft'); await screenshotPaste();
    await open(cowork.title);
    assert.equal(await run(() => document.querySelector('#codeInput').value), 'Cowork thread draft');
    assert.equal(await run(() => document.querySelector('#codeAttachments img').getAttribute('src')), `data:image/png;base64,${PNG2}`);
    await open(code.title); assert.equal(await run(() => document.querySelector('#codeInput').value), 'Code thread draft');

    // Deferred OS picker result belongs to originating session, not current view.
    deferPicker = true; await click('#codeAttach');
    for (let i = 0; i < 100 && !resolvePicker; i++) await tick(); assert.ok(resolvePicker);
    await open(other.title); await type('#codeInput', 'Other untouched');
    resolvePicker({ attachments: [localFile()], errors: [] }); deferPicker = false; await tick();
    assert.equal(await run(() => document.querySelector('#codeInput').value), 'Other untouched');
    assert.equal(await run(() => document.querySelectorAll('#codeAttachments .attachment-tile').length), 0);
    await open(code.title); await wait(() => document.querySelectorAll('#codeAttachments .attachment-tile').length === 2);

    // Rejected preflight leaves exact draft and attachments, with no ghost bubble.
    const usersBefore = await count(); failPrompt = true; await send(); await tick();
    assert.equal(await count(), usersBefore); assert.equal(await run(() => document.querySelector('#codeInput').value), 'Code thread draft');
    assert.equal(await run(() => document.querySelectorAll('#codeAttachments .attachment-tile').length), 2);
    assert.match(await run(() => document.querySelector('#codeAttachments').textContent), /Fixture validation rejected/);
    await click('#codeAttachments [data-dismiss]'); await removeAll(); await type('#codeInput', '');

    // Busy followUp cancellation restores from the wire without clobbering a newer draft.
    emit(code.id, { type: 'agent_start' }); await screenshotPaste(); await type('#codeInput', 'Queued image');
    const beforeQueue = prompts.length;
    await run(() => document.querySelector('#codeInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })));
    for (let i = 0; i < 120 && prompts.length === beforeQueue; i++) await tick(); await tick();
    assert.equal(prompts.at(-1).mode, 'followUp'); assert.equal(queued.length, 1);
    const cancelled = prompts.at(-1).payload; await type('#codeInput', 'New unsent draft');
    await run(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    await wait(() => document.querySelector('#codeAttachments [data-restore]'));
    assert.equal(await run(() => document.querySelector('#codeInput').value), 'New unsent draft');
    assert.equal(await run(() => document.querySelectorAll('#codeAttachments .attachment-tile').length), 0);
    assert.ok(rpcCalls.some((c) => c.command.type === 'clear_queue'));
    await click('#codeAttachments [data-restore]'); assert.equal(await run(() => document.querySelector('#codeInput').value), 'New unsent draft');
    await type('#codeInput', ''); await click('#codeAttachments [data-restore]');
    assert.equal(await run(() => document.querySelector('#codeInput').value), 'Queued image');
    assert.equal(await run(() => document.querySelector('#codeAttachments img').getAttribute('src')), A.imageSource(cancelled.attachments[0]));
    assert.equal(await count(), usersBefore, 'cancelled queued optimistic bubble is removed');
    await removeAll(); await type('#codeInput', '');

    // Acknowledged queued images survive process exit immediately, before reopening.
    emit(code.id, { type: 'agent_start' }); await screenshotPaste(); await type('#codeInput', 'Exit recovery');
    const exited = await queue(); await wait(() => !document.querySelector('#codeInput').readOnly);
    const beforeExitOpen = opened.length; queued = []; // The crashed process has lost its wire queue.
    win.webContents.send('pi:exit', { sessionId: code.id, code: 1, stderr: 'Fixture crashed' });
    await wait(() => document.querySelector('#codeInput').value === 'Exit recovery' && document.querySelector('#codeAttachments img'));
    assert.equal(opened.length, beforeExitOpen, 'exit recovery must precede any session reopen');
    assert.equal(await run(() => document.querySelector('#codeAttachments img').getAttribute('src')), A.imageSource(exited.payload.attachments[0]));
    assert.equal(await run(() => document.querySelectorAll('.e-user.queued').length), 0, 'exit cannot leave indefinitely queued image bubbles');
    await open(other.title); await open(code.title);
    assert.equal(await run(() => document.querySelector('#codeInput').value), 'Exit recovery');
    assert.equal(await run(() => document.querySelector('#codeAttachments img').getAttribute('src')), A.imageSource(exited.payload.attachments[0]));
    await removeAll(); await type('#codeInput', '');

    // Escape waits for backend validation's prompt acknowledgment before clearing/aborting.
    await screenshotPaste(); await type('#codeInput', 'Pending validation'); deferPrompt = true; resolvePrompt = null;
    await click('#codeSend'); await waitMain(() => !!resolvePrompt);
    const rpcBeforeEscape = rpcCalls.length; await escape(); await tick(); await tick();
    assert.equal(rpcCalls.slice(rpcBeforeEscape).filter((c) => ['clear_queue', 'abort'].includes(c.command.type)).length, 0, 'do not abort while prompt validation can still enqueue/start later');
    resolvePrompt(); deferPrompt = false;
    await waitMain(() => rpcCalls.slice(rpcBeforeEscape).some((c) => c.command.type === 'abort'));
    assert.deepEqual(rpcCalls.slice(rpcBeforeEscape).filter((c) => ['clear_queue', 'abort'].includes(c.command.type)).map((c) => c.command.type), ['clear_queue', 'abort']);
    await wait(() => !document.querySelector('#codeInput').readOnly); await removeAll(); await type('#codeInput', '');

    // Mixed file/image clipboard text inserts at the captured selection without loss.
    const caption = '  exact caption\n\tlast  ';
    await type('#codeInput', 'prefix REPLACE suffix'); await run(() => document.querySelector('#codeInput').setSelectionRange(7, 14));
    await paste('#codeInput', { files: [{ name: 'caption.png', data: PNG }], types: { 'text/plain': caption } });
    await wait(() => document.querySelector('#codeAttachments img') && !document.querySelector('#codeAttachments .attachment-status'));
    assert.equal(await run(() => document.querySelector('#codeInput').value), `prefix ${caption} suffix`);
    await removeAll(); await type('#codeInput', 'prefix REPLACE suffix'); await run(() => document.querySelector('#codeInput').setSelectionRange(7, 14));
    clipboardResult = { attachments: [image('native-caption.png')], hasFiles: false, text: caption, errors: [] };
    await paste('#codeInput', {}); await wait(() => document.querySelector('#codeAttachments img'));
    assert.equal(await run(() => document.querySelector('#codeInput').value), `prefix ${caption} suffix`);
    await removeAll(); await type('#codeInput', '');
    // Both FileReader/import and native fallback may resolve after the user edits.
    for (const native of [false, true]) {
      deferImport = !native; deferClipboard = native; resolveImport = resolveClipboard = null;
      clipboardResult = { attachments: [image('async-caption.png')], hasFiles: false, text: caption, errors: [] };
      await type('#codeInput', 'old selection'); await run(() => document.querySelector('#codeInput').setSelectionRange(0, 3));
      await paste('#codeInput', native ? {} : { files: [{ name: 'async.png', data: PNG }], types: { 'text/plain': caption } });
      await waitMain(() => native ? !!resolveClipboard : !!resolveImport); await type('#codeInput', 'newer user text');
      (native ? resolveClipboard : resolveImport)(); deferImport = deferClipboard = false;
      await wait(() => document.querySelector('#codeAttachments [data-restore]'));
      assert.equal(await run(() => document.querySelector('#codeInput').value), 'newer user text');
      assert.ok(await run(() => !!document.querySelector('#codeAttachments img')), 'async caption recovery must not drop image');
      await click('#codeAttachments [data-restore]'); assert.equal(await run(() => document.querySelector('#codeInput').value), 'newer user text');
      await removeAll(); await type('#codeInput', ''); await click('#codeAttachments [data-restore]');
      assert.equal(await run(() => document.querySelector('#codeInput').value), caption, 'caption remains exactly recoverable after concurrent edits');
      await removeAll(); await type('#codeInput', '');
    }
    clipboardResult = null;

    // Native copied-file fallback suppresses filename text; HTML/plain retain selection.
    assert.equal(await paste('#codeInput', { types: { 'text/uri-list': 'file:///fixture/local.txt' } }), true);
    await wait(() => document.querySelector('#codeAttachments .attachment-tile.is-file'));
    assert.match(await run(() => document.querySelector('#codeAttachments').textContent), /local.txt/);
    assert.equal(await run(() => document.querySelector('#codeInput').value), '', 'copied-file fallback must suppress filename clipboard text'); await removeAll();
    const requestsBeforePaste = requests.length;
    await type('#codeInput', 'prefix suffix'); await run(() => document.querySelector('#codeInput').setSelectionRange(7, 7));
    assert.equal(await paste('#codeInput', { types: { 'text/html': '<p>one<br>two</p><div>three</div><img src="https://invalid.test/pixel" onerror="window.pasteExecuted=true"><script>window.pasteExecuted=true</script>' } }), true);
    assert.equal(await run(() => document.querySelector('#codeInput').value), 'prefix one\ntwo\nthree\nsuffix');
    assert.equal(await run(() => !!window.pasteExecuted), false); assert.equal(requests.length, requestsBeforePaste, 'HTML clipboard content must not issue network requests');
    await run(() => document.querySelector('#codeInput').setSelectionRange(0, 6));
    assert.equal(await paste('#codeInput', { types: { 'text/plain': 'native replacement' } }), false, 'plain paste remains browser-owned (including undo/selection)');
    assert.deepEqual(await run(() => [document.querySelector('#codeInput').selectionStart, document.querySelector('#codeInput').selectionEnd]), [0, 6]);
    assert.deepEqual(errors, []);
    console.log('PASS: attachment paste/remove/send/dedupe/gallery/lightbox/reload, isolated Code/Cowork drafts, picker race, rejection recovery, followUp cancellation, safe clipboard forms');
    app.exit(0);
  }).catch((err) => { console.error(err); app.exit(1); });
}
