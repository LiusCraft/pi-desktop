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
  const meta = { id: 'render-test', kind: 'code', title: 'Rendering regression', projectPath: 'C:/projects/pi-desktop', cwd: 'C:/projects/pi-desktop', branch: 'claude/long-branch-'.repeat(12), mode: 'auto', updatedAt: Date.now() };
  const model = { provider: 'fixture', id: 'test', name: 'Test model', contextWindow: 1000000 };
  let win, pr = null, prQueries = 0;
  const answers = [], opened = [], errors = [];
  const replies = {
    'app:info': () => ({ version: 'test', keyProviders: [] }), 'app:theme': () => null,
    'app:openExternal': (_e, url) => { opened.push(url); },
    'projects:list': () => [{ path: meta.projectPath, name: 'pi-desktop' }],
    'sessions:list': () => [meta], 'cowork:folders': () => [], 'sessions:importable': () => [],
    'models:list': () => ({ models: [model], defaultModel: 'fixture/test' }), 'models:levels': () => ['off'],
    'sessions:open': () => ({ meta, state: { model, thinkingLevel: 'off' }, messages: [], stats: {} }),
    'sessions:rpc': () => ({ commands: [], levels: ['off'] }),
    'sessions:changes': () => [{ path: 'file.js', before: 'old', after: 'new' }],
    'sessions:pr': () => { prQueries++; return pr; },
    'sessions:ui': (_e, id, requestId, payload) => { answers.push({ id, requestId, payload }); },
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
    win.setContentSize(900, 600);
    await frame();
    await bounded();
    assert.deepEqual(errors, []);
    console.log('PASS: question previews/options, bounded long text, clickable safe links, PR creation/refresh/states');
    app.exit(0);
  }).catch((err) => { console.error(err); app.exit(1); });
}
