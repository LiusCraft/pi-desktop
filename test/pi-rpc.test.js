const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { nodeExecutable } = require('../electron/pi-rpc');

describe('pi Node executable', () => {
  it('uses the background Helper in a packaged macOS app', () => {
    assert.equal(
      nodeExecutable('/Applications/Pi Desktop.app/Contents/MacOS/Pi Desktop', 'darwin', '45.0.0'),
      '/Applications/Pi Desktop.app/Contents/Frameworks/Pi Desktop Helper.app/Contents/MacOS/Pi Desktop Helper',
    );
  });

  it('uses the background Helper in development', () => {
    assert.equal(
      nodeExecutable('/project/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron', 'darwin', '45.0.0'),
      '/project/node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Helper.app/Contents/MacOS/Electron Helper',
    );
  });

  it('keeps plain Node unchanged on macOS', () => {
    assert.equal(nodeExecutable('/usr/local/bin/node', 'darwin', null), '/usr/local/bin/node');
  });

  it('keeps the existing executable on other platforms', () => {
    for (const [platform, execPath] of [['linux', '/opt/pi-desktop/pi-desktop'], ['win32', 'C:\\Pi Desktop\\Pi Desktop.exe']]) {
      assert.equal(nodeExecutable(execPath, platform, '45.0.0'), execPath);
    }
  });
});
