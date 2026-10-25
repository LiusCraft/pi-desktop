// Cowork UI smoke test (real Electron + offline demo model). Needs `npm i -D playwright`
// and a display (on Linux: xvfb-run -a node test/ui-cowork.js [outDir]).
const { chromium } = require('playwright'); const { spawn } = require('child_process'); const path = require('path'), fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(require('os').tmpdir(), 'pi-desktop-ui-cowork'));
fs.mkdirSync(OUT, { recursive: true });
const HOME = path.join(OUT, 'home');
const launch = async () => {
  const proc = spawn(path.join(ROOT, 'node_modules/electron/dist/electron'), ['--no-sandbox', '--remote-debugging-port=9336', ROOT, '--demo'], { cwd: ROOT, env: { ...process.env, HOME }, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.resume(); proc.stderr.resume();
  let b; for (let i = 0; i < 60 && !b; i++) { await new Promise(r => setTimeout(r, 300)); b = await chromium.connectOverCDP('http://127.0.0.1:9336').catch(() => null); }
  let w; for (let i = 0; i < 60 && !w; i++) { w = b.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('file:')); if (!w) await new Promise(r => setTimeout(r, 200)); }
  return { w, close: async () => { await b.close().catch(() => {}); proc.kill(); await new Promise(r => proc.once('exit', r)); } };
};
(async () => {
  fs.rmSync(HOME, { recursive: true, force: true }); fs.mkdirSync(HOME, { recursive: true });
  let { w, close } = await launch();
  const errs = []; const hook = (w) => { w.on('pageerror', e => errs.push(e.message)); w.on('console', m => m.type() === 'error' && !/ERR_CERT/.test(m.text()) && errs.push(m.text())); }; hook(w);
  global.__w = w;
  const shot = (n) => w.screenshot({ path: `${OUT}/c-${n}.png` });
  await w.waitForTimeout(2500);
  await w.click('#modeSwitch [data-mode=chat]'); await w.waitForTimeout(500);
  await shot('1-welcome');
  await w.click('#folderBtn'); await w.waitForTimeout(300); await shot('2-folder-menu'); await w.keyboard.press('Escape'); await w.click('#welcome h1');
  await w.click('.chip.idea >> nth=1');
  await w.click('#sendBtn');
  await w.waitForSelector('.e-perm:not(.res) .p-btn', { timeout: 60000 });
  await w.waitForTimeout(500);
  await shot('3-perm');
  await w.keyboard.press('1');
  await w.waitForSelector('.e-foot', { timeout: 60000 });
  await w.waitForTimeout(1200);
  await shot('4-done');
  await w.click('.cwp-file >> nth=0'); await w.waitForTimeout(800);
  await shot('5-file');
  // second task: briefing in a temporary workspace
  await w.click('#newChat'); await w.click('#folderBtn'); await w.click('#folderMenu [data-none]');
  await w.click('.chip.idea >> nth=0'); await w.click('#sendBtn');
  await w.waitForSelector('.e-foot', { timeout: 60000 }); await w.waitForTimeout(800);
  await shot('6-scratch');
  // switch modes and back
  await w.click('#modeSwitch [data-mode=code]'); await w.waitForTimeout(400); await shot('7-code');
  await w.click('#modeSwitch [data-mode=chat]'); await w.waitForTimeout(600); await shot('8-back');
  await close();
  ({ w, close } = await launch()); hook(w); global.__w = w;
  await w.waitForTimeout(2500);
  await w.click('#modeSwitch [data-mode=chat]').catch(() => {});
  await w.click('#recents li:has-text("整理收件箱")');
  await w.waitForSelector('.e-foot', { timeout: 30000 }); await w.waitForTimeout(1200);
  await shot('9-restored');
  await close();
  const ws = path.join(HOME, '.config', 'Pi Desktop', 'demo', 'cowork-workspace');
  console.log('files:', fs.readdirSync(ws).join(', '), '| archived:', fs.readdirSync(path.join(ws, 'inbox', '已归档')).join(', '));
  console.log('errors:', JSON.stringify(errs));
})().catch(async e => { console.error('FAIL', e.message.split('\n')[0]); try { await global.__w?.screenshot({ path: `${OUT}/c-fail.png` }); } catch {} process.exit(1); });
