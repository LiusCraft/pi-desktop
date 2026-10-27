/**
 * opencode-headers — OpenCode Zen / Go reject requests without `x-opencode-session`
 * (HTTP 400 MissingSessionID), and treat clients that don't look like opencode as
 * anonymous. pi only adds them for a provider literally named `opencode-go`, so match
 * on the endpoint instead and cover custom providers too.
 */
import { randomUUID } from 'node:crypto';
import type { ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent';

/** Hosts of the OpenCode gateways (opencode.ai/zen, opencode.ai/zen/go). */
const OPENCODE_HOST = /^https?:\/\/(?:[\w-]+\.)*opencode\.ai\//i;

const HEADER = {
  session: 'x-opencode-session',
  request: 'x-opencode-request',
  client: 'x-opencode-client',
  project: 'x-opencode-project',
} as const;

export function createOpencodeHeaders(): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.on('before_provider_headers', (event, ctx) => {
      const baseUrl = ctx.model?.baseUrl;
      if (!baseUrl || !OPENCODE_HOST.test(baseUrl)) return;
      const h = event.headers;
      h[HEADER.session] ??= ctx.sessionManager.getSessionId();
      h[HEADER.request] ??= randomUUID();
      h[HEADER.client] ??= 'cli';
      h[HEADER.project] ??= ctx.cwd;
    });
  };
}
