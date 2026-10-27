import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

let app: ElectronApplication;
let page: Page;
let temporary: string;
let previousClipboard: string | undefined;
const errors: string[] = [];

test.beforeEach(async () => {
  previousClipboard = undefined;
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-desktop-ui-'));
  const dataDir = path.join(temporary, 'data');
  // Electron's own Chromium profile is isolated for tests only; the app's data is PI_DESKTOP_HOME.
  const electronProfile = path.join(temporary, 'electron-profile');
  fs.mkdirSync(electronProfile, { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'cache'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'cache', 'models-dev.json'), JSON.stringify({ fetchedAt: Date.now(), providers: { openai: [
    { id: 'editable-model', context: 200000, output: 32000, cost: { input: 5, output: 10 } },
    { id: 'gpt-image-1', context: 0, output: 0 },
  ] } }));
  app = await electron.launch({
    executablePath: createRequire(path.resolve('package.json'))('electron') as string,
    args: [path.resolve('.'), '--demo', `--user-data-dir=${electronProfile}`],
    env: { ...process.env, PI_DESKTOP_HOME: dataDir, PI_CODING_AGENT_DIR: path.join(temporary, 'agent'), PI_OFFLINE: '1' },
  });
  const actualUserData = await app.evaluate(({ app: application }) => application.getPath('userData'));
  expect(fs.realpathSync(actualUserData)).toBe(fs.realpathSync(electronProfile));
  // App data lives in PI_DESKTOP_HOME; Electron's Chromium profile is only for the browser internals.
  await expect.poll(() => fs.existsSync(path.join(dataDir, 'demo', 'todo-app'))).toBe(true);
  previousClipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
  errors.length = 0;
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByPlaceholder('Describe a task or ask a question')).toBeVisible();
});

test.afterEach(async ({}, testInfo) => {
  if (page && testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach('window', { body: await page.screenshot(), contentType: 'image/png' });
  }
  if (app) {
    if (previousClipboard !== undefined) await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), previousClipboard);
    await app.close();
  }
  fs.rmSync(temporary, { recursive: true, force: true });
});

async function selectCode(locator: ReturnType<Page['locator']>) {
  await locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await locator.dispatchEvent('mouseup');
}

