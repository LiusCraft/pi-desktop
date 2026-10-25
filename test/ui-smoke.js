// UI smoke test: launches the real Electron app against the offline demo model,
// drives the main flows over CDP and writes screenshots. Needs `npm i -D playwright`
// and a display (on Linux: xvfb-run -a node test/ui-smoke.js [outDir]).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(require('os').tmpdir(), 'pi-desktop-ui'));
fs.mkdirSync(OUT, { recursive: true });
const HOME = path.join(OUT, 'home');
(async () => {
  fs.rmSync(HOME, { recursive: true, force: true }); fs.mkdirSync(HOME, { recursive: true });
  // Launch Electron ourselves and attach over CDP.
  const launch = async () => {
    const proc = spawn(path.join(ROOT, 'node_modules/electron/dist/electron'), ['--no-sandbox', '--remote-debugging-port=9333', ROOT, '--demo'], {
      cwd: ROOT, env: { ...process.env, HOME }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout.resume(); proc.stderr.on('data', (d) => { const s = String(d); fs.appendFileSync(path.join(OUT, 'el-stderr.log'), s); if (/error|Error/.test(s) && !/dbus|ssl_client|NODE_OPTION/.test(s)) process.stderr.write('[electron] ' + s); });
    let browser;
    for (let i = 0; i < 50 && !browser; i++) { await new Promise((r) => setTimeout(r, 300)); browser = await chromium.connectOverCDP('http://127.0.0.1:9333').catch(() => null); }
    let page;
    for (let i = 0; i < 50 && !page; i++) { page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('file:')); if (!page) await new Promise((r) => setTimeout(r, 200)); }
    return { close: async () => { await browser.close().catch(() => {}); proc.kill(); await new Promise((r) => proc.once('exit', r)); }, page };
  };
  let app = await launch();
  let w = app.page;
  const errs = [];
  const hook = (w) => { w.on('pageerror', (e) => errs.push(e.message)); w.on('console', (m) => m.type() === 'error' && errs.push(m.text())); };
  hook(w);
  
  const shot = (n) => w.screenshot({ path: `${OUT}/x-${n}.png` });
  await w.waitForTimeout(2500);
  await shot('1-welcome');
  // bug fix in auto mode
  await w.fill('#codeInput', '日期显示少了一个月，帮我修一下');
  await w.keyboard.press('Enter');
  await w.waitForSelector('.e-group', { timeout: 30000 });
  await w.waitForTimeout(700);
  await shot('2-running');
  await w.waitForSelector('.e-foot', { timeout: 60000 });
  await w.waitForTimeout(1200);
  await shot('3-done-diff');
  // plan mode
  await w.click('#newSession');
  await w.click('#permBtn'); await w.click('#permMenu [data-v=plan]');
  await w.fill('#codeInput', '添加深色模式');
  await w.keyboard.press('Enter');
  await w.waitForSelector('#bottomBody [data-a]', { timeout: 60000 });
  await w.waitForTimeout(500);
  await shot('4-plan');
  await w.click('#bottomBody [data-a="Approve & auto-accept edits"]');
  await w.waitForSelector('.e-perm:not(.res) .p-btn', { timeout: 60000 });
  await w.waitForTimeout(400);
  await shot('5-perm');
  await w.keyboard.press('1');
  await w.waitForSelector('.e-foot', { timeout: 60000 });
  await w.waitForTimeout(1000);
  await shot('6-feature-done');
  // subagent
  await w.click('#newSession');
  await w.fill('#codeInput', '解释一下项目结构');
  await w.keyboard.press('Enter');
  await w.waitForSelector('.e-foot', { timeout: 60000 });
  await w.click('.e-group .g-sum >> nth=1').catch(() => {});
  await w.click('.g-row:has-text("Agent") .g-rh').catch(() => {});
  await w.waitForTimeout(600);
  await shot('7-agent');
  // terminal
  await w.click('#termBtn'); await w.waitForTimeout(300);
  await w.fill('.term-in input', 'git status --short');
  await w.keyboard.press('Enter');
  await w.waitForTimeout(1500);
  await shot('8-terminal');
  await app.close();
  // restart: sessions restored from pi session files
  app = await launch(); w = app.page; hook(w);
  
  await w.waitForTimeout(2500);
  await w.click('.cn-s:has-text("日期显示")');
  await w.waitForSelector('.e-foot', { timeout: 30000 });
  await w.waitForTimeout(1500);
  await shot('9-restored');
  await app.close();
  console.log('errors:', JSON.stringify(errs));
})().catch((e) => { console.error('FAIL', e.message.split('\n')[0]); process.exit(1); });
