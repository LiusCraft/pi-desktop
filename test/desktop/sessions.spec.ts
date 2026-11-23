// Managing sessions and projects in the real window: start, archive, restore, delete, remove a project.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';
import { PALETTES } from '../../src/shared/protocol';

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
    env: {
      ...process.env,
      PI_DESKTOP_HOME: dataDir,
      PI_CODING_AGENT_DIR: path.join(temporary, 'agent'),
      PI_OFFLINE: '1',
    },
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
  removeTemporary(temporary);
});

/**
 * Delete a test's temp folder. Windows can still hold a handle on the app's profile just after it closed (EPERM),
 * so retry; a leftover temp folder must never turn the test body's result into a failure.
 */
function removeTemporary(dir: string) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
  }
}

async function addWorkspaceTab(name: string) {
  await page.getByRole('button', { name: 'New workspace tab' }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

const sidebar = () => page.locator('aside');
const row = (title: string) =>
  sidebar().locator('div.group', { has: page.getByRole('button', { name: title, exact: true }) });

/** Start a session from the welcome screen; resolves once the conversation is showing. */
async function startSession(text: string) {
  const input = page.getByPlaceholder('Describe a task or ask a question');
  await input.fill(text);
  await input.press('Enter');
  // The conversation opens at once: the message is there before the agent has even started.
  await expect(page.getByText(text).first()).toBeVisible();
}

test('workspace boundaries stay clear without elevation in populated layouts', async ({}, testInfo) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1800, 1100));
  await startSession('添加深色模式');
  await expect(page.getByRole('button', { name: 'Rewind to here', exact: true })).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Files', exact: true })).toHaveCount(0);
  await addWorkspaceTab('Files');
  const workspace = page.locator('[data-slot="workspace"]');
  const dock = workspace.getByRole('tablist', { name: 'Panels' });
  const files = workspace.locator('[data-tab="files"]');
  const diff = workspace.locator('[data-tab="diff"]');
  const terminal = workspace.locator('[data-tab="terminal"]');

  await files.locator('[data-item-path="src/"]').click();
  await files.locator('[data-item-path="src/App.jsx"]').dblclick();
  await files.locator('[data-item-path="src/styles.css"]').click();
  await expect(files.getByRole('tab')).toHaveCount(2);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+d' : 'Control+d');
  await expect(files).toBeHidden();
  await expect(diff.locator('[data-line-type="change-addition"]').first()).toBeVisible();
  await expect(diff.locator('[data-overflow="scroll"]').first()).toBeVisible();
  await addWorkspaceTab('Terminal');
  await expect(terminal.locator('.xterm-screen')).toBeVisible();
  await expect(dock.getByRole('tab')).toHaveCount(3);
  await expect(workspace.getByRole('tabpanel')).toHaveCount(1);
  await expect(diff).toBeHidden();
  await addWorkspaceTab('Files');
  await expect(dock.getByRole('tab')).toHaveCount(3);
  await expect(files.getByRole('tab')).toHaveCount(2);
  const branch = page.getByRole('region', { name: 'Branch status' });
  await expect(branch).toBeVisible();
  await expect(branch.getByRole('button', { name: 'Commit', exact: true })).toBeVisible();

  const expectFlatSurfaces = async (view: Page) => {
    const surfaces = view.locator('.surface-flat');
    expect(await surfaces.count()).toBeGreaterThan(0);
    for (const surface of await surfaces.all()) {
      for (const side of ['top', 'right', 'bottom', 'left']) {
        // Chromium snaps 1px edges to fractional CSS pixels at some display scales.
        expect(
          await surface.evaluate(
            (element, edge) => parseFloat(getComputedStyle(element).getPropertyValue(`border-${edge}-width`)),
            side,
          ),
        ).toBeGreaterThan(0);
      }
      expect(
        await surface.evaluate((element) => getComputedStyle(element).getPropertyValue('--tw-shadow').trim()),
      ).toBe('0 0 #0000');
    }
  };

  for (const palette of PALETTES) {
    for (const theme of ['light', 'dark'] as const) {
      await test.step(`${palette} / ${theme}`, async () => {
        await page.evaluate((patch) => window.piDesktop.invoke('settings:set', patch), { palette, theme });
        await expect(page.locator('html')).toHaveAttribute('data-palette', palette);
        await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
        await expectFlatSurfaces(page);
        const strip = workspace.locator(':scope > .panel-tabs');
        expect(
          await strip.evaluate((element) => parseFloat(getComputedStyle(element).borderBottomWidth)),
        ).toBeGreaterThan(0);
        expect(await strip.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
          await workspace.evaluate((element) => getComputedStyle(element).backgroundColor),
        );
        expect(await workspace.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toMatch(/rgba/);
        const activePanelTab = dock.getByRole('tab', { selected: true }).locator('..');
        const inactivePanelTab = dock.getByRole('tab', { selected: false }).first().locator('..');
        expect(await activePanelTab.evaluate((element) => getComputedStyle(element).borderBottomColor)).not.toBe(
          await inactivePanelTab.evaluate((element) => getComputedStyle(element).borderBottomColor),
        );
        for (const tab of await files.getByRole('tab').all()) {
          await expect(tab).toHaveCSS('border-right-width', '0px');
        }
        const active = files.getByRole('tab', { selected: true });
        const inactive = files.getByRole('tab', { selected: false });
        expect(await active.evaluate((element) => getComputedStyle(element).borderBottomColor)).not.toBe(
          await inactive.evaluate((element) => getComputedStyle(element).borderBottomColor),
        );
        const tree = files.getByRole('navigation', { name: 'Project files' });
        const treeSearch = tree.locator('[data-file-tree-search-input]');
        const searchBox = await treeSearch.boundingBox();
        const treeBox = await tree.boundingBox();
        expect(searchBox!.x).toBeGreaterThanOrEqual(treeBox!.x);
        expect(searchBox!.x + searchBox!.width).toBeLessThanOrEqual(treeBox!.x + treeBox!.width);
        await page.screenshot({ path: testInfo.outputPath(`${palette}-${theme}.png`) });
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1000));
        await expect(dock.getByRole('tab', { name: 'Files', selected: true })).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`${palette}-${theme}-narrow.png`) });
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1800, 1100));
        const original = (await workspace.boundingBox())!.width;
        await workspace.getByRole('button', { name: 'Expand workspace' }).click();
        await expect.poll(async () => (await workspace.boundingBox())!.width).toBeGreaterThan(original);
        await expectFlatSurfaces(page);
        await dock.getByRole('tab', { name: 'Terminal' }).click();
        await expect(terminal.locator('.xterm-screen')).toBeVisible();
        await dock.getByRole('tab', { name: 'Files' }).click();
        await expect(files.getByRole('tab')).toHaveCount(2);
        await workspace.getByRole('button', { name: 'Restore workspace' }).click();
        await expect(dock.getByRole('tab')).toHaveCount(3);
      });
    }
  }

  // Flattening the composer must not remove its file-drag ring.
  const input = page.locator('textarea[data-composer-input]');
  const composer = page.locator('.surface-flat').filter({ has: input });
  const beforeDrag = await composer.evaluate((element) => getComputedStyle(element).boxShadow);
  await input.evaluate((element) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(['context'], 'context.txt', { type: 'text/plain' }));
    element.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
  });
  await expect(composer).toHaveClass(/ring-2/);
  await expect(composer).not.toHaveCSS('box-shadow', beforeDrag);
  await input.dispatchEvent('dragleave');
  await expect(composer).not.toHaveClass(/ring-2/);

  // Search controls keep their own borders and keyboard focus; they are not content surfaces.
  await files.getByRole('button', { name: /Find in files/ }).click();
  const search = files.getByRole('search');
  const field = search.getByRole('textbox');
  expect(await search.evaluate((element) => parseFloat(getComputedStyle(element).borderBottomWidth))).toBeGreaterThan(
    0,
  );
  await expect(field).toBeFocused();
  // Chromium can snap a 1px border to a fractional CSS pixel at the host's display scale.
  expect(await field.evaluate((element) => parseFloat(getComputedStyle(element).borderTopWidth))).toBeGreaterThan(0);
  await search.getByRole('button', { name: 'Close search' }).click();
  await files.getByRole('button', { name: 'Panel options' }).click();
  await page.getByRole('menuitem', { name: 'Flat list', exact: true }).click();
  await dock.getByRole('tab', { name: 'Changes' }).click();
  await diff.getByRole('button', { name: 'Panel options' }).click();
  await page.getByRole('menuitem', { name: 'Collapse all', exact: true }).click();
  await expect(diff.locator('[data-line-type="change-addition"]')).toHaveCount(0);
  await diff.getByRole('button', { name: 'Panel options' }).click();
  await page.getByRole('menuitem', { name: 'Expand all', exact: true }).click();
  await expect(diff.locator('[data-line-type="change-addition"]').first()).toBeVisible();

  await dock.getByRole('button', { name: 'Close Terminal' }).click();
  await expect(dock.getByRole('tab', { name: 'Changes', selected: true })).toBeVisible();
  await dock.getByRole('tab', { name: 'Changes' }).press('Delete');
  await expect(dock.getByRole('tab', { name: 'Files', selected: true })).toBeFocused();
  await dock.getByRole('button', { name: 'Close Files' }).click();
  await expect(workspace).toHaveCount(0);
  await addWorkspaceTab('Files');
  await expect(dock.getByRole('tab', { name: 'Files', selected: true })).toBeVisible();

  const settingsWindow = app.waitForEvent('window');
  await page.evaluate(() => window.piDesktop.invoke('settings:open', 'appearance'));
  const settings = await settingsWindow;
  await expect(settings.locator('.surface-flat').first()).toBeVisible();
  await expectFlatSurfaces(settings);
  await settings.close();
});