test('file menus, preview excerpts, diff comments, send, fork and rewind', async () => {
  await page.getByPlaceholder('Describe a task or ask a question').fill('日期显示少了一个月，帮我修一下');
  await page.getByPlaceholder('Describe a task or ask a question').press('Enter');
  await expect(page.getByRole('button', { name: '回退到这里', exact: true })).toBeEnabled({ timeout: 45_000 });
  const sourceId = await page.evaluate(async () => (await window.piDesktop.invoke('sessions:list'))[0].id);

  await page.getByTitle('Files', { exact: true }).click();
  const files = page.getByTestId('files');
  const src = files.locator('button[title="src"]');
  await expect(src).toBeVisible();
  await src.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Attach as context', exact: true }).click();
  await expect(page.getByLabel('附加的上下文和评论')).toContainText('src/');
  await src.click();
  await files.locator('button[title="src/utils"]').click();
  const date = files.locator('button[title="src/utils/date.js"]');
  await date.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'Relative path', exact: true }).click();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('src/utils/date.js');
  await date.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open in', exact: true }).hover();
  await expect(page.getByRole('menuitem', { name: 'Terminal', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await date.click();

  const viewer = page.getByTestId('detail');
  const line = viewer.locator('[data-source-line="2"] [data-code-text]');
  await selectCode(line);
  await page.getByRole('button', { name: '附加为上下文', exact: true }).click();
  await expect(page.getByLabel('附加的上下文和评论')).toContainText('Excerpt');
  await viewer.getByRole('button', { name: '评论第 3 行', exact: true }).click();
  await page.getByLabel('选区评论').fill('Preview review comment');
  await page.getByRole('button', { name: '添加到输入框', exact: true }).click();
  await expect(page.getByLabel('附加的上下文和评论')).toContainText('Preview review comment');
  await viewer.getByRole('button', { name: '评论第 2 行', exact: true }).click();
  await viewer.getByRole('button', { name: '评论第 4 行', exact: true }).click({ modifiers: ['Shift'] });
  await viewer.getByRole('button', { name: '评论第 1 行', exact: true }).click({ modifiers: ['Shift'] });
  await expect(viewer.getByTitle('src/utils/date.js:1–2', { exact: true })).toBeVisible();
  await viewer.getByRole('button', { name: '附加为上下文', exact: true }).click();

  await viewer.getByTitle('Close', { exact: true }).click();
  // Panels stay closed until the user asks for them (Ctrl/Cmd+D or the header button).
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+d' : 'Control+d');
  const diff = page.locator('section[data-path="src/utils/date.js"]');
  await expect(diff).toBeVisible();
  await diff.locator('.code-row.del [data-select-line]').first().click();
  await page.getByLabel('选区评论').fill('Diff review comment');
  await page.getByRole('button', { name: '添加到输入框', exact: true }).click();
  await expect(page.getByLabel('附加的上下文和评论')).toContainText('before change');
  const changedFiles = page.getByRole('navigation', { name: 'Changed files' });
  await changedFiles.getByTitle('src/utils/date.js', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Attach as context', exact: true }).click();
  await changedFiles.getByTitle('src/utils', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Attach as context', exact: true }).click();
  await expect(page.getByLabel('附加的上下文和评论')).toContainText('src/utils/');

  await page.getByTitle('Send (↵)', { exact: true }).click();
  await expect(page.getByRole('button', { name: '回退到这里', exact: true })).toHaveCount(2);
  await expect(page.getByRole('button', { name: '回退到这里', exact: true }).last()).toBeEnabled();
  const sent = await page.evaluate(async (id) => {
    const opened = await window.piDesktop.invoke('sessions:open', id);
    return opened.messages.filter((message) => message.role === 'user').at(-1)?.content;
  }, sourceId);
  expect(JSON.stringify(sent)).toContain('Attached context:');
  expect(JSON.stringify(sent)).toContain('Preview review comment');
  expect(JSON.stringify(sent)).toContain('Diff review comment');
  await expect(page.getByLabel('附加的上下文和评论')).toHaveCount(0);

  await page.getByRole('button', { name: '从这里创建分支', exact: true }).last().click();
  await expect(page.getByPlaceholder('Type / for commands')).toHaveValue(/Attached context:/);
  const sessions = await page.evaluate(() => window.piDesktop.invoke('sessions:list'));
  const branch = sessions.find((session) => session.id !== sourceId && session.title.endsWith('· 分支'));
  expect(branch).toBeDefined();
  const original = await page.evaluate((id) => window.piDesktop.invoke('sessions:open', id), sourceId);
  expect(original.messages.filter((message) => message.role === 'user')).toHaveLength(2);

  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows()[0].webContents.send('session:focus', id), sourceId);
  await expect(page.getByRole('button', { name: '回退到这里', exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: '回退到这里', exact: true }).last().click();
  await expect(page.getByRole('button', { name: '回退到这里', exact: true })).toHaveCount(1);
  const rewound = await page.evaluate((id) => window.piDesktop.invoke('sessions:open', id), sourceId);
  expect(rewound.messages.filter((message) => message.role === 'user')).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('edits model context and free prices without catalog replacement', async () => {
  const settingsWindow = app.waitForEvent('window');
  await page.evaluate(async () => {
    await window.piDesktop.invoke('models:endpointSave', {
      id: 'test-editable', baseUrl: 'http://localhost:11434/v1', api: 'openai-completions',
      models: [{ id: 'editable-model' }, { id: 'gpt-image-1' }],
    });
    await window.piDesktop.invoke('settings:open', 'models');
  });
  const settings = await settingsWindow;
  settings.on('pageerror', (error) => errors.push(error.message));
  await expect(settings.getByRole('heading', { name: '模型管理', exact: true })).toBeVisible();
  await settings.getByRole('button', { name: '编辑', exact: true }).click();
  await settings.getByRole('button', { name: '编辑模型 editable-model', exact: true }).click();
  const context = settings.getByLabel('上下文大小（tokens）', { exact: true });
  await context.fill('0');
  await settings.getByRole('button', { name: '应用修改', exact: true }).click();
  expect(await context.evaluate((element: HTMLInputElement) => element.validity.valid)).toBe(false);
  await context.fill('64000');
  await settings.getByLabel('最大输出（tokens）', { exact: true }).fill('4000');
  await settings.getByLabel('输入价格', { exact: true }).fill('0');
  await settings.getByLabel('输出价格', { exact: true }).fill('0.25');
  await settings.getByRole('button', { name: '应用修改', exact: true }).click();
  await settings.getByRole('button', { name: '保存', exact: true }).click();
  await expect(settings.getByRole('dialog')).toHaveCount(0);
  await settings.getByRole('button', { name: '编辑', exact: true }).click();
  await settings.getByRole('button', { name: '编辑模型 editable-model', exact: true }).click();
  await expect(settings.getByLabel('上下文大小（tokens）', { exact: true })).toHaveValue('64000');
  await expect(settings.getByLabel('输入价格', { exact: true })).toHaveValue('0');
  await settings.getByRole('button', { name: '取消修改', exact: true }).click();
  await settings.getByPlaceholder('手动添加模型 ID').fill('my-private-model');
  await settings.getByRole('button', { name: '添加', exact: true }).click();
  await settings.getByLabel('上下文大小（tokens）', { exact: true }).fill('128000');
  await settings.getByLabel('最大输出（tokens）', { exact: true }).fill('16000');
  await settings.getByLabel('输入价格', { exact: true }).fill('0');
  await settings.getByLabel('输出价格', { exact: true }).fill('0');
  await settings.getByRole('button', { name: '应用修改', exact: true }).click();
  await settings.getByRole('button', { name: '保存', exact: true }).click();
  await expect(settings.getByRole('dialog')).toHaveCount(0);
  const catalog = await settings.evaluate(() => window.piDesktop.invoke('models:catalog'));
  expect(catalog.errors).toEqual([]);
  expect(catalog.endpoints[0].models[0].cost).toMatchObject({ input: 0, output: 0.25 });
  expect(catalog.endpoints[0].models.find((model) => model.id === 'my-private-model')).toMatchObject({ contextWindow: 128000, maxTokens: 16000, cost: { input: 0, output: 0 } });
  expect(errors).toEqual([]);
});

test('customize page: create a skill, switch it off, add and remove a connector', async () => {
  await page.getByRole('button', { name: 'Customize', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Skills', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '新建技能', exact: true }).click();
  await page.getByPlaceholder('release-notes').fill('release-notes');
  await page.getByPlaceholder(/Write release notes/).fill('Write release notes from merged PRs');
  await page.getByPlaceholder(/List merged PRs/).fill('# Release notes\n\nList the merged PRs.');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  const row = page.locator('div', { hasText: /^release-notes/ }).filter({ has: page.getByRole('switch') }).last();
  await expect(row).toBeVisible();
  await page.screenshot({ path: process.env.CUSTOMIZE_SHOT ?? path.join(temporary, 'customize.png') });
  await page.getByRole('switch', { name: '停用 release-notes' }).click();
  await expect(page.getByRole('switch', { name: '启用 release-notes' })).toBeVisible();

  await page.getByRole('tab', { name: /^Connectors/ }).click();
  await page.getByRole('button', { name: '添加连接器', exact: true }).click();
  await page.getByPlaceholder('filesystem', { exact: true }).fill('docs');
  await page.getByRole('radio', { name: '远程地址', exact: true }).click();
  await page.getByPlaceholder('https://example.com/mcp').fill('https://example.com/mcp');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('https://example.com/mcp')).toBeVisible();
  await page.getByRole('switch', { name: '停用' }).click();
  await expect(page.getByRole('switch', { name: '启用' })).toBeVisible();
  await page.getByText('docs', { exact: true }).click();
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.getByText('还没有连接器')).toBeVisible();

  await page.getByRole('tab', { name: /^Plugins/ }).click();
  await expect(page.getByText('还没有安装插件')).toBeVisible();
  await page.getByRole('tab', { name: /^Subagents/ }).click();
  await expect(page.getByText('explore', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('scheduled tasks: pick a one-off date and time, then run it now', async () => {
  await page.getByRole('button', { name: 'Scheduled', exact: true }).click();
  await expect(page.getByText('还没有定时任务')).toBeVisible();
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.getByPlaceholder('每日代码审查').fill('nightly');
  await page.getByRole('textbox', { name: /指令/ }).fill('say hi from the schedule');

  await page.getByRole('combobox', { name: /运行时间/ }).click();
  await page.getByRole('option', { name: '只运行一次' }).click();
  await page.getByRole('button', { name: /\d{4}\/\d+\/\d+|\d+\/\d+\/\d{4}|\d{4}-\d+-\d+/ }).click();
  await expect(page.getByRole('grid')).toBeVisible();
  await page.waitForTimeout(400); // let the popover finish fading in
  await page.screenshot({ path: process.env.SCHEDULE_SHOT ?? path.join(temporary, 'schedule-calendar.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('combobox', { name: '分钟' }).click();
  await page.getByRole('option', { name: '07', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();

  await expect(page.getByText('nightly')).toBeVisible();
  await page.getByText('nightly').click();
  await page.getByRole('button', { name: '立即运行', exact: true }).click();
  await expect(page.getByText('say hi from the schedule').first()).toBeVisible();
  expect(errors).toEqual([]);
});
