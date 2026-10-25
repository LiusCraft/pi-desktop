// Offline regression: four independent tool panels and real pointer splitters.
const path = require('node:path');
const fs = require('node:fs');
if (!process.versions.electron) {
  const userData = fs.mkdtempSync(path.join(process.env.TEMP || require('node:os').tmpdir(), 'pi-workspace-ui-'));
  const env = { ...process.env, PI_UI_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), [__filename], { env, stdio: 'inherit' });
  child.on('error', (err) => { console.error(err); process.exit(1); });
  child.on('exit', (code) => { fs.rmSync(userData, { recursive: true, force: true }); process.exit(code ?? 1); });
} else {
  const assert = require('node:assert/strict');
  const { app, BrowserWindow, ipcMain } = require('electron');
  app.setPath('userData', process.env.PI_UI_USER_DATA);
  const metas = ['first', 'second'].map((id) => ({ id, kind: 'code', title: `Workspace ${id}`, projectPath: 'C:/projects/pi-desktop', cwd: 'C:/projects/pi-desktop', branch: 'claude/workspace-layout', baseBranch: 'main', baseCommit: 'fixture', mode: 'auto', updatedAt: Date.now() }));
  const model = { provider: 'fixture', id: 'test', name: 'Test model', contextWindow: 1000000 };
  const files = ['.github/workflows/test.yml', 'electron/main.js', 'renderer/index.html', 'renderer/nested/app.js', 'renderer/nested/style.css', 'README.md'];
  const before = Array.from({ length: 60 }, (_, i) => `const old${i} = "${'long code '.repeat(30)}";`).join('\n');
  const after = before.replaceAll('const old', 'const updated');
  const errors = [], commands = [], fileReads = [], pendingFileReads = [];
  const longFile = Array.from({ length: 5500 }, (_, i) => `const current${i + 1} = "${'long source '.repeat(8)}";`).join('\n');
  let win, previewRequests = 0;
  const server = require('node:http').createServer((_req, res) => {
    previewRequests++;
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><meta name="viewport" content="width=device-width"><style>body{margin:0;padding:16px;font:16px system-ui;background:#def;color:#123}main{max-width:100%}</style><main><h1>Responsive preview</h1><p>Resizing a panel changes its viewport, not its scroll offset.</p><input placeholder="Preserved input"></main>');
  });
  const replies = {
    'app:info': () => ({ version: 'test', keyProviders: [] }), 'app:theme': () => null,
    'projects:list': () => [{ path: metas[0].projectPath, name: 'pi-desktop' }],
    'sessions:list': () => metas, 'cowork:folders': () => [], 'sessions:importable': () => [],
    'models:list': () => ({ models: [model], defaultModel: 'fixture/test' }), 'models:levels': () => ['off'],
    'sessions:open': (_e, id) => ({ meta: metas.find((m) => m.id === id), state: { model, thinkingLevel: 'off' }, messages: [], stats: {} }),
    'sessions:rpc': (_e, id, request) => {
      if (request.type === 'bash') { commands.push({ id, command: request.command }); return { output: 'offline command output', exitCode: 0 }; }
      return { commands: [], levels: ['off'] };
    },
    'sessions:changes': () => [{ path: 'electron/main.js', before, after }],
    'sessions:pr': () => null,
    'sessions:files': () => files,
    'sessions:readFile': (_e, id, rel) => {
      fileReads.push({ id, rel });
      if (rel.startsWith('slow-')) return new Promise((resolve, reject) => pendingFileReads.push({ id, rel, resolve, reject }));
      if (rel === 'unavailable.js') return null;
      if (rel === 'missing.js') throw new Error('ENOENT: current file is missing');
      return rel === 'electron/main.js' ? longFile : `// ${rel}\nconst example = true;`;
    },
  };
  for (const [channel, handler] of Object.entries(replies)) ipcMain.handle(channel, handler);
  const run = (fn, ...args) => win.webContents.executeJavaScript(`(${fn})(${args.map((a) => JSON.stringify(a)).join(',')})`);
  const emit = (event) => win.webContents.send('pi:event', { sessionId: metas[0].id, event });
  // Inspect the localhost fixture through Electron, keeping the app's normal
  // cross-origin restrictions in place.
  const previewRun = (fn) => win.webContents.mainFrame.frames.find((frame) => frame.url.startsWith(`http://127.0.0.1:${server.address().port}/`))?.executeJavaScript(`(${fn})()`) ?? Promise.resolve(false);
  const frame = () => run(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const wait = async (fn, evaluate = run) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(fn)) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`UI condition timed out: ${fn}`);
  };
  const click = (selector) => run((s) => document.querySelector(s).click(), selector);
  const box = (selector) => run((s) => {
    const { x, y, width, height, right, bottom } = document.querySelector(s).getBoundingClientRect();
    return { x, y, width, height, right, bottom };
  }, selector);
  const drag = async (selector, dx, dy) => {
    const rect = await box(selector), x = Math.round(rect.x + rect.width / 2), y = Math.round(rect.y + rect.height / 2);
    win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x, y });
    for (let i = 1; i <= 5; i++) {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: x + Math.round(dx * i / 5), y: y + Math.round(dy * i / 5), movementX: dx / 5, movementY: dy / 5 });
      await frame();
    }
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: x + dx, y: y + dy });
    await frame();
  };
  const bounded = async () => {
    assert.deepEqual(await run(() => ['#app', '#codeMain', '#rightCol', '#dockPrimary', '#dockSecondary'].filter((s) => {
      const el = document.querySelector(s);
      return el.clientWidth && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
    })), [], 'outer layout must never scroll or clip oversized tool columns');
    assert.deepEqual(await run(() => [...document.querySelectorAll('.right-col .card')].filter((el) => el.getBoundingClientRect().width).filter((el) => {
      const r = el.getBoundingClientRect(), p = el.parentElement.getBoundingClientRect();
      return r.x < p.x - 1 || r.right > p.right + 1 || r.y < p.y - 1 || r.bottom > p.bottom + 1;
    }).map((el) => el.id)), [], 'all panels must remain inside their columns');
    const buttonsClear = await run(() => {
      const header = document.querySelector('.ch').getBoundingClientRect();
      const nativeControls = document.body.dataset.os === 'win' ? 145 : 0;
      return [...document.querySelectorAll('#codeActions > button, #codeActions > .pop-wrap > button')].filter((el) => el.getBoundingClientRect().width).every((el) => {
        const r = el.getBoundingClientRect();
        return r.x >= header.x && r.right <= header.right - nativeControls;
      });
    });
    assert.ok(buttonsClear, 'tool buttons must remain accessible and clear of native window controls');
  };
  const shot = async (name) => {
    if (!process.env.PI_UI_SCREENSHOTS) return;
    fs.mkdirSync(process.env.PI_UI_SCREENSHOTS, { recursive: true });
    fs.writeFileSync(path.join(process.env.PI_UI_SCREENSHOTS, name + '.png'), (await win.webContents.capturePage()).toPNG());
  };

  app.whenReady().then(async () => {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    win = new BrowserWindow({ show: false, useContentSize: true, width: 1600, height: 980,
      titleBarStyle: 'hidden', titleBarOverlay: { color: '#1f1f1e', symbolColor: '#c3c1bb', height: 44 },
      webPreferences: { preload: path.resolve(__dirname, '../electron/preload.js'), partition: 'workspace-test' } });
    win.webContents.on('preload-error', (_e, _p, err) => errors.push(err.message));
    win.webContents.on('console-message', ({ level, message }) => { if (level === 'error' && !/ERR_|Content Security/.test(message)) errors.push(message); });
    win.webContents.session.webRequest.onBeforeRequest({ urls: ['https://*/*'] }, (_d, cb) => cb({ cancel: true }));
    await win.loadFile(path.resolve(__dirname, '../renderer/index.html'));
    await wait(() => document.querySelectorAll('.cn-s').length === 2);
    await run((url) => { localStorage.setItem('pd_preview', JSON.stringify(url)); document.documentElement.dataset.theme = 'dark'; }, `http://127.0.0.1:${server.address().port}`);
    await click('.cn-s');
    await wait(() => document.querySelectorAll('#diffBody .dr').length > 0);
    await click('#previewBtn');
    await click('#filesBtn');
    await click('#termBtn');
    await wait(() => document.querySelector('#filesBody .file-tree-row'));
    await wait(() => !!document.querySelector('main'), previewRun);
    await frame();
    assert.equal(await run(() => document.querySelectorAll('.right-col .card:not([hidden])').length), 4, 'Diff, preview, files and terminal coexist');
    assert.equal(await run(() => document.querySelector('.code-center').getBoundingClientRect().width > 0), true, 'wide windows retain the conversation');
    await bounded();
    const first = await box('#dockPrimary');
    const diff = await box('#diffCard');
    const filePanel = await box('#filesCard');
    const requests = previewRequests;
    await run(() => {
      window.workspaceFrame = document.querySelector('#previewBody iframe');
      window.workspaceInput = document.querySelector('.term-in input');
      workspaceInput.value = 'unsent command';
    });
    await previewRun(() => { document.querySelector('input').value = 'unsent preview input'; });
    await drag('#columnsResize', 75, 0);
    assert.ok((await box('#dockPrimary')).width > first.width + 40, 'dragging a column divider adjusts panel width');
    await drag('#dockPrimary .row-resize', 0, 100);
    assert.ok((await box('#diffCard')).height > diff.height + 80, 'dragging a row divider adjusts panel height');
    assert.ok(Math.abs((await box('#filesCard')).height - filePanel.height) < 2, 'each column has independent panel heights');
    const secondary = await box('#filesCard');
    await drag('#dockSecondary .row-resize', 0, -70);
    assert.ok((await box('#filesCard')).height < secondary.height - 50);
    const dock = await box('#rightCol');
    await drag('#workspaceResize', -90, 0);
    assert.ok((await box('#rightCol')).width > dock.width + 50, 'conversation/tools divider adjusts workspace width');
    assert.equal(await run(() => window.workspaceFrame === document.querySelector('#previewBody iframe') && workspaceInput === document.querySelector('.term-in input') && workspaceInput.value === 'unsent command'), true, 'splitters preserve live preview and pending terminal input');
    assert.equal(await previewRun(() => document.querySelector('input').value), 'unsent preview input', 'splitters preserve preview document state');
    assert.equal(previewRequests, requests, 'dragging must not reload the preview');
    assert.equal(await run(() => document.body.classList.contains('workspace-resizing') || !!document.querySelector('.resize-shield')), false, 'pointer capture and drag shield are released');
    await bounded();
    await shot('workspace-wide');

    const height = (await box('#diffCard')).height;
    await run(() => document.querySelector('#dockPrimary .row-resize').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })));
    await frame();
    assert.ok((await box('#diffCard')).height < height - 5, 'splitters support keyboard resizing');
    assert.ok(await run(() => JSON.parse(localStorage.getItem('pd_workspace')).width > 0), 'layout preferences are persisted');

    for (const [width, height] of [[1100, 700], [785, 1040], [720, 480], [1600, 980]]) {
      win.setContentSize(width, height);
      await run(() => document.querySelector('#app').classList.add('collapsed'));
      await frame();
      // Sidebar width has a CSS transition.
      await new Promise((resolve) => setTimeout(resolve, 250));
      await frame();
      await bounded();
      assert.equal(await run(() => document.querySelector('#diffBody').scrollLeft), 0, 'resizing must not crop the left-hand diff gutter');
      assert.equal(await run(() => document.querySelector('#previewBody').scrollLeft), 0);
      assert.equal(await run(() => [...document.querySelectorAll('#previewBody iframe')].every((el) => Math.abs(el.getBoundingClientRect().width - el.parentElement.clientWidth) < 2)), true, 'preview viewport matches its panel width');
      if (width === 785) await shot('workspace-narrow');
    }

    await click('#diffCard [data-t="expand"]');
    await frame();
    assert.equal(await run(() => document.querySelector('#previewCard').getBoundingClientRect().width), 0);
    await click('#diffCard [data-t="expand"]');
    await frame();
    assert.ok((await box('#previewCard')).width > 0, 'restoring an expanded panel restores all other panels');
    await bounded();
    // Opening a file does not replace the preview or the terminal.
    await click('#filesBody [data-p="renderer"]');
    await click('#filesBody [data-p="renderer/nested"]');
    await click('#filesBody [data-p="renderer/nested/app.js"]');
    await wait(() => !document.querySelector('#bottomCard').hidden);
    assert.equal(await run(() => !document.querySelector('#previewCard').hidden && !document.querySelector('#terminalCard').hidden), true);
    await bounded();
    await click('#filesBody [data-p="renderer"]');
    assert.equal(await run(() => !!document.querySelector('#filesBody [data-p="renderer/nested/app.js"]')), false, 'collapsing a parent hides expanded descendants');
    await run(() => { const input = document.querySelector('#filesFilter'); input.value = 'style.css'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(await run(() => !!document.querySelector('#filesBody [data-p="renderer/nested/style.css"]')), true, 'filter finds files in collapsed folders');
    await click('#bottomHead [data-x]');
    await click('#previewHead [data-x]');
    assert.equal(await run(() => !document.querySelector('#terminalCard').hidden), true, 'closing preview leaves terminal open');

    // Tool filenames always open current source, even when git already knows the file.
    const previewFixtures = [
      { id: 'current-edit', name: 'edit', path: 'electron/main.js', details: { diff: '-3101 old\n+3101 replacement', firstChangedLine: 3101 } },
      { id: 'past-eof', name: 'edit', path: 'past-eof.js', details: { diff: '-9000 removed', firstChangedLine: 9000 } },
      ...['slow-first.js', 'slow-second.js', 'slow-close.js', 'slow-session.js', 'slow-welcome.js', 'slow-reject.js', 'missing.js', 'unavailable.js'].map((path) => ({ id: path, name: 'read', path })),
    ];
    emit({ type: 'agent_start' });
    for (const f of previewFixtures) {
      emit({ type: 'tool_execution_start', toolCallId: f.id, toolName: f.name, args: { path: f.path } });
      emit({ type: 'tool_execution_end', toolCallId: f.id, toolName: f.name, result: { content: [{ type: 'text', text: 'snapshot' }], details: f.details } });
    }
    emit({ type: 'agent_settled' });
    await wait(() => !!document.querySelector('[title="Open current file: electron/main.js"]'));
    await run(() => document.querySelector('[title="Open current file: electron/main.js"]').closest('.e-group').querySelector('.g-sum').click());
    const fileClick = (path) => click(`[title="Open current file: ${path}"]`);
    await fileClick('electron/main.js');
    await wait(() => document.querySelector('#bottomBody .target-line')?.dataset.line === '3101');
    assert.equal(fileReads.at(-1).rel, 'electron/main.js');
    assert.equal(await run(() => !document.querySelector('#bottomCard').hidden && !document.querySelector('#diffCard').hidden), true, 'current file and explicit diff remain separate panels');
    assert.equal(await run(() => document.querySelectorAll('#bottomBody .vl').length), 1000);
    assert.equal(await run(() => document.querySelector('#bottomBody .target-line span:last-child').textContent.startsWith('const current3101 =')), true, 'real current file is highlighted at firstChangedLine beyond line 2000');
    assert.ok(await run(() => {
      const target = document.querySelector('#bottomBody .target-line').getBoundingClientRect(), body = document.querySelector('#bottomBody').getBoundingClientRect();
      return target.top >= body.top && target.bottom <= body.bottom;
    }), 'requested target is scrolled into view');
    assert.equal(await run(() => getComputedStyle(document.querySelector('#bottomBody')).overflowY === 'auto' && getComputedStyle(document.querySelector('#bottomBody .file-code')).overflowY === 'visible'), true, 'one vertical scroll owner');
    await click('#bottomBody [data-next]');
    assert.equal(await run(() => document.querySelector('#bottomBody .vl').dataset.line), '3601');
    await click('#bottomBody [data-prev]');
    assert.equal(await run(() => document.querySelector('#bottomBody .target-line').dataset.line), '3101');
    await run(() => { const body = document.querySelector('#bottomBody'); body.scrollTop += 50; window.fileTop = body.scrollTop; });
    await click('#filesBtn'); // Other panels re-render without resetting the file scroll.
    assert.equal(await run(() => document.querySelector('#bottomBody').scrollTop === window.fileTop), true);
    await click('#filesBtn');
    await click('#bottomHead [data-diff]');
    assert.equal(await run(() => document.querySelector('#diffBody .df').classList.contains('flash')), true, 'Diff remains an explicit entry point');
    await bounded();
    await fileClick('past-eof.js');
    await wait(() => document.querySelector('#bottomBody .target-line')?.dataset.line === '2');
    assert.match(await run(() => document.querySelector('#bottomBody .tool-preview-note').textContent), /Requested line 9000.*Showing the last line/);
    await fileClick('unavailable.js');
    await wait(() => document.querySelector('#bottomBody').textContent.includes('File preview unavailable'));
    await fileClick('missing.js');
    await wait(() => document.querySelector('#bottomBody .file-read-error'));
    assert.equal(await run(() => document.querySelectorAll('#bottomBody .vl').length), 0);
    await fileClick('slow-first.js');
    await fileClick('slow-second.js');
    assert.equal(pendingFileReads.length, 2);
    pendingFileReads.find((r) => r.rel === 'slow-second.js').resolve('newer source');
    await wait(() => document.querySelector('#bottomBody .vl')?.textContent.includes('newer source'));
    pendingFileReads.find((r) => r.rel === 'slow-first.js').resolve('stale source');
    await frame();
    assert.equal(await run(() => document.querySelector('#bottomBody').textContent.includes('stale source')), false, 'older request cannot replace newer preview');
    await fileClick('slow-close.js');
    await click('#bottomHead [data-x]');
    pendingFileReads.find((r) => r.rel === 'slow-close.js').resolve('must remain closed');
    await frame();
    assert.equal(await run(() => document.querySelector('#bottomCard').hidden), true, 'late response cannot reopen a closed file');
    await fileClick('slow-welcome.js');
    await click('#newSession');
    pendingFileReads.find((r) => r.rel === 'slow-welcome.js').resolve('welcome stale');
    await frame();
    assert.equal(await run(() => document.body.dataset.view), 'welcome');
    await run(() => [...document.querySelectorAll('.cn-s')].find((s) => s.textContent.includes('Workspace first')).click());
    assert.equal(await run(() => document.querySelector('#bottomCard').hidden), true, 'returning after a pending read does not retain a loading panel');
    await fileClick('slow-reject.js');
    await fileClick('unavailable.js');
    pendingFileReads.find((r) => r.rel === 'slow-reject.js').reject(new Error('late rejected read'));
    await frame();
    assert.equal(await run(() => document.querySelector('#bottomBody').textContent.includes('late rejected read')), false, 'late errors cannot replace the current file');
    await fileClick('slow-session.js');
    // A different session must not reuse terminal state or a pending file request.
    await run(() => document.querySelectorAll('.cn-s')[1].click());
    pendingFileReads.find((r) => r.rel === 'slow-session.js').resolve('wrong session');
    await frame();
    assert.equal(await run(() => document.querySelector('#bottomCard').hidden), true, 'old-session read completion cannot open a file in the new session');
    await click('#termBtn');
    await run(() => { document.querySelector('.term-in input').value = 'echo second'; document.querySelector('.term-in').requestSubmit(); });
    await wait(() => document.querySelector('.term-b').textContent.includes('offline command output'));
    assert.equal(commands.at(-1).id, 'second');
    // New session must not inherit workspace-only mode from an expanded panel.
    await click('#diffCard [data-t="expand"]');
    await click('#newSession');
    await frame();
    assert.ok((await box('.code-center')).width > 0, 'new-session composer is not hidden by a previous workspace state');
    assert.deepEqual(errors, []);
    console.log('PASS: four panels, independent splitters, retained iframe/input, narrow windows, file tree, long current-file targets/paging, explicit diff, request/session races');
    server.close();
    app.exit(0);
  }).catch((err) => { console.error(err); server.close(); app.exit(1); });
}
