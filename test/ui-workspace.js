// Offline regression: independent tool panels, sidebar and real pointer splitters.
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
  const settings = { theme: 'dark', resolvedTheme: 'dark', sidebarCollapsed: false, defaultMode: 'code' };
  ipcMain.on('app:boot', (event) => { event.returnValue = { settings: { ...settings } }; });
  const metas = ['first', 'second'].map((id) => ({ id, kind: 'code', title: `Workspace ${id}`, projectPath: 'C:/projects/pi-desktop', cwd: 'C:/projects/pi-desktop', branch: 'claude/workspace-layout', baseBranch: 'main', baseCommit: 'fixture', mode: 'auto', updatedAt: Date.now() }));
  const model = { provider: 'fixture', id: 'test', name: 'Test model', contextWindow: 1000000 };
  const files = ['.github/workflows/test.yml', 'electron/main.js', 'renderer/index.html', 'renderer/nested/app.js', 'renderer/nested/style.css', 'README.md'];
  const before = Array.from({ length: 60 }, (_, i) => `const old${i} = "${'long code '.repeat(30)}";`).join('\n');
  const after = before.replaceAll('const old', 'const updated');
  const errors = [], commands = [], settingsWrites = [], fileReads = [], pendingFileReads = [];
  const longFile = Array.from({ length: 5500 }, (_, i) => `const current${i + 1} = "${'long source '.repeat(8)}";`).join('\n');
  let win, previewRequests = 0;
  const server = require('node:http').createServer((_req, res) => {
    previewRequests++;
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><meta name="viewport" content="width=device-width"><style>body{margin:0;padding:16px;font:16px system-ui;background:#def;color:#123}main{max-width:100%}</style><main><h1>Responsive preview</h1><p>Resizing a panel changes its viewport, not its scroll offset.</p><input placeholder="Preserved input"></main>');
  });
  const replies = {
    'app:info': () => ({ version: 'test', keyProviders: [] }), 'app:theme': () => null,
    'settings:get': () => ({ ...settings }),
    'settings:set': (_e, patch) => { settingsWrites.push(patch); return { ...Object.assign(settings, patch) }; },
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
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const primary = process.platform === 'darwin' ? 'meta' : 'control';
  const key = async (keyCode, modifiers = []) => {
    win.webContents.focus();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await frame();
  };
  let leftDown = false;
  const mouse = async (type, x, y, clickCount = 1) => {
    if (type === 'mouseDown') leftDown = true;
    if (type === 'mouseUp') leftDown = false;
    win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), modifiers: leftDown ? ['leftButtonDown'] : [], ...(type === 'mouseMove' ? {} : { button: 'left', clickCount }) });
    await frame();
  };
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
      const nativeControls = document.body.dataset.os === 'win' && innerWidth > 768 ? 145 : 0;
      return [...document.querySelectorAll('#codeActions > button, #codeActions > .pop-wrap > button')].filter((el) => el.getBoundingClientRect().width).every((el) => {
        const r = el.getBoundingClientRect();
        return r.x >= header.x && r.right <= header.right - nativeControls;
      });
    });
    assert.ok(buttonsClear, 'tool buttons must remain accessible and clear of native window controls');
  };
  const sidebarWidth = async (expected, message) => {
    await frame();
    const state = await run(() => {
      const divider = document.querySelector('#sidebarResize');
      return { width: document.querySelector('#sidebar').getBoundingClientRect().width,
        min: +divider.getAttribute('aria-valuemin'), max: +divider.getAttribute('aria-valuemax'),
        now: +divider.getAttribute('aria-valuenow'), appWidth: document.querySelector('#app').clientWidth };
    });
    assert.ok(Math.abs(state.width - expected) < 1, `${message}: expected ${expected}px, got ${state.width}px`);
    assert.equal(state.now, expected, 'accessible width follows the sidebar');
    assert.equal(state.min, 260);
    assert.equal(state.max, Math.max(260, Math.min(480, state.appWidth - 480)));
  };
  const sidebarClean = async () => {
    assert.equal(await run(() => !!document.querySelector('.resize-shield, .sidebar-resize.dragging') ||
      document.body.classList.contains('workspace-resizing') || document.body.classList.contains('sidebar-resizing') ||
      document.querySelector('#sidebarResize').hasPointerCapture(window.sidebarPointerId ?? 1)), false, 'sidebar releases capture, shield and resizing classes');
  };
  const sidebarCollapsed = async (expected) => {
    assert.deepEqual(await run(() => ({ collapsed: document.querySelector('#app').classList.contains('collapsed'),
      saved: JSON.parse(localStorage.getItem('cc_collapsed')), expanded: document.querySelector('#toggleSidebar').getAttribute('aria-expanded') })),
    { collapsed: expected, saved: expected, expanded: String(!expected) }, 'all collapse actions share state and accessibility');
    await run(() => window.piDesktop.invoke('settings:get'));
    assert.equal(settings.sidebarCollapsed, expected, 'collapse state reaches native settings');
    await delay(250);
    await frame();
  };
  const sidebarPointerDown = async (dwell = false) => {
    const rect = await box('#sidebarResize'), x = Math.round(rect.x + rect.width / 2), y = Math.round(rect.y + rect.height / 2);
    await mouse('mouseMove', x + 30, y);
    await mouse('mouseMove', x, y);
    if (dwell) await wait(() => !document.querySelector('#sidebarTip').hidden);
    await mouse('mouseDown', x, y);
    assert.equal(await run(() => document.querySelector('#sidebarResize').hasPointerCapture(window.sidebarPointerId)), true, 'native pointerdown captures the pointer');
    return { x, y };
  };
  const hoverSidebarTip = async (edge = 'top') => {
    const rect = await box('#sidebarResize'), x = rect.x + rect.width / 2, y = edge === 'top' ? rect.y + 8 : rect.bottom - 8;
    await mouse('mouseMove', x + 30, y);
    await mouse('mouseMove', x, y);
    await wait(() => !document.querySelector('#sidebarTip').hidden);
    assert.equal(await run(() => {
      const tip = document.querySelector('#sidebarTip'), r = tip.getBoundingClientRect();
      return tip.getAttribute('role') === 'tooltip' && !document.querySelector('#sidebar').contains(tip) &&
        r.x >= 8 && r.y >= 8 && r.right <= innerWidth - 8 && r.bottom <= innerHeight - 8 &&
        document.querySelector('#sidebarResize').getAttribute('aria-describedby') === 'sidebarTip';
    }), true, 'root tooltip stays in the viewport even at the ends of the divider');
  };
  const sidebarRegression = async () => {
    await run(() => document.querySelector('#sidebarResize').addEventListener('pointerdown', (e) => { window.sidebarPointerId = e.pointerId; }));
    await sidebarWidth(340, 'desktop default');
    assert.deepEqual(await run(() => {
      const divider = document.querySelector('#sidebarResize'), r = divider.getBoundingClientRect(), app = document.querySelector('#app').getBoundingClientRect();
      const style = getComputedStyle(divider), pill = getComputedStyle(divider, '::after');
      return { role: divider.getAttribute('role'), orientation: divider.getAttribute('aria-orientation'), label: divider.getAttribute('aria-label'),
        width: r.width, fullHeight: r.y === app.y && r.bottom === app.bottom, netWidth: r.width + parseFloat(style.marginLeft) + parseFloat(style.marginRight),
        gap: document.querySelector('#codeMain').getBoundingClientRect().x - document.querySelector('#sidebar').getBoundingClientRect().right,
        background: style.backgroundColor, pillWidth: pill.width, pillHeight: pill.height, pillHidden: pill.opacity === '0',
        neutral: pill.backgroundColor === getComputedStyle(document.querySelector('#sidebarShortcut')).color,
        shortcut: document.querySelector('#sidebarShortcut').textContent,
        lines: [...document.querySelector('#sidebarTip').children].map((el) => el.textContent.trim()), tipHidden: document.querySelector('#sidebarTip').hidden };
    }), { role: 'separator', orientation: 'vertical', label: 'Resize sidebar', width: 10, fullHeight: true, netWidth: 0, gap: 0,
      background: 'rgba(0, 0, 0, 0)', pillWidth: '4px', pillHeight: '48px', pillHidden: true, neutral: true,
      shortcut: process.platform === 'darwin' ? '⌘ B' : 'Ctrl B',
      lines: [`Hide sidebar${process.platform === 'darwin' ? '⌘ B' : 'Ctrl B'}`, 'Drag to resize'], tipHidden: true });

    // The entire seam is a hover target, not just its centered pill. Leaving
    // before 700ms cancels the pending tooltip rather than showing it later.
    const seam = await box('#sidebarResize'), x = seam.x + seam.width / 2;
    await mouse('mouseMove', x, seam.y + 8);
    await delay(450);
    assert.equal(await run(() => document.querySelector('#sidebarTip').hidden), true, 'tooltip waits for a 700ms dwell');
    await mouse('mouseMove', x + 30, seam.y + 8);
    await delay(350);
    assert.equal(await run(() => document.querySelector('#sidebarTip').hidden), true, 'leaving cancels the delayed tooltip');
    await hoverSidebarTip();
    assert.equal(await run(() => getComputedStyle(document.querySelector('#sidebarResize'), '::after').opacity), '1', 'hover anywhere reveals the centered pill');
    await mouse('mouseMove', x + 30, seam.y + 8);
    assert.equal(await run(() => document.querySelector('#sidebarTip').hidden), true, 'leaving hides a visible tooltip');
    await hoverSidebarTip('bottom');
    await key('Escape');
    assert.equal(await run(() => document.querySelector('#sidebarTip').hidden), true, 'Escape hides the tooltip');
    const down = await sidebarPointerDown(true);
    assert.equal(await run(() => document.querySelector('#sidebarTip').hidden), true, 'pointerdown hides the tooltip');
    await mouse('mouseMove', down.x + 2, down.y);
    await sidebarWidth(340, 'sub-threshold movement is still a click');
    assert.equal(await run(() => !!document.querySelector('.resize-shield') || document.body.classList.contains('sidebar-resizing')), false);
    await mouse('mouseMove', down.x + 3, down.y);
    await sidebarWidth(343, 'three pixels starts a drag');
    assert.equal(await run(() => !!document.querySelector('.resize-shield') && document.body.classList.contains('workspace-resizing') && document.body.classList.contains('sidebar-resizing')), true);
    await mouse('mouseUp', down.x + 3, down.y);
    await sidebarClean();
    await drag('#sidebarResize', 87, 0);
    await sidebarWidth(430, 'native drag grows by exactly its pointer delta');
    await drag('#sidebarResize', -70, 0);
    await sidebarWidth(360, 'native drag shrinks in the other direction');
    await drag('#sidebarResize', 500, 0);
    await sidebarWidth(480, 'native drag clamps at the maximum');
    await drag('#sidebarResize', -300, 0);
    await sidebarWidth(260, 'native drag clamps at the minimum');
    await drag('#sidebarResize', 80, 0);
    await sidebarWidth(340, 'dragging back restores the default width');
    await sidebarClean();

    // Capture loss is real; cancellation/blur notifications are dispatched since
    // sendInputEvent cannot generate pointercancel or blur a hidden test window.
    for (const reason of ['pointercancel', 'lostpointercapture', 'blur']) {
      const p = await sidebarPointerDown();
      await mouse('mouseMove', p.x + 20, p.y);
      assert.equal(await run(() => !!document.querySelector('.resize-shield')), true);
      await run((reason) => {
        if (reason === 'lostpointercapture') document.querySelector('#sidebarResize').releasePointerCapture(window.sidebarPointerId);
        else window.dispatchEvent(reason === 'blur' ? new Event('blur') : new PointerEvent(reason, { pointerId: window.sidebarPointerId, bubbles: true }));
      }, reason);
      // Capture changes are delivered with the next pointer event, not a frame.
      await mouse('mouseMove', p.x + 20, p.y);
      await sidebarClean();
      await mouse('mouseUp', p.x + 20, p.y);
    }
    await hoverSidebarTip();
    await run(() => window.dispatchEvent(new Event('blur')));
    assert.equal(await run(() => document.querySelector('#sidebarTip').hidden), true, 'window blur hides the tooltip');
    await run(() => document.querySelector('#sidebarResize').focus());
    await wait(() => !document.querySelector('#sidebarTip').hidden);
    await run(() => document.querySelector('#codeInput').focus());
    assert.equal(await run(() => document.querySelector('#sidebarTip').hidden), true, 'focus leaving the separator hides the tooltip');

    const preferred = (await box('#sidebar')).width;
    const dbl = await box('#sidebarResize'), dx = dbl.x + dbl.width / 2, dy = dbl.y + dbl.height / 2;
    await mouse('mouseMove', dx, dy);
    for (const count of [1, 2]) { await mouse('mouseDown', dx, dy, count); await mouse('mouseUp', dx, dy, count); }
    await sidebarCollapsed(true);
    assert.equal((await box('#sidebar')).width, 0, 'native double-click hides the sidebar');
    await sidebarClean();
    await click('#toggleSidebar');
    await sidebarCollapsed(false);
    await sidebarWidth(preferred, 'button restores the last expanded width');
    await run(() => document.querySelector('.term-in input').focus());
    await key('B', [primary]);
    await sidebarCollapsed(true);
    await key('B', [primary]);
    await sidebarCollapsed(false);
    await sidebarWidth(preferred, 'primary-B works from a focused terminal without losing width');
    const writes = settingsWrites.length;
    await key('.', [primary]);
    await sidebarCollapsed(true);
    assert.equal(settingsWrites.length, writes + 1, 'legacy alias toggles once, not once per view listener');
    await key('B', [primary]);
    await sidebarCollapsed(false);
    await run(() => document.querySelector('#codeInput').focus());
    for (const modifiers of [[primary, 'shift'], [primary, 'alt'], ['meta', 'control'], [primary, 'isautorepeat'], [primary === 'meta' ? 'control' : 'meta']]) {
      await key('B', modifiers);
      assert.equal(await run(() => document.querySelector('#app').classList.contains('collapsed')), false, 'extra modifiers, repeats and non-platform primary are ignored');
    }
    // Native key injection cannot express IME composition.
    await run(() => document.querySelector('#codeInput').dispatchEvent(new KeyboardEvent('keydown', {
      key: 'b', bubbles: true, isComposing: true, [window.piDesktop.platform === 'darwin' ? 'metaKey' : 'ctrlKey']: true,
    })));
    assert.equal(await run(() => document.querySelector('#app').classList.contains('collapsed')), false, 'composition never toggles the sidebar');

    await run(() => document.querySelector('#sidebarResize').focus());
    for (const [code, modifiers, width] of [['Home', [], 260], ['Right', [], 270], ['Right', ['shift'], 310], ['Left', [], 300], ['Left', ['shift'], 260], ['End', [], 480]]) {
      await key(code, modifiers);
      await delay(250);
      await sidebarWidth(width, 'separator keyboard step or boundary');
    }
    await hoverSidebarTip();
    win.setContentSize(900, 980);
    await delay(250);
    await sidebarWidth(420, 'viewport fitting leaves 480px for content');
    assert.equal(await run(() => document.querySelector('#sidebarTip').hidden), true, 'resizing hides the tooltip');
    await key('End');
    await delay(250);
    await sidebarWidth(420, 'End uses the current viewport maximum');
    win.setContentSize(1600, 980);
    await delay(250);
    await key('End');
    await key('Left', ['shift']);
    await delay(250);
    await sidebarWidth(440, 'keyboard changes persist a preferred expanded width');
    win.setContentSize(785, 980);
    await delay(250);
    await sidebarWidth(305, 'narrow desktop fits the preferred width');
    assert.equal(await run(() => JSON.parse(localStorage.getItem('pd_sidebar_width'))), 440, 'viewport fitting does not overwrite the preference');
    win.setContentSize(768, 980);
    await delay(250);
    assert.equal(await run(() => getComputedStyle(document.querySelector('#sidebarResize')).display === 'none' && document.activeElement !== document.querySelector('#sidebarResize') && document.querySelector('#sidebarTip').hidden), true, 'mobile hides and defocuses the separator');
    await click('#codeMain .open-sb');
    assert.equal(await run(() => document.querySelector('#app').classList.contains('mobile-open')), true, 'mobile menu keeps its overlay behavior');
    await click('#scrim');
    await key('B', [primary]);
    assert.equal(await run(() => document.querySelector('#app').classList.contains('mobile-open')), true, 'mobile shortcut opens the overlay, not desktop collapse');
    await key('B', [primary]);
    assert.equal(await run(() => document.querySelector('#app').classList.contains('mobile-open') || document.querySelector('#app').classList.contains('collapsed')), false);
    win.setContentSize(1600, 980);
    await delay(250);
    await sidebarWidth(440, 'widening restores the unmodified preferred width');
    await sidebarClean();
    await bounded();
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
    const requests = previewRequests;
    await run(() => {
      window.workspaceFrame = document.querySelector('#previewBody iframe');
      window.workspaceInput = document.querySelector('.term-in input');
      window.workspaceComposer = document.querySelector('#codeInput');
      window.workspaceSession = document.querySelector('.cn-s.active').textContent;
      workspaceInput.value = 'unsent command';
      workspaceComposer.value = 'unsent prompt';
    });
    await previewRun(() => { document.querySelector('input').value = 'unsent preview input'; });
    await sidebarRegression();
    assert.equal(await run(() => workspaceFrame === document.querySelector('#previewBody iframe') && workspaceInput === document.querySelector('.term-in input') &&
      workspaceComposer === document.querySelector('#codeInput') && workspaceInput.value === 'unsent command' && workspaceComposer.value === 'unsent prompt' &&
      workspaceSession === document.querySelector('.cn-s.active').textContent), true, 'sidebar actions preserve the session, iframe and pending terminal/composer inputs');
    assert.equal(await previewRun(() => document.querySelector('input').value), 'unsent preview input', 'sidebar actions preserve the iframe document');
    assert.equal(previewRequests, requests, 'sidebar actions must not reload the preview');
    const first = await box('#dockPrimary');
    const diff = await box('#diffCard');
    const filePanel = await box('#filesCard');
    await drag('#columnsResize', 75, 0);
    assert.ok((await box('#dockPrimary')).width > first.width + 40, 'dragging a column divider adjusts panel width');
    await drag('#dockPrimary .row-resize', 0, 100);
    assert.ok((await box('#diffCard')).height > diff.height + 80, 'dragging a row divider adjusts panel height');
    assert.ok(Math.abs((await box('#filesCard')).height - filePanel.height) < 2, 'each column has independent panel heights');
    const secondary = await box('#filesCard');
    await drag('#dockSecondary .row-resize', 0, -70);
    assert.ok((await box('#filesCard')).height < secondary.height - 50);
    const dock = await box('#rightCol');
    // The resized sidebar leaves less room to grow the tools, so shrink first.
    await drag('#workspaceResize', 90, 0);
    assert.ok((await box('#rightCol')).width < dock.width - 50, 'conversation/tools divider adjusts workspace width');
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

    // Shared shortcuts also work before a session exists, in both welcome views.
    await click('#toggleSidebar');
    await sidebarCollapsed(false);
    for (const [mode, input, welcome] of [['code', '#codeInput', '#codeWelcome'], ['chat', '#input', '#welcome']]) {
      await click(`#modeSwitch [data-mode="${mode}"]`);
      await run((s) => { window.welcomeInput = document.querySelector(s); welcomeInput.value = 'pending welcome prompt'; welcomeInput.focus(); }, input);
      assert.equal(await run((s) => !document.querySelector(s).hidden && document.body.dataset.view === 'welcome', welcome), true);
      await key('B', [primary]);
      await sidebarCollapsed(true);
      await key('B', [primary]);
      await sidebarCollapsed(false);
      await sidebarWidth(440, 'welcome shortcut restores the preferred width');
      assert.equal(await run((s) => welcomeInput === document.querySelector(s) && welcomeInput.value === 'pending welcome prompt' && document.activeElement === welcomeInput, input), true, 'welcome shortcut preserves the focused composer');
    }

    // Reload only after all live session/iframe/input identity assertions. Native
    // bootstrap settings must win even if the local collapse fallback disagrees.
    await click('#modeSwitch [data-mode="code"]');
    await key('B', [primary]);
    await sidebarCollapsed(true);
    await run(() => localStorage.setItem('cc_collapsed', 'false'));
    await win.loadFile(path.resolve(__dirname, '../renderer/index.html'));
    await wait(() => document.querySelectorAll('.cn-s').length === 2);
    assert.equal(await run(() => document.querySelector('#app').classList.contains('collapsed')), true, 'synchronous settings bootstrap restores collapse after reload');
    await click('#toggleSidebar');
    await sidebarCollapsed(false);
    await sidebarWidth(440, 'reload retains the last expanded width');
    await run(() => localStorage.setItem('cc_collapsed', 'true'));
    await win.loadFile(path.resolve(__dirname, '../renderer/index.html'));
    await wait(() => document.querySelectorAll('.cn-s').length === 2);
    assert.equal(await run(() => document.querySelector('#app').classList.contains('collapsed')), false, 'expanded native settings also override a stale local fallback');
    await delay(250);
    await sidebarWidth(440, 'expanded reload retains the preferred width');
    await bounded();
    assert.deepEqual(errors, []);
    console.log('PASS: sidebar hover/tooltip, native drag/capture/cleanup, collapse shortcuts, width persistence/mobile, four panels, independent splitters, retained iframe/input, narrow windows, file tree, long current-file targets/paging, explicit diff, request/session races');
    server.close();
    app.exit(0);
  }).catch((err) => { console.error(err); server.close(); app.exit(1); });
}
