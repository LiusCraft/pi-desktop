import type { App } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { configureWindowsAppId } from '../src/main/windows-app-id';

describe('Windows taskbar and notification identity', () => {
  it.each([
    [true, 'dev.pi-desktop.app'],
    [false, 'dev.pi-desktop.app.dev'],
  ] as const)('registers the correct ID when isPackaged is %s', (isPackaged, expected) => {
    const setAppUserModelId = vi.fn<App['setAppUserModelId']>();
    configureWindowsAppId({ isPackaged, setAppUserModelId }, 'win32');
    expect(setAppUserModelId).toHaveBeenCalledExactlyOnceWith(expected);
  });

  it.each(['darwin', 'linux'] as const)('leaves the identity unchanged on %s', (platform) => {
    const setAppUserModelId = vi.fn<App['setAppUserModelId']>();
    configureWindowsAppId({ isPackaged: true, setAppUserModelId }, platform);
    expect(setAppUserModelId).not.toHaveBeenCalled();
  });
});