test('panel actions overflow one at a time and return when the panel grows', async ({}, testInfo) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(2200, 1100));
  await startSession('添加深色模式');
  await expect(page.getByRole('button', { name: 'Rewind to here', exact: true })).toBeEnabled({ timeout: 60_000 });
  await addWorkspaceTab('Files');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+d' : 'Control+d');
  await addWorkspaceTab('Terminal');
  const workspace = page.locator('[data-slot="workspace"]');
  const dock = workspace.getByRole('tablist', { name: /^(Panels|面板)$/ });
  const diff = workspace.locator('[data-tab="diff"]');
  const files = workspace.locator('[data-tab="files"]');
  const terminal = workspace.locator('[data-tab="terminal"]');
  const divider = page.locator('[id$=":thread"] > [data-slot="resizable-handle"]');
  await dock.getByRole('tab', { name: 'Changes' }).click();
  const toolbar = diff.locator('[data-slot="panel-toolbar"]');
  const visibleActions = () =>
    toolbar
      .locator('[data-panel-action]:visible')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-panel-action')!));
  const resize = async (width: number) => {
    const panelBox = await workspace.boundingBox();
    const grip = await divider.boundingBox();
    const x = grip!.x + grip!.width / 2;
    const y = grip!.y + grip!.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    // Move beyond the hit area first so even a small resize is registered as a drag.
    await page.mouse.move(x - 24, y);
    await page.mouse.move(x + panelBox!.width - width, y, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => Math.abs((await workspace.boundingBox())!.width - width)).toBeLessThan(2);
  };
  const expectHeadingFits = async (panel: Locator) => {
    const heading = panel.locator('header.panel-heading');
    const bounds = await heading.boundingBox();
    const title = heading.locator('[data-slot="panel-title"]');
    await expect(title).toHaveCSS('white-space', 'nowrap');
    for (const button of await heading.getByRole('button').all()) {
      const box = await button.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(bounds!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height);
    }
  };

  await page.evaluate(() => window.piDesktop.invoke('settings:set', { density: 'comfortable', fontSize: 24 }));
  await resize(420);
  const all = await visibleActions();
  expect(all).toEqual(['tree', 'find', 'open-in']);
  let previous = all;
  const transitions: string[] = [];
  for (let width = 410; width >= 230; width -= 10) {
    await resize(width);
    const visible = await visibleActions();
    const removed = previous.filter((id) => !visible.includes(id));
    expect(removed.length).toBeLessThanOrEqual(1);
    expect(visible.every((id) => previous.includes(id))).toBe(true);
    transitions.push(...removed);
    previous = visible;
    await expectHeadingFits(diff);
  }
  expect(transitions[0]).toBe('open-in');
  await toolbar.getByRole('button', { name: 'Panel options' }).click();
  await page.getByRole('menuitem', { name: 'Open in…', exact: true }).hover();
  await expect(page.getByRole('menuitem', { name: 'Terminal', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await resize(420);
  await expect.poll(visibleActions).toEqual(all);
  await toolbar.getByRole('button', { name: /Find in the diff/ }).click();
  await expect(diff.getByRole('search').getByRole('textbox')).toBeFocused();
  await diff.getByRole('button', { name: 'Close search' }).click();

  // A larger Chinese title and comfortable controls must remeasure without a reload.
  await page.evaluate(() =>
    window.piDesktop.invoke('settings:set', {
      language: 'zh',
      density: 'comfortable',
      fontSize: 24,
    }),
  );
  for (const width of [230, 320, 420]) {
    await resize(width);
    for (const [name, panel] of [
      ['文件', files],
      ['终端', terminal],
      ['变更', diff],
    ] as const) {
      await dock.getByRole('tab', { name, exact: true }).click();
      await expectHeadingFits(panel);
    }
  }
  await resize(230);
  await page.screenshot({ path: testInfo.outputPath('chinese-large-text-narrow.png') });
  const toggle = toolbar.getByRole('button', { name: '隐藏改动文件', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(diff.getByRole('navigation', { name: '改动文件' })).toHaveCount(0);
  await expect(toolbar.getByRole('button', { name: '显示改动文件', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.evaluate(() =>
    window.piDesktop.invoke('settings:set', { language: 'en', fontSize: 14, density: 'compact' }),
  );
  await resize(420);
  await dock.getByRole('tab', { name: 'Terminal' }).click();
  await terminal.getByRole('button', { name: 'New terminal' }).click();
  await expect(terminal.getByRole('tab')).toHaveCount(2);
  await addWorkspaceTab('Preview');
  const preview = workspace.locator('[data-tab="preview"]');
  await expect(preview.getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
  await expect(preview.getByRole('button', { name: 'Forward', exact: true })).toBeDisabled();
  await resize(230);
  await preview.getByRole('button', { name: 'Panel options' }).click();
  await expect(page.getByRole('menuitem', { name: 'Reload', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
});

test('a new session opens straight away, before its agent and worktree are ready', async () => {
  const input = page.getByPlaceholder('Describe a task or ask a question');
  await input.fill('日期显示少了一个月，帮我修一下');
  await input.press('Enter');
  await expect(page.getByText('日期显示少了一个月，帮我修一下').first()).toBeVisible({ timeout: 3_000 });
  await expect(page.getByText('测试全部通过').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Starting the session…')).toHaveCount(0);
});

test('! runs a command in the session’s own shell and keeps it in the conversation', async () => {
  await startSession('hello');
  // The demo model answers with its greeting, so that turn is over and the shell is free.
  await expect(page.getByText('离线演示模型').first()).toBeVisible({ timeout: 60_000 });
  const box = page.locator('textarea[data-composer-input]');
  await box.fill('!echo hello-shell');
  // The composer says where the command runs, so nobody mistakes it for a prompt.
  await expect(page.getByTestId('composer-shell')).toHaveText(/session’s own shell/);
  await box.press('Enter');
  const block = page.getByTestId('bash-item');
  await expect(block).toContainText('!echo hello-shell');
  await expect(block.locator('.term-out')).toContainText('hello-shell', { timeout: 30_000 });
  // It finished (the spinner is gone), and the reply that was streaming was not repeated by its result.
  await expect(block.getByLabel('Running…')).toHaveCount(0);
  await expect(page.getByText('离线演示模型', { exact: true })).toHaveCount(1);
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
  await sidebar().getByRole('button', { name: 'Archived', exact: true }).click();
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

test('a title is renamed where it stands, from the sidebar or the header', async () => {
  await startSession('hello');
  await expect(row('hello')).toBeVisible();

  // Double-click the title in the sidebar: it turns into a field with the text selected.
  await row('hello').getByRole('button', { name: 'hello', exact: true }).dblclick();
  const field = sidebar().getByRole('textbox', { name: 'Rename' });
  await field.fill('Design the fix');
  await field.press('Enter');
  await expect(row('Design the fix')).toBeVisible();
  await expect(row('hello')).toHaveCount(0);

  // Double-click the title in the header; Escape leaves the title as it was.
  const header = page.locator('header');
  const title = header.getByTitle('Rename');
  await title.dblclick();
  const headerField = header.getByRole('textbox', { name: 'Rename' });
  await headerField.fill('throw this away');
  await headerField.press('Escape');
  await expect(headerField).toHaveCount(0);
  await expect(title).toHaveText('Design the fix');

  // The Session menu renames from the header too.
  await header.getByRole('button', { name: 'Session menu' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await headerField.fill('Design the header');
  await headerField.press('Enter');
  await expect(title).toHaveText('Design the header');
  await expect(row('Design the header')).toBeVisible();
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
  await sidebar().getByRole('button', { name: 'Archived', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unarchive' })).toHaveCount(1);
});

test('each session keeps its own workspace: no surprise Diff, layout restored on return', async () => {
  const dock = page.getByRole('tablist', { name: 'Panels' });
  const diff = dock.getByRole('tab', { name: 'Changes' });
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
  await addWorkspaceTab('Files');
  await expect(dock.getByRole('tab', { name: 'Files', selected: true })).toBeVisible();

  // A second session starts with a clean workspace …
  await mod('n');
  await startSession('hello');
  await expect(diff).toHaveCount(0);

  // … and the first one comes back the way it was left.
  await row(first).click();
  await expect(dock.getByRole('tab', { name: 'Files', selected: true })).toBeVisible();
  await diff.click();
  await expect(changedFiles).toBeVisible();
});
