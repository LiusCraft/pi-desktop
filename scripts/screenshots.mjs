// Regenerates docs/screenshots/*.png from the offline demo (run `npm run build` first).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { _electron as electron } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'docs', 'screenshots');
const tmp = fs.mkdtempSync(path.join(path.parse(root).root, 'pi-shots-')); // short, neutral path: the Work panel shows it;
fs.mkdirSync(path.join(tmp, 'profile'), { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

const app = await electron.launch({
  executablePath: createRequire(path.join(root, 'package.json'))('electron'),
  args: [root, '--demo', `--user-data-dir=${path.join(tmp, 'profile')}`],
  env: {
    ...process.env,
    PI_DESKTOP_HOME: path.join(tmp, 'data'),
    PI_CODING_AGENT_DIR: path.join(tmp, 'agent'),
    PI_OFFLINE: '1',
  },
});
try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 });
  const input = page.getByPlaceholder('Describe a task or ask a question');
  await input.waitFor();
  await page.waitForTimeout(800);
  await input.fill('日期显示少了一个月，帮我修一下');
  await input.press('Enter');
  await page.getByText('测试全部通过').first().waitFor({ timeout: 60_000 });
  await page.keyboard.press('Control+D');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, 'code.png') });

  // More sessions in different states: the sidebar list shows who is done, running or waiting for approval.
  await page.keyboard.press('Control+D');
  const side = page.locator('aside');
  const startCode = async (text) => {
    await side.getByText('New', { exact: true }).click();
    await input.fill(text);
    await input.press('Enter');
  };
  await startCode('添加深色主题功能');
  await page
    .getByText('深色')
    .nth(2)
    .waitFor({ timeout: 60_000 })
    .catch(() => {});
  await page.waitForTimeout(8000);
  await startCode('提交并推送，开一个 PR');
  await page.getByText('Allow Pi Desktop').first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);

  // Code's new-session page lists what needs a reply and the open PRs. PR state comes from `gh`, which the demo
  // does not have, so record it on the sessions the way a created PR is.
  const list = await page.evaluate(() => window.piDesktop.invoke('sessions:list'));
  const byTitle = (t) => list.find((x) => x.title === t).id;
  const pr = (num, draft) => ({ num, url: `https://github.com/acme/todo-app/pull/${num}`, state: 'open', draft });
  // Archiving stops the PR watcher, which would otherwise answer "no PR" (there is no gh) and hide what we record.
  const withPr = [
    { id: byTitle('日期显示少了一个月，帮我修一下'), pr: pr(12, false) },
    { id: byTitle('添加深色主题功能'), pr: pr(13, true) },
  ];
  await page.evaluate(async (items) => {
    const call = (...args) => window.piDesktop.invoke(...args);
    for (const x of items) {
      await call('sessions:archive', x.id);
      await call('sessions:update', x.id, { pr: x.pr });
      await call('sessions:unarchive', x.id);
    }
  }, withPr);
  await page.reload();
  await side.getByText('New', { exact: true }).click();
  await page.getByPlaceholder('Describe a task or ask a question').waitFor();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, 'new-session.png') });
  await side.getByText('Work', { exact: true }).first().click();

  await page.locator('aside').getByText('Work', { exact: true }).first().click();
  await page.locator('aside').getByText('New', { exact: true }).click();
  const workInput = page.locator('textarea, [contenteditable=true]').last();
  await workInput.fill('帮我整理一下收件箱');
  await workInput.press('Enter');
  await page.waitForTimeout(6000);
  await page.screenshot({ path: path.join(outDir, 'work.png') });
} finally {
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
