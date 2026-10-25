import type { ApiArgs, ApiChannel, ApiResult } from '@shared/protocol';

export const bridge = window.piDesktop;
export const platform = bridge?.platform ?? 'darwin';
export const isMac = platform === 'darwin';
export const modKey = isMac ? '⌘' : 'Ctrl+';

/** Typed call into main / the agent host. */
export function call<K extends ApiChannel>(channel: K, ...args: ApiArgs<K>): Promise<ApiResult<K>> {
  return bridge.invoke(channel, ...args);
}

/** Electron prefixes remote errors; show only the message itself. */
export function errText(err: unknown) {
  return String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') || '操作失败';
}
