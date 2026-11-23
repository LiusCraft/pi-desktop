import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

const MAC = process.platform === 'darwin';
const MOD = MAC ? 'Meta' : 'Control';
const WORK = `${MOD}+Shift+Digit1`;
const CODE = `${MOD}+Shift+Digit2`;
const SESSIONS = `${MOD}+Shift+K`;
const WORK_LABEL = MAC ? '⌘⇧1' : 'Ctrl+Shift+1';
const CODE_LABEL = MAC ? '⌘⇧2' : 'Ctrl+Shift+2';
const QUESTION_PROMPT = 'keyboard shortcut demo';

let app: ElectronApplication | undefined;
let page: Page;
let temporary: string;
const errors: string[] = [];

const composer = () => page.locator('textarea[data-composer-input]');
const tab = (kind: 'Chat' | 'Code', selected: boolean) => page.getByRole('tab', { name: kind, exact: true, selected });
const settingsValue = () => page.evaluate(async () => (await window.piDesktop.invoke('settings:get')).shortcuts);

async function openSettings() {
  const [settings] = await Promise.all([app!.waitForEvent('window'), page.keyboard.press(`${MOD}+,`)]);
  settings.on('pageerror', (error) => errors.push(error.message));
  await settings.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
  await expect(settings.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible();
  return settings;
}

async function dismissPicker() {
  await page.keyboard.press('Escape');
  // Radix leaves the picker mounted while its close animation runs.
  await expect(page.locator('[data-slot=dropdown-menu-content], [data-slot=popover-content]')).toHaveCount(0);
}

async function send(text: string) {
  await composer().fill(text);
  await composer().press('Enter');
  await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
}

async function renameNewest(title: string, merged = false) {
  return page.evaluate(
    async ({ title, merged }) => {
      const [meta] = await window.piDesktop.invoke('sessions:list');
      return window.piDesktop.invoke('sessions:update', meta.id, {
        title,
        ...(merged ? { pr: { num: 42, url: 'https://example.com/demo/pull/42', state: 'merged', draft: false } } : {}),
      });
    },
    { title, merged },
  );
}

async function completedSession(title: string, merged = false) {
  await send(`Hello from ${title}`);
  await expect(page.getByRole('button', { name: 'Rewind to here', exact: true })).toBeEnabled();
  const meta = await renameNewest(title, merged);
  expect(meta.lastResponseAt).toBeGreaterThanOrEqual(meta.createdAt);
}

test.beforeEach(async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-desktop-shortcuts-'));
  errors.length = 0;
  const electronProfile = path.join(temporary, 'electron-profile');
  fs.mkdirSync(electronProfile);
  app = await electron.launch({
    executablePath: createRequire(path.resolve('package.json'))('electron') as string,
    args: [path.resolve('.'), '--demo', '--lang=en-US', `--user-data-dir=${electronProfile}`],
    env: {
      ...process.env,
      PI_DESKTOP_HOME: path.join(temporary, 'data'),
      PI_CODING_AGENT_DIR: path.join(temporary, 'agent'),
      PI_OFFLINE: '1',
    },
  });
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByPlaceholder('Describe a task or ask a question')).toBeVisible();
});

