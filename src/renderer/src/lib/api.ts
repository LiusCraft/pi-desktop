import type { ApiArgs, ApiChannel, ApiResult } from '@shared/protocol';
import { tr } from '@shared/i18n/runtime';
import { remoteHasTerminals } from '@shared/remote';

export const bridge = window.piDesktop;
export const platform = bridge?.platform ?? 'darwin';
export const isMac = platform === 'darwin';
export const modKey = isMac ? '⌘' : 'Ctrl+';

/** The window shows another machine's sessions (fixed for the life of the window): nothing here may touch this machine's files, editors or shells. */
export const remoteHost = bridge?.boot?.remote ?? null;
export const isRemote = remoteHost !== null;
/** Terminal tabs run where the sessions run, so a remote offers them only when it is a Desktop. */
export const canTerminal = !remoteHost || remoteHasTerminals(remoteHost.kind);

/** Typed call into main / the agent host. */
export function call<K extends ApiChannel>(channel: K, ...args: ApiArgs<K>): Promise<ApiResult<K>> {
  return bridge.invoke(channel, ...args);
}

/** Electron prefixes remote errors; show only the message itself. */
export function errText(err: unknown) {
  return (
    String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') ||
    tr('error.fallback')
  );
}
