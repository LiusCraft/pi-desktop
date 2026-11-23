import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test as base, type ElectronApplication, type Page } from '@playwright/test';

const repo = 'pi-demo/pr-progress';
const githubUrl = `https://github.com/${repo}/pull`;
const exampleUrl = 'https://github.com/owner/repo/pull/123';
const title = '#42 · Demo PR progress';
const stages = ['read', 'clone', 'fetch'] as const;
const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' };

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', ['-c', 'user.name=PR Demo', '-c', 'user.email=demo@example.com', ...args], {
    cwd,
    env: gitEnv,
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim();
}

const test = base.extend<{ demo: { page: Page; parent: string; release: (stage: (typeof stages)[number]) => void } }>({
  demo: async ({}, use, testInfo) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-desktop-pr-demo-'));
    const release = (stage: (typeof stages)[number]) => fs.writeFileSync(path.join(home, `release-${stage}`), '');
    const parent = path.join(home, 'clones');
    let app: ElectronApplication | undefined;
    let page: Page | undefined;
    try {
      const source = path.join(home, 'source');
      const bin = path.join(home, 'bin');
      for (const dir of [source, parent, bin]) fs.mkdirSync(dir);
      git(source, 'init', '-b', 'main');
      git(source, 'commit', '--allow-empty', '-m', 'Base');
      git(source, 'switch', '-c', 'feature');
      fs.writeFileSync(path.join(source, 'pr-change.txt'), 'Added by the demo PR\n');
      git(source, 'add', 'pr-change.txt');
      git(source, 'commit', '-m', 'PR change');
      git(source, 'switch', 'main');
      git(home, 'clone', '--bare', source, 'remote.git');
      for (const command of ['gh', 'pr-demo-ssh']) {
        const executable = path.join(bin, command);
        fs.copyFileSync(path.resolve('test/desktop/fixtures/pr-demo.cjs'), executable);
        fs.chmodSync(executable, 0o755);
      }

      app = await electron.launch({
        executablePath: createRequire(path.resolve('package.json'))('electron') as string,
        args: [path.resolve('.'), '--demo', '--lang=en-US', `--user-data-dir=${path.join(home, 'profile')}`],
        env: {
          ...gitEnv,
          PATH: [bin, path.dirname(process.execPath), process.env.PATH].join(path.delimiter),
          PI_DESKTOP_HOME: path.join(home, 'data'),
          PI_CODING_AGENT_DIR: path.join(home, 'agent'),
          PI_OFFLINE: '1',
          PR_DEMO_HOME: home,
          PR_DEMO_REPO: repo,
          GIT_ALLOW_PROTOCOL: 'file:ssh',
          GIT_SSH_COMMAND: 'pr-demo-ssh',
          GIT_SSH_VARIANT: 'simple',
        },
      });
      // Only the native folder picker is replaced. The PR dialogs and progress are the real renderer.
      await app.evaluate(({ dialog }, directory) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
      }, parent);
      page = await app.firstWindow();
      await expect(startButton(page)).toBeEnabled();
      await use({ page, parent, release });
    } finally {
      try {
        if (page && !page.isClosed() && testInfo.status !== testInfo.expectedStatus) {
          await testInfo.attach('window', { body: await page.screenshot(), contentType: 'image/png' });
        }
      } finally {
        stages.forEach(release);
        await app?.close();
        fs.rmSync(home, { recursive: true, force: true });
      }
    }
  },
});

// The offline gh and SSH transport are POSIX executables.
test.skip(process.platform === 'win32', 'The offline PR demo uses POSIX command shims');

const startButton = (page: Page) => page.getByRole('button', { name: 'Start from PR', exact: true });
const status = (page: Page, label: string) => page.getByRole('status').filter({ hasText: label });
const sessions = (page: Page) => page.evaluate(() => window.piDesktop.invoke('sessions:list'));

async function submitPr(page: Page, num: number) {
  await startButton(page).click();
  const prompt = page.getByRole('dialog', { name: 'Start from PR' });
  await prompt.getByPlaceholder(exampleUrl).fill(`${githubUrl}/${num}`);
  await prompt.getByRole('button', { name: 'Start', exact: true }).click();
}

test('shows live PR creation progress and opens the imported worktree', async ({ demo }, testInfo) => {
  const { page, parent, release } = demo;
  await submitPr(page, 42);
  await expect(status(page, 'Reading pull request…')).toBeVisible();
  await expect(startButton(page)).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('01-reading.png') });
  release('read');

  const clone = page.getByRole('alertdialog', { name: 'Clone repository' });
  await expect(clone).toContainText(`Choose a parent folder for ${repo}.`);
  await clone.getByRole('button', { name: 'Choose', exact: true }).click();
  await expect(status(page, 'Cloning repository…')).toBeVisible();
  await expect(startButton(page)).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('02-cloning.png') });
  release('clone');

  await expect(status(page, 'Fetching PR branches…')).toBeVisible();
  expect(await sessions(page)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('03-fetching.png') });
  release('fetch');

  await expect(page.locator('main > header').getByText(title, { exact: true })).toBeVisible();
  await expect(page.getByText('Starting the session…', { exact: true })).toBeHidden();
  const result = await sessions(page);
  expect(result).toHaveLength(1);
  const [meta] = result;
  expect(meta).toMatchObject({ title, worktree: true, baseBranch: 'origin/main' });
  expect(fs.realpathSync(meta.projectPath)).toBe(fs.realpathSync(path.join(parent, 'pr-progress')));
  expect(git(meta.cwd, 'rev-parse', '--abbrev-ref', '@{upstream}')).toBe('origin/feature');
  expect(fs.readFileSync(path.join(meta.cwd, 'pr-change.txt'), 'utf8')).toBe('Added by the demo PR\n');
  await expect(startButton(page)).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('04-session.png') });
});

test('shows a closed PR failure in place and preserves the URL for retry', async ({ demo }, testInfo) => {
  const { page, release } = demo;
  release('read');
  await submitPr(page, 43);
  const error = page.getByRole('alert').filter({ hasText: 'Could not start from PR' });
  await expect(error).toContainText('Only open or draft PRs can be imported.');
  await expect(startButton(page)).toBeEnabled();
  expect(await sessions(page)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('05-failure.png') });

  await startButton(page).click();
  const prompt = page.getByRole('dialog', { name: 'Start from PR' });
  await expect(prompt.getByPlaceholder(exampleUrl)).toHaveValue(`${githubUrl}/43`);
  await prompt.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(startButton(page)).toBeEnabled();
  await expect(error).toBeHidden();
});
