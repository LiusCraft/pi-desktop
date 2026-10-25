// Real renderer regression for long prompts, links, and newly-created PRs.
// Mock IPC keeps this test offline and never opens a real browser or creates a PR.
const path = require('node:path');
if (!process.versions.electron) {
  const fs = require('node:fs');
  const userData = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'pi-rendering-ui-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.PI_UI_USER_DATA = userData;
  const child = require('node:child_process').spawn(require('electron'), [__filename], { env, stdio: 'inherit' });
  child.on('error', (err) => { console.error(err); process.exit(1); });
  child.on('exit', (code) => { fs.rmSync(userData, { recursive: true, force: true }); process.exit(code ?? 1); });
} else {
  const assert = require('node:assert/strict');
  const { app, BrowserWindow, ipcMain } = require('electron');
  app.setPath('userData', process.env.PI_UI_USER_DATA);
  const settings = { theme: 'dark', resolvedTheme: 'dark', sidebarCollapsed: false, defaultMode: 'code' };
  ipcMain.on('app:boot', (event) => { event.returnValue = { settings }; });
  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:set', (_event, patch) => Object.assign(settings, patch));
  const meta = { id: 'render-test', kind: 'code', title: 'Rendering regression', projectPath: 'C:/projects/pi-desktop', cwd: 'C:/projects/pi-desktop', branch: 'claude/long-branch-'.repeat(12), mode: 'auto', updatedAt: Date.now() };
  const model = { provider: 'fixture', id: 'test', name: 'Test model', contextWindow: 1000000 };
  let win, pr = null, prQueries = 0, history = [];
  const currentFile = Array.from({ length: 4000 }, (_, i) => `const currentLine${i + 1} = ${i + 1};`).join('\n');
  const fileReads = [];
  const answers = [], opened = [], errors = [], styles = [];
  const replies = {
    'app:info': () => ({ version: 'test', keyProviders: [] }), 'app:theme': () => null,
    'app:openExternal': (_e, url) => { opened.push(url); },
    'projects:list': () => [{ path: meta.projectPath, name: 'pi-desktop' }],
    'sessions:list': () => [meta], 'cowork:folders': () => [], 'sessions:importable': () => [],
    'models:list': () => ({ models: [model], defaultModel: 'fixture/test' }), 'models:levels': () => ['off'],
    'sessions:open': () => ({ meta, state: { model, thinkingLevel: 'off' }, messages: history, stats: {} }),
    'sessions:rpc': () => ({ commands: [], levels: ['off'] }),
    'sessions:changes': () => [{ path: 'file.js', before: 'old', after: 'new' }],
    'sessions:readFile': (_e, id, rel) => { fileReads.push({ id, rel }); return currentFile; },
    'sessions:pr': () => { prQueries++; return pr; },
    'sessions:ui': (_e, id, requestId, payload) => { answers.push({ id, requestId, payload }); },
    'sessions:style': (_e, id, style) => { styles.push(style); meta.outputStyle = style; },
    'sessions:update': (_e, _id, patch) => Object.assign(meta, patch),
  };
  for (const [channel, handler] of Object.entries(replies)) ipcMain.handle(channel, handler);
  const run = (fn, ...args) => win.webContents.executeJavaScript(`(${fn})(${args.map((a) => JSON.stringify(a)).join(',')})`);
  const frame = () => run(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const emit = (event) => win.webContents.send('pi:event', { sessionId: meta.id, event });
  const wait = async (fn) => {
    for (let i = 0; i < 100; i++) {
      if (await run(fn)) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`UI condition timed out: ${fn}`);
  };
  const bounded = async () => {
    const overflow = await run(() => ['#app', '#codeMain', '#codeThread', '#codeMsgs', '#codeComposer', '#prBar'].filter((s) => {
      const el = document.querySelector(s);
      return !el.hidden && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1;
    }));
    assert.deepEqual(overflow, [], 'outer layout must not scroll horizontally');
  };
  app.whenReady().then(async () => {
    win = new BrowserWindow({ show: false, useContentSize: true, width: 1100, height: 900,
      webPreferences: { preload: path.resolve(__dirname, '../electron/preload.js'), partition: 'rendering-test' } });
    win.webContents.on('preload-error', (_e, _p, err) => errors.push(err.message));
    win.webContents.on('console-message', ({ level, message }) => { if (level === 'error' && !/ERR_|Content Security/.test(message)) errors.push(message); });
    win.webContents.session.webRequest.onBeforeRequest({ urls: ['https://*/*'] }, (_d, cb) => cb({ cancel: true }));
    await win.loadFile(path.resolve(__dirname, '../renderer/index.html'));
    await wait(() => document.querySelector('#codeModelName').textContent === 'Test model');
    await run(() => document.querySelector('.cn-s').click());
    await wait(() => !!document.querySelector('.pr-create'));
    assert.ok(prQueries > 0, 'opening a session checks PR state');
    emit({ type: 'agent_start' });
    const title = '[提交范围] electron/main.js 被格式化了，怎么处理？\n\n--- 1. 只提交功能改动 preview ---\n- const { Store } = require(\'./store\');\n+ const { Store, KEY_ENV } = require(\'./store\');\n\n--- 2. 全部提交 preview ---\n' + 'long-preview-line'.repeat(80);
    const option = '1. 只提交功能改动（推荐） — 还原格式化噪音，保留单引号风格，PR diff 只有与功能相关的修改。'.repeat(4);
    emit({ type: 'extension_ui_request', id: 'question', method: 'select', title, options: [option, '2. 全部提交 — 格式化和功能一起提交', '3. Type something.'] });
    await wait(() => !!document.querySelector('.p-option'));
    assert.equal(await run(() => document.querySelectorAll('.ask-preview').length), 2);
    assert.equal(await run(() => document.querySelector('.p-question').textContent.includes('preview')), false);
    assert.ok(await run(() => [...document.querySelectorAll('.p-option')].every((b) => b.scrollHeight <= b.clientHeight + 1)), 'options must grow to fit wrapped text');
    await bounded();
    await run(() => document.querySelector('.p-option').click());
    await wait(() => !!document.querySelector('.e-ask.res'));
    assert.equal(answers.at(-1).payload.value, option, 'answer payload stays unchanged');
    assert.ok(await run(() => {
      const el = document.querySelector('.p-res-text');
      return el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow === 'ellipsis' && !!el.title;
    }), 'resolved answers should ellipsize with a full tooltip');

    const command = `cd "C:/Users/test/${'very-long-worktree-path-'.repeat(40)}"; git status`;
    emit({ type: 'tool_execution_start', toolCallId: 'cmd', toolName: 'powershell', args: { command } });
    emit({ type: 'extension_ui_request', id: 'permission', method: 'select', title: '[[pi-desktop:perm:cmd]] Run?', options: ['Allow', 'Always allow', 'Deny'] });
    await wait(() => !!document.querySelector('[data-v="Always allow"]'));
    for (const [width, height] of [[900, 600], [1533, 1029]]) {
      win.setContentSize(width, height);
      await frame();
      await bounded();
      assert.ok(await run(() => {
        const el = [...document.querySelectorAll('.g-label')].at(-1);
        return el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow === 'ellipsis';
      }), 'long running tool summaries must ellipsize');
    }
    await run(() => document.querySelector('[data-v="Always allow"]').click());
    await frame();
    await bounded();
    emit({ type: 'tool_execution_end', toolCallId: 'cmd', toolName: 'powershell', result: { content: [{ type: 'text', text: 'done' }] } });

    const url = 'https://github.com/LiusCraft/pi-desktop/pull/1';
    emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: `PR 链接：**${url}**。\n\n[带格式的 **链接**](https://example.com/a_(b)?x=1&y=2)\n\n<https://example.com/auto>\n\n\`https://example.com/literal\`\n\n[不安全](javascript:alert(1))\n\n${'unbroken-text'.repeat(150)}` }] } });
    await wait(() => !!document.querySelector('.e-text a[href]'));
    assert.deepEqual(await run(() => [...document.querySelectorAll('.e-text a[href]')].map((a) => a.getAttribute('href'))), [url, 'https://example.com/a_(b)?x=1&y=2', 'https://example.com/auto']);
    assert.equal(await run(() => document.querySelectorAll('.e-text code a').length), 0);
    await run(() => document.querySelector('.e-text a[href]').click());
    await frame();
    assert.equal(opened.at(-1), url);
    assert.ok(win.webContents.getURL().startsWith('file:'), 'external links must not navigate the app');
    await bounded();

    // The first PR appears only after the turn, without switching/reopening the session.
    pr = { num: 1, url, state: 'open', ci: 'pass', checks: [{ n: 'build', st: 'pass' }], comments: 3 };
    const before = prQueries;
    emit({ type: 'agent_settled' });
    await wait(() => document.querySelector('.pr-num')?.textContent === '#1');
    assert.ok(prQueries > before, 'a turn with no previous PR must still refresh PR state');
    assert.equal(await run(() => !!document.querySelector('.pr-create')), false);
    assert.equal(await run(() => document.querySelector('.pr-state').textContent), 'Open');
    await run(() => document.querySelector('.pr-link').click());
    await frame();
    assert.equal(opened.at(-1), url);
    await bounded();
    // Loaded sessions also refresh instead of returning early with stale PR state.
    pr = { ...pr, state: 'merged' };
    await run(() => { document.querySelector('#newSession').click(); document.querySelector('.cn-s').click(); });
    await wait(() => document.querySelector('.pr-state')?.textContent === 'Merged');
    // A successful create command updates immediately, even while `pr view` still returns null.
    pr = null;
    emit({ type: 'agent_start' });
    emit({ type: 'tool_execution_start', toolCallId: 'pr', toolName: 'bash', args: { command: 'gh pr create --draft --title test' } });
    emit({ type: 'tool_execution_end', toolCallId: 'pr', toolName: 'bash', result: { content: [{ type: 'text', text: 'https://github.com/example/repo/pull/2' }] } });
    await wait(() => document.querySelector('.pr-num')?.textContent === '#2');
    assert.equal(await run(() => document.querySelector('.pr-state').textContent), 'Draft');
    pr = { num: 2, url: 'https://github.com/example/repo/pull/2', state: 'closed', ci: 'none', checks: [], comments: 0 };
    emit({ type: 'agent_settled' });
    await wait(() => document.querySelector('.pr-state')?.textContent === 'Closed');

    // Transcript view: thinking folds into a single tool group, then switching detail level.
    emit({ type: 'agent_start' });
    emit({ type: 'message_start', message: { role: 'assistant' } });
    emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_start' } });
    emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'Read the date utility, then fix it.' } });
    emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_end', content: 'Read the date utility, then fix it.' } });
    emit({ type: 'tool_execution_start', toolCallId: 'tv-read', toolName: 'read', args: { path: 'src/utils/date.js' } });
    emit({ type: 'tool_execution_end', toolCallId: 'tv-read', toolName: 'read', result: { content: [{ type: 'text', text: 'export function formatDate' }] } });
    emit({ type: 'tool_execution_start', toolCallId: 'tv-edit', toolName: 'edit', args: { path: 'src/utils/date.js' } });
    emit({ type: 'tool_execution_end', toolCallId: 'tv-edit', toolName: 'edit', result: { content: [{ type: 'text', text: 'ok' }], details: { diff: '- 3 old\n+ 3 new\n+ 4 extra' } } });
    emit({ type: 'message_update', assistantMessageEvent: { type: 'text_start' } });
    emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Fixed.' } });
    emit({ type: 'message_update', assistantMessageEvent: { type: 'text_end', content: 'Fixed.' } });
    emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Fixed.' }], stopReason: 'stop' } });
    emit({ type: 'agent_settled' });
    await wait(() => [...document.querySelectorAll('.e-group')].some((g) => g.querySelector('.g-label')?.textContent.includes('Read a file')));

    const groupState = () => {
      const found = [...document.querySelectorAll('.e-group')].filter((g) => g.querySelector('.g-label')?.textContent.includes('Read a file'));
      if (found.length !== 1) return { groups: found.length };
      const g = found[0];
      return {
        groups: found.length,
        summary: g.querySelector('.g-label').textContent,
        stats: [...g.querySelectorAll('.g-sum .stat')].map((x) => x.textContent).join(' '),
        thoughts: g.querySelectorAll('.g-think').length,
        openThoughts: g.querySelectorAll('.g-think[open]').length,
        rows: g.querySelectorAll('.g-row').length,
        listVisible: getComputedStyle(g.querySelector('.g-list')).display !== 'none',
        open: g.classList.contains('open'),
      };
    };
    const normal = await run(groupState);
    assert.equal(normal.groups, 1, 'one tool group per assistant segment');
    assert.equal(normal.summary, 'Read a file, edited a file', 'summary aggregates the whole segment');
    assert.equal(normal.stats, '+2 −1', 'summary carries the combined diff stats');
    assert.equal(normal.thoughts, 0, 'Normal hides thinking');
    assert.equal(normal.listVisible, false, 'Normal collapses tool rows');
    assert.deepEqual(errors, []);

    await run(() => document.querySelector('#sessNameBtn').click());
    await wait(() => document.querySelector('#sessMenu').classList.contains('open'));
    await run(() => document.querySelector('[data-view="thinking"]').click());
    await wait(() => document.querySelector('.g-think'));
    const thinking = await run(groupState);
    assert.equal(thinking.thoughts, 1, 'Thinking shows the thought row');
    assert.equal(thinking.openThoughts, 0, 'Thinking keeps thought text collapsed');
    assert.equal(thinking.listVisible, false, 'Thinking keeps tool rows collapsed');

    await run(() => document.querySelector('#sessNameBtn').click());
    await run(() => document.querySelector('[data-view="verbose"]').click());
    await wait(() => document.querySelector('.e-group.open .g-think[open]'));
    const verbose = await run(groupState);
    assert.equal(verbose.open, true, 'Verbose expands the tool group');
    assert.equal(verbose.listVisible, true, 'Verbose shows every tool row');
    assert.equal(verbose.openThoughts, 1, 'Verbose expands thinking');

    await run(() => document.querySelector('#sessNameBtn').click());
    await run(() => document.querySelector('[data-view="normal"]').click());
    await wait(() => !document.querySelector('.g-think'));
    // Ctrl+O cycles only through the modes that make sense for this session.
    await run(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true })));
    await wait(() => document.querySelector('.g-think'));
    await run(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true })));
    await wait(() => document.querySelector('.e-group.open'));
    await run(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true })));
    await wait(() => !document.querySelector('.g-think'));

    // Output style lives in the same session menu and is pushed to the live session.
    await run(() => document.querySelector('#sessNameBtn').click());
    await run(() => document.querySelector('[data-style="concise"]').click());
    for (let i = 0; i < 50 && meta.outputStyle !== 'concise'; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(meta.outputStyle, 'concise', 'output style is persisted for the session');
    assert.ok(styles.includes('concise'), 'output style change reaches the main process');
    assert.equal(await run(() => document.querySelector('[data-style="concise"]').classList.contains('active')), true);
    await bounded();
    win.setContentSize(900, 600);
    await frame();
    await bounded();
    assert.deepEqual(errors, []);
    // Native previews must render identically for live tool events and saved history.
    const fixtures = [
      { id: 'offset', name: 'read', args: { path: 'read-offset.js', offset: 2501, limit: 2 }, result: { content: [{ type: 'text', text: '    const sample = 1;\n\n\n[9 more lines in file. Use offset=2503 to continue.]' }] } },
      { id: 'truncated', name: 'read', args: { path: 'truncated.js', offset: 90 }, result: { content: [{ type: 'text', text: 'alpha\nbeta\n\n[Showing lines 90-91 of 4000 (50.0KB limit). Use offset=92 to continue.]' }], details: { truncation: { truncated: true, content: 'alpha\nbeta' } } } },
      { id: 'edited', name: 'edit', args: { path: 'edited.js', edits: [{ oldText: 'old', newText: 'new' }] }, result: { content: [{ type: 'text', text: 'Successfully replaced' }], details: { diff: '     ...\n 3000 context\n-3001   old\n+3001   new\n+3002 extra\n 3002 next\n     ...', firstChangedLine: 3001 } } },
      { id: 'written', name: 'write', args: { path: 'written.js', content: 'const snapshot = true;\n' }, result: { content: [{ type: 'text', text: 'Successfully wrote to written.js' }] } },
      { id: 'failed', name: 'read', args: { path: 'missing.js', offset: 20 }, isError: true, result: { content: [{ type: 'text', text: 'ENOENT: file not found' }] } },
      { id: 'failed-edit', name: 'edit', args: { path: 'denied.js' }, isError: true, result: { content: [{ type: 'text', text: 'Permission denied' }] } },
      { id: 'image', name: 'read', args: { path: 'image.png' }, result: { content: [{ type: 'text', text: 'Read image file [image/png]' }, { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7xkAAAAASUVORK5CYII=' }] } },
    ];
    emit({ type: 'agent_start' });
    for (const f of fixtures) {
      emit({ type: 'tool_execution_start', toolCallId: f.id, toolName: f.name, args: f.args });
      emit({ type: 'tool_execution_end', toolCallId: f.id, toolName: f.name, result: f.result, isError: !!f.isError });
    }
    emit({ type: 'agent_settled' });
    await wait(() => !!document.querySelector('[title="Open current file: image.png"]'));
    const checkPreviews = async () => {
      assert.deepEqual(await run(() => {
        const row = document.querySelector('[title="Open current file: read-offset.js"]').closest('.g-row');
        return { numbers: [...row.querySelectorAll('.vl .n')].map((n) => n.textContent), source: row.querySelector('.vl span:last-child').textContent, continuation: row.querySelector('.tool-continuation').textContent, nested: row.querySelectorAll('button button').length };
      }), { numbers: ['2501', '2502'], source: '    const sample = 1;', continuation: '[9 more lines in file. Use offset=2503 to continue.]', nested: 0 });
      assert.deepEqual(await run(() => {
        const row = document.querySelector('[title="Open current file: edited.js"]').closest('.g-row');
        return { numbers: [...row.querySelectorAll('.dr .n')].map((n) => n.textContent), added: row.querySelector('.plus').textContent, deleted: row.querySelector('.minus').textContent, gaps: row.querySelectorAll('.tool-preview-gap').length, source: row.querySelector('.dr.add .c').textContent };
      }), { numbers: ['3000', '3001', '3001', '3002', '3002'], added: '+2', deleted: '−1', gaps: 2, source: '  new' });
      assert.equal(await run(() => document.querySelector('[title="Open current file: written.js"]').closest('.g-row').querySelectorAll('.dr.add, .plus, .new').length), 0, 'writes must not claim new-file status or invented additions');
      assert.match(await run(() => document.querySelector('[title="Open current file: written.js"]').closest('.g-row').textContent), /previous version unavailable/);
      for (const file of ['missing.js', 'denied.js']) assert.equal(await run((p) => document.querySelector(`[title="Open current file: ${p}"]`).closest('.g-row').querySelectorAll('.vl').length, file), 0, 'errors are never numbered source');
      assert.equal(await run(() => document.querySelector('[title="Open current file: image.png"]').closest('.g-row').querySelector('img').getAttribute('src').startsWith('data:image/png;base64,')), true);
      assert.equal(await run(() => document.querySelector('[title="Open current file: truncated.js"]').closest('.g-row').querySelectorAll('.vl').length), 2, 'truncation metadata is not a code line');
    };
    await checkPreviews();
    await run(() => document.querySelector('[title="Open current file: read-offset.js"]').closest('.e-group').querySelector('.g-sum').click());
    const reads = fileReads.length;
    await run(() => document.querySelector('[title="Open current file: read-offset.js"]').closest('.g-row').querySelector('[data-toggle]').click());
    assert.equal(fileReads.length, reads, 'disclosure must not fetch or open a file');
    assert.equal(await run(() => document.querySelector('[title="Open current file: read-offset.js"]').closest('.g-row').classList.contains('open')), true);
    await run(() => document.querySelector('[title="Open current file: read-offset.js"]').click());
    await wait(() => document.querySelector('#bottomBody .target-line')?.dataset.line === '2501');
    assert.equal(fileReads.at(-1).rel, 'read-offset.js');
    assert.equal(await run(() => document.querySelector('#bottomBody .target-line span:last-child').textContent), 'const currentLine2501 = 2501;', 'filename opens current source, not the earlier snapshot');
    await run(() => document.querySelector('[title="Open current file: edited.js"]').click());
    await wait(() => document.querySelector('#bottomBody .target-line')?.dataset.line === '3001');
    assert.equal(await run(() => document.querySelectorAll('#bottomBody .vl').length), 1000, 'long file viewer is windowed around firstChangedLine');
    await bounded();
    history = [{ role: 'assistant', content: fixtures.map((f) => ({ type: 'toolCall', id: f.id, name: f.name, arguments: f.args })) }, ...fixtures.map((f) => ({ role: 'toolResult', toolCallId: f.id, toolName: f.name, content: f.result.content, details: f.result.details, isError: f.isError }))];
    await new Promise((resolve) => { win.webContents.once('did-finish-load', resolve); win.webContents.reload(); });
    await wait(() => document.querySelector('#codeModelName').textContent === 'Test model');
    await run(() => document.querySelector('.cn-s').click());
    await wait(() => !!document.querySelector('[title="Open current file: image.png"]'));
    await checkPreviews();
    assert.deepEqual(errors, []);
    console.log('PASS: question previews/options, bounded text, links, PR states, transcript view, output style, native read/edit/write/image/error previews live and replayed');
    app.exit(0);
  }).catch((err) => { console.error(err); app.exit(1); });
}
