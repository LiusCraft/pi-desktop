// Focused UI regression: real Electron renderer + mock IPC, no model/network credentials.
// Run with `node test/ui-model-menu.js` (does not require Playwright).
const path = require('node:path');

if (!process.versions.electron) {
  const fs = require('node:fs');
  const userData = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'pi-model-menu-ui-'));
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
  const models = Array.from({ length: 80 }, (_, i) => ({
    provider: `provider-${Math.floor(i / 20) + 1}`, id: `model-${i + 1}`,
    name: i % 7 ? `Test model ${i + 1}` : `Long model ${i + 1} Preview Contributor`,
    contextWindow: 1000000, reasoning: true,
  }));
  const replies = {
    'app:info': { version: 'test', demo: false, keyProviders: [] },
    'app:theme': null, 'projects:list': [], 'sessions:list': [], 'cowork:folders': [],
    'models:list': { models, defaultModel: 'provider-4/model-78' },
    'models:levels': ['off', 'high'], 'keys:list': [],
  };
  for (const [channel, reply] of Object.entries(replies)) ipcMain.handle(channel, () => reply);
  let win;
  const run = (fn, ...args) => win.webContents.executeJavaScript(`(${fn})(${args.map((a) => JSON.stringify(a)).join(',')})`);
  const frame = () => run(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const inspect = (id) => run((id) => {
    const menu = document.getElementById(id), box = menu.getBoundingClientRect();
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.top >= box.top && r.bottom <= box.bottom;
    };
    const selectedVisible = visible(menu.querySelector('.active'));
    const scrollable = menu.scrollHeight > menu.clientHeight && getComputedStyle(menu).overflowY === 'auto';
    menu.scrollTop = 0;
    const firstVisible = visible(menu.querySelector('[data-v]'));
    menu.scrollTop = menu.scrollHeight;
    const lastVisible = visible(menu.querySelector('[data-keys]'));
    return {
      top: box.top, bottom: box.bottom,
      safeTop: document.querySelector('.chrome').getBoundingClientRect().bottom + 8,
      triggerTop: menu.parentElement.getBoundingClientRect().top,
      selectedVisible, scrollable, firstVisible, lastVisible,
    };
  }, id);

  app.whenReady().then(async () => {
    win = new BrowserWindow({
      show: false, useContentSize: true, width: 1533, height: 1029,
      webPreferences: { preload: path.resolve(__dirname, '../electron/preload.js'), partition: 'model-menu-test' },
    });
    win.webContents.on('preload-error', (_event, _path, error) => console.error('preload:', error.message));
    win.webContents.on('console-message', ({ level, message }) => { if (level === 'error') console.error('renderer:', message); });
    // Keep test storage in memory and avoid waiting for remote web fonts.
    win.webContents.session.webRequest.onBeforeRequest({ urls: ['https://*/*'] }, (_details, cb) => cb({ cancel: true }));
    await win.loadFile(path.resolve(__dirname, '../renderer/index.html'));
    await run(() => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { clearInterval(timer); reject(new Error('Models did not load')); }, 5000);
      const timer = setInterval(() => {
        if (document.querySelectorAll('#codeModelMenu [data-v]').length !== 80) return;
        clearInterval(timer); clearTimeout(timeout); resolve();
      }, 20);
    }));
    for (const [mode, buttonId, menuId] of [['code', 'codeModelBtn', 'codeModelMenu'], ['chat', 'modelBtn', 'modelMenu']]) {
      await run((mode) => document.querySelector(`#modeSwitch [data-mode="${mode}"]`).click(), mode);
      for (const [width, height] of [[1533, 1029], [900, 600], [1024, 768]]) {
        win.setContentSize(width, height);
        await frame();
        await run((id) => document.getElementById(id).click(), buttonId);
        await frame();
        const result = await inspect(menuId);
        assert.ok(result.top >= result.safeTop - 1, `${mode}: menu overlaps title bar`);
        assert.ok(result.bottom < result.triggerTop, `${mode}: menu overlaps trigger`);
        for (const key of ['selectedVisible', 'scrollable', 'firstVisible', 'lastVisible']) {
          assert.ok(result[key], `${mode} ${width}x${height}: ${key}`);
        }
        // Resize while still open: the height must track the new available space.
        win.setContentSize(width, height - 100);
        await frame();
        const resized = await inspect(menuId);
        assert.ok(resized.top >= resized.safeTop - 1, `${mode}: resized menu overflows`);
        await run((id) => document.getElementById(id).click(), buttonId);
      }
      // Selecting a model still closes the menu and updates the trigger.
      await run((buttonId, menuId) => {
        document.getElementById(buttonId).click();
        document.querySelector(`#${menuId} [data-v]`).click();
      }, buttonId, menuId);
      await frame();
      assert.equal(await run((id) => document.getElementById(id).classList.contains('open'), menuId), false);
      assert.equal(await run((id) => document.getElementById(id).textContent.includes('Long model 1'), buttonId), true);
    }
    console.log('PASS: Code/Cowork model menus, 80 models, 3 window sizes, live resize and selection');
    app.exit(0);
  }).catch((err) => { console.error(err); app.exit(1); });
}
