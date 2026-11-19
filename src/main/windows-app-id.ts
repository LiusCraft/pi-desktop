import type { App } from 'electron';

// Must match the installer shortcut's appId in electron-builder.yml.
const INSTALLED_APP_ID = 'dev.pi-desktop.app';

export function configureWindowsAppId(app: Pick<App, 'isPackaged' | 'setAppUserModelId'>, platform: NodeJS.Platform) {
  if (platform !== 'win32') return;
  app.setAppUserModelId(app.isPackaged ? INSTALLED_APP_ID : `${INSTALLED_APP_ID}.dev`);
}
