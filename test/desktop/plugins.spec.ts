import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

/** The desktop tests need the Electron binary; a checkout that never installed it skips instead of failing. */
const electronBinary = (() => {
  try {
    return createRequire(path.resolve('package.json'))('electron') as string;
  } catch {
    return null;
  }
})();
test.skip(!electronBinary || !fs.existsSync(electronBinary), 'Electron is not installed in this checkout');

/**
 * The desktop-plugin loop, end to end: a package installed from a folder, a page served from
 * `pidesk-plugin://`, and a call that reaches the plugin's own host entry in the agent process.
 */
test('a plugin page runs sandboxed and calls its host entry', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-desktop-plugin-'));
  const dataDir = path.join(temporary, 'data');
  const agentDir = path.join(temporary, 'agent');
  const electronProfile = path.join(temporary, 'electron-profile');
  const plugin = path.resolve('plugin/pi-plugin-example');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(electronProfile, { recursive: true });
  // The package is installed from a folder, and the user already agreed to what it asks for: this test
  // is about the page and its calls, not about the consent dialog.
  fs.writeFileSync(path.join(agentDir, 'settings.json'), JSON.stringify({ packages: [plugin] }));
  fs.writeFileSync(path.join(dataDir, 'plugins.json'), JSON.stringify({
    plugins: { example: { source: plugin, enabled: true, granted: ['session:read', 'session:prompt', 'notify', 'storage', 'host:call'] } },
  }));

  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      executablePath: electronBinary as string,
      args: [path.resolve('.'), '--demo', '--lang=en-US', `--user-data-dir=${electronProfile}`],
      env: { ...process.env, PI_DESKTOP_HOME: dataDir, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1' },
    });
    const page = await app.firstWindow();

    // The plugin's page is in the sidebar because the package is enabled.
    await page.getByRole('button', { name: 'Example' }).click();

    const frame = page.frameLocator('iframe');
    await expect(frame.getByRole('heading', { name: 'Example plugin' })).toBeVisible();

    // A call that runs in the agent host, and the data it pushes back.
    await frame.getByRole('button', { name: 'Greet' }).click();
    await expect(frame.locator('#out')).toContainText('"count": 1');
    await expect(frame.locator('#count')).toHaveText('1');
  } finally {
    await app?.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