test.afterEach(async ({}, info) => {
  try {
    if (app && info.status !== info.expectedStatus) {
      for (const [index, window] of app.windows().entries()) {
        await info.attach(`window-${index}`, { body: await window.screenshot(), contentType: 'image/png' });
      }
    }
  } finally {
    await app?.close();
    app = undefined;
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test('opens new-session pickers and answers the offline demo with the keyboard', async ({}, info) => {
  await page.keyboard.press(WORK);
  await expect(tab('Chat', true)).toBeVisible();
  await expect(page.getByPlaceholder('How can I help you today?')).toBeVisible();
  await page.keyboard.press(`${MOD}+Alt+L`);
  await expect(page.getByRole('menu')).toContainText('Work in a folder');
  await dismissPicker();

  await page.keyboard.press(CODE);
  await expect(tab('Code', true)).toBeVisible();
  await page.keyboard.press(`${MOD}+N`);
  await page.keyboard.press(`${MOD}+Alt+L`);
  await expect(page.getByRole('menuitem', { name: 'todo-app' })).toBeVisible();
  await dismissPicker();
  const worktree = page.getByRole('checkbox', { name: 'worktree' });
  await expect(worktree).toBeChecked();
  await page.keyboard.press(`${MOD}+Alt+W`);
  await expect(worktree).not.toBeChecked();
  await page.keyboard.press(`${MOD}+Alt+W`);
  await expect(worktree).toBeChecked();
  await expect(page.locator('[data-shortcut=base]')).toBeVisible();
  await page.keyboard.press(`${MOD}+Alt+B`);
  await expect(page.getByPlaceholder('Search branch bases…')).toBeFocused();
  await dismissPicker();
  await page.keyboard.press(`${MOD}+Alt+M`);
  await expect(page.getByPlaceholder('Search models…')).toBeFocused();
  await dismissPicker();
  await page.keyboard.press(`${MOD}+Alt+E`);
  await expect(page.getByRole('slider', { name: 'Thinking effort' })).toBeVisible();
  await dismissPicker();
  await page.keyboard.press(`${MOD}+Alt+P`);
  await expect(page.getByRole('menu')).toContainText('How should actions be approved?');
  await dismissPicker();
  await page.keyboard.press(`${MOD}+Alt+I`);
  await expect(composer()).toBeFocused();

  await send(QUESTION_PROMPT);
  const plain = page.getByRole('radio', { name: /Plain text/ });
  await expect(plain).toBeVisible();
  await composer().fill('Keep draft ');
  await composer().press('2');
  await expect(composer()).toHaveValue('Keep draft 2');
  await expect(plain).toHaveAttribute('aria-checked', 'false');
  await composer().clear();
  await composer().press('2');
  await expect(plain).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Alt+Enter');
  const summary = page.getByRole('checkbox', { name: /Summary \(Recommended\)/ });
  const details = page.getByRole('checkbox', { name: /Details/ });
  await expect(summary).toBeVisible();
  await page.keyboard.press('1');
  await page.keyboard.press('2');
  await expect(summary).toHaveAttribute('aria-checked', 'true');
  await expect(details).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({ path: info.outputPath('question-shortcuts.png') });
  await page.keyboard.press('Alt+Enter');
  await expect(page.getByText('Answered', { exact: true })).toBeVisible();
  await expect(page.getByText(/The user answered:/)).toBeVisible();
  await expect(page.getByText('Summary (Recommended), Details', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('orders the live Work and Code list, searches it, and opens a result by keyboard', async ({}, info) => {
  await completedSession('Older Code');
  await page.keyboard.press(WORK);
  await completedSession('Recent Work');
  await page.keyboard.press(CODE);
  await page.keyboard.press(`${MOD}+N`);
  await completedSession('Merged Code', true);
  await page.keyboard.press(`${MOD}+N`);
  await send(QUESTION_PROMPT);
  await expect(page.getByRole('radio', { name: /Plain text/ })).toBeVisible();
  await renameNewest('Waiting Code');

  await page.keyboard.press(WORK);
  await page.keyboard.press(SESSIONS);
  const dialog = page.getByRole('dialog', { name: 'Session list' });
  const search = dialog.getByPlaceholder('Search sessions…');
  await expect(search).toBeFocused();
  const options = dialog.getByRole('option');
  await expect(options).toHaveCount(4);
  const titles = ['Waiting Code', 'Recent Work', 'Older Code', 'Merged Code'];
  for (const [index, title] of titles.entries()) await expect(options.nth(index)).toContainText(title);
  await expect(dialog.getByText('Needs attention', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Merged', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('session-list.png') });

  await search.fill('code');
  await expect(options).toHaveCount(3);
  await expect(dialog.getByRole('option', { selected: true })).toContainText('Waiting Code');
  await search.press('ArrowDown');
  await expect(dialog.getByRole('option', { selected: true })).toContainText('Older Code');
  await search.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(tab('Code', true)).toBeVisible();
  await expect(page.getByRole('main').getByText('Hello from Older Code', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('records and restores shortcuts in the separate Settings window', async ({}, info) => {
  let settings = await openSettings();
  await settings.getByRole('button', { name: `Switch to Chat: ${WORK_LABEL}`, exact: true }).click();
  await settings.keyboard.press(`${MOD}+K`);
  await expect(settings.getByRole('alert')).toHaveText('Already assigned to: Open command palette');
  await settings.keyboard.press(`${MOD}+Shift+J`);
  const newWorkLabel = MAC ? '⌘⇧J' : 'Ctrl+Shift+J';
  await expect(settings.getByRole('button', { name: `Switch to Chat: ${newWorkLabel}`, exact: true })).toBeEnabled();
  await expect.poll(settingsValue).toEqual({ work: 'Mod+Shift+J' });
  await settings.screenshot({ path: info.outputPath('settings-shortcuts.png') });
  await settings.close();

  await page.keyboard.press(WORK);
  await expect(tab('Code', true)).toBeVisible();
  await page.keyboard.press(`${MOD}+Shift+J`);
  await expect(tab('Chat', true)).toBeVisible();

  settings = await openSettings();
  await expect(settings.getByRole('button', { name: `Switch to Chat: ${newWorkLabel}`, exact: true })).toBeVisible();
  await settings.getByRole('button', { name: 'Restore default: Switch to Chat', exact: true }).click();
  await expect(settings.getByRole('button', { name: `Switch to Chat: ${WORK_LABEL}`, exact: true })).toBeEnabled();
  await settings.getByRole('button', { name: 'Remove shortcut: Switch to Code', exact: true }).click();
  await expect(settings.getByRole('button', { name: 'Switch to Code: Not assigned', exact: true })).toBeEnabled();
  await expect.poll(settingsValue).toEqual({ code: null });
  await settings.close();
  await page.keyboard.press(CODE);
  await expect(tab('Chat', true)).toBeVisible();

  settings = await openSettings();
  await settings.getByRole('button', { name: 'Restore all defaults', exact: true }).click();
  await expect(settings.getByRole('button', { name: `Switch to Code: ${CODE_LABEL}`, exact: true })).toBeEnabled();
  await expect.poll(settingsValue).toEqual({});
  await settings.close();
  await page.keyboard.press(CODE);
  await expect(tab('Code', true)).toBeVisible();
  expect(errors).toEqual([]);
});
