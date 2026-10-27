// Managing sessions and projects in the real window: start, archive, restore, delete, remove a project.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

let app: ElectronApplication;
let page: Page;
let temporary: string;
let dataDir: string;

test.beforeEach(async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-desktop-sessions-'));
  dataDir = path.join(temporary, 'data');
  const electronProfile = path.join(temporary, 'electron-profile');
  fs.mkdirSync(electronProfile, { recursive: true });
  app = await electron.launch({
    executablePath: createRequire(path.resolve('package.json'))('electron') as string,
    args: [path.resolve('.'), '--demo', '--lang=en-US', `--user-data-dir=${electronProfile}`],
    env: { ...process.env, PI_DESKTOP_HOME: dataDir, PI_CODING_AGENT_DIR: path.join(temporary, 'agent'), PI_OFFLINE: '1' },
  });
  await expect.poll(() => fs.existsSync(path.join(dataDir, 'demo', 'todo-app'))).toBe(true);
  page = await app.firstWindow();
  await expect(page.getByPlaceholder('Describe a task or ask a question')).toBeVisible();
});

test.afterEach(async ({}, testInfo) => {
  if (page && testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach('window', { body: await page.screenshot(), contentType: 'image/png' });
  }
  await app?.close();
  fs.rmSync(temporary, { recursive: true, force: true });
});

const sidebar = () => page.locator('aside');
const row = (title: string) => sidebar().locator('div.group', { has: page.getByRole('button', { name: title, exact: true }) });

/** Start a session from the welcome screen; resolves once the conversation is showing. */
async function startSession(text: string) {
  const input = page.getByPlaceholder('Describe a task or ask a question');
  await input.fill(text);
  await input.press('Enter');
  // The conversation opens at once: the message is there before the agent has even started.
  await expect(page.getByText(text).first()).toBeVisible();
}

test('a new session opens straight away, before its agent and worktree are ready', async () => {
  const input = page.getByPlaceholder('Describe a task or ask a question');
  await input.fill('日期显示少了一个月，帮我修一下');
  await input.press('Enter');
  await expect(page.getByText('日期显示少了一个月，帮我修一下').first()).toBeVisible({ timeout: 3_000 });
  await expect(page.getByText('测试全部通过').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Starting the session…')).toHaveCount(0);
});

test('archive hides a session, the Archived page restores or deletes it', async () => {
  await startSession('hello');
  const title = 'hello';
  await expect(row(title)).toBeVisible();

  await row(title).hover();
  await row(title).getByRole('button', { name: 'Session actions' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(row(title)).toHaveCount(0);

  await sidebar().getByRole('button', { name: 'More' }).click();
  await sidebar().getByRole('button', { name: 'Archived sessions' }).click();
  const archived = page.getByText(title, { exact: true });
  await expect(archived.first()).toBeVisible();

  await page.getByRole('button', { name: 'Unarchive' }).click();
  await expect(page.getByText('No archived sessions')).toBeVisible();
  await expect(row(title)).toBeVisible();

  // Delete from the sidebar: asks first, then the session and its worktree are gone.
  await row(title).hover();
  await row(title).getByRole('button', { name: 'Session actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('worktree');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(row(title)).toHaveCount(0);
  const worktrees = path.join(dataDir, '.worktree');
  await expect.poll(() => (fs.existsSync(worktrees) ? fs.readdirSync(worktrees).length : 0)).toBe(0);
});

test('removing a project archives its sessions and leaves the folder alone', async () => {
  await startSession('hello');
  const project = path.join(dataDir, 'demo', 'todo-app');
  const header = sidebar().getByTitle(project, { exact: true });
  await header.hover();
  await header.getByRole('button', { name: 'Project actions' }).click();
  await page.getByRole('menuitem', { name: 'Remove from Pi Desktop' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Archive');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
  await expect(sidebar().getByTitle(project)).toHaveCount(0);
  expect(fs.existsSync(path.join(project, 'package.json'))).toBe(true);

  await sidebar().getByRole('button', { name: 'More' }).click();
  await sidebar().getByRole('button', { name: 'Archived sessions' }).click();
  await expect(page.getByRole('button', { name: 'Unarchive' })).toHaveCount(1);
});

test('each session keeps its own workspace: no surprise Diff, layout restored on return', async () => {
  const diff = page.getByTestId('diff');
  const changedFiles = page.getByRole('navigation', { name: 'Changed files' });
  const mod = (key: string) => page.keyboard.press(process.platform === 'darwin' ? `Meta+${key}` : `Control+${key}`);

  await startSession('日期显示少了一个月，帮我修一下');
  // A change arriving must not open the Diff panel by itself.
  await expect(page.getByRole('button', { name: 'Rewind to here' }).first()).toBeEnabled({ timeout: 60_000 });
  await expect(diff).toHaveCount(0);

  await mod('d');
  await expect(diff).toHaveCount(1);
  await expect(changedFiles).toBeVisible({ timeout: 30_000 });
  const first = await page.evaluate(async () => (await window.piDesktop.invoke('sessions:list'))[0].title);

  // A second session starts with a clean workspace …
  await mod('n');
  await startSession('hello');
  await expect(diff).toHaveCount(0);

  // … and the first one comes back the way it was left.
  await row(first).click();
  await expect(diff).toHaveCount(1);
  await expect(changedFiles).toBeVisible();
});
