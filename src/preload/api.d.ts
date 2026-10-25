// The bridge the preload exposes as `window.piDesktop`.
import type { ApiArgs, ApiChannel, ApiResult, BootPayload, PushChannel, PushEvents } from '../shared/protocol';

export interface DesktopBridge {
  platform: string;
  /** Settings and app info read synchronously before the first paint. */
  boot: Partial<BootPayload>;
  /** Native path of a dropped or pasted File (empty when it has none). */
  getPathForFile(file: File): string;
  invoke<K extends ApiChannel>(channel: K, ...args: ApiArgs<K>): Promise<ApiResult<K>>;
  on<K extends PushChannel>(channel: K, cb: (payload: PushEvents[K]) => void): () => void;
}

declare global {
  interface Window {
    piDesktop: DesktopBridge;
  }
}
