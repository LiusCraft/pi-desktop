// Model management for the desktop: provider accounts (pi's auth.json, OAuth
// and API keys through ModelRuntime.login), custom endpoints (pi's models.json)
// and model metadata aligned from models.dev by model id.
import { tr } from '@shared/i18n/runtime';
import crypto from 'node:crypto';
import path from 'node:path';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { AuthEvent, AuthPrompt, AuthType, EndpointDraft, HostEvent, ModelCatalogInfo } from '@shared/protocol';
import { discoverModels, EndpointStore, validProviderId } from './endpoints';
import { appCacheDir } from './app-paths';
import { ModelsDevCatalog } from './models-dev';
import { alignModel } from '@shared/model-metadata';
export { alignModel } from '@shared/model-metadata';

/** A login flow waiting for answers from the settings window. */
interface PendingLogin {
  id: string;
  provider: string;
  name: string;
  controller: AbortController;
  prompts: Map<string, { resolve: (value: string) => void; reject: (error: Error) => void }>;
}

export interface ModelAdminOptions {
  agentDir: string;
  /** Pi Desktop's own data folder, used only for the disposable models.dev cache. */
  dataDir: string;
  /** The hub's runtime, which owns credentials and the composed providers. */
  models: () => ModelRuntime;
  /** Serialized catalog refresh: two concurrent refreshes can drop a freshly added provider. */
  refresh: (options: { allowNetwork?: boolean; providers?: string[]; signal?: AbortSignal }) => Promise<unknown>;
  /** Stable app installation id, used by the OpenAI/Codex login flows. */
  deviceId: () => string;
  emit: (event: HostEvent) => void;
}

const label = (source: string | undefined, fallback?: string): string | undefined => {
  switch (source) {
    case 'stored': return 'auth.json';
    case 'runtime': return 'runtime key';
    case 'environment': return fallback ?? 'environment';
    case 'models_json_key': return 'models.json';
    case 'models_json_command': return 'models.json command';
    case 'fallback': return 'models.json';
    default: return fallback ?? source;
  }
};

/** Only the wire-safe fields of an auth prompt; the abort signal stays in the host. */
function wirePrompt(prompt: { type: string; message: string; placeholder?: string; options?: readonly { id: string; label: string; description?: string }[] }): AuthPrompt {
  if (prompt.type === 'select') {
    return { type: 'select', message: prompt.message, options: (prompt.options ?? []).map(({ id, label: l, description }) => ({ id, label: l, description })) };
  }
  return { type: prompt.type as AuthPrompt['type'], message: prompt.message, placeholder: prompt.placeholder };
}

/** Same for the out-of-band login events (readonly arrays become plain arrays). */
function wireEvent(event: { type: string; message?: string; links?: readonly { url: string; label?: string }[]; url?: string; instructions?: string; userCode?: string; verificationUri?: string; intervalSeconds?: number; expiresInSeconds?: number }): AuthEvent {
  switch (event.type) {
    case 'auth_url':
      return { type: 'auth_url', url: String(event.url ?? ''), instructions: event.instructions };
    case 'device_code':
      return { type: 'device_code', userCode: String(event.userCode ?? ''), verificationUri: String(event.verificationUri ?? ''), intervalSeconds: event.intervalSeconds, expiresInSeconds: event.expiresInSeconds };
    case 'info':
      return { type: 'info', message: String(event.message ?? ''), links: event.links?.map(({ url, label: l }) => ({ url, label: l })) };
    default:
      return { type: 'progress', message: String(event.message ?? '') };
  }
}

export class ModelAdmin {
  private readonly endpoints: EndpointStore;
  private readonly dev: ModelsDevCatalog;
  private readonly logins = new Map<string, PendingLogin>();
  private builtinIds: Set<string> | null = null;
  /** Mutating operations (login, logout, endpoint writes) run one at a time. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: ModelAdminOptions) {
    this.endpoints = new EndpointStore(path.join(opts.agentDir, 'models.json'));
    this.dev = new ModelsDevCatalog(path.join(appCacheDir(opts.dataDir), 'models-dev.json'));
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => {});
    return next;
  }

  /** pi's built-in provider ids, so the UI can tell an override from a new endpoint. */
  private async builtins(): Promise<Set<string>> {
    if (!this.builtinIds) {
      const mod = await import('@earendil-works/pi-ai/providers/all');
      this.builtinIds = new Set(mod.getBuiltinProviders());
    }
    return this.builtinIds;
  }

  // ------------------------------------------------------------ providers

  async catalog(): Promise<ModelCatalogInfo> {
    const models = this.opts.models();
    // Cached metadata only: opening settings must not wait on models.dev.
    this.dev.ensure();
    const [builtinIds, credentials] = await Promise.all([
      this.builtins(),
      models.listCredentials({ signal: AbortSignal.timeout(10_000) }).catch(() => []),
    ]);
    const stored = new Set(credentials.map((c) => c.providerId));
    const customIds = this.endpoints.ids();
    const status = (id: string): { configured: boolean; authType?: AuthType; source?: string; credential: boolean } => {
      const auth = models.getProviderAuthStatus(id);
      const authType: AuthType | undefined = auth.configured ? (models.isUsingOAuth(id) ? 'oauth' : 'api_key') : undefined;
      return {
        configured: auth.configured,
        authType,
        source: auth.configured ? label(auth.source, auth.label) : undefined,
        credential: stored.has(id),
      };
    };
    const providers = models
      .getProviders()
      // The offline demo model is not an account the user can manage.
      .filter((provider) => provider.id !== 'demo')
      .map((provider) => {
        const auth = status(provider.id);
        return {
          id: provider.id,
          name: provider.name,
          oauth: Boolean(provider.auth.oauth),
          oauthName: provider.auth.oauth?.name,
          subscription: provider.auth.oauth?.isSubscription === true,
          apiKey: Boolean(provider.auth.apiKey),
          apiKeyLogin: Boolean(provider.auth.apiKey?.login),
          configured: auth.configured,
          authType: auth.authType,
          source: auth.source,
          credential: auth.credential,
          custom: customIds.has(provider.id),
          models: models.getModels(provider.id).length,
        };
      })
      .sort((a, b) => Number(b.configured) - Number(a.configured) || Number(a.custom) - Number(b.custom) || a.name.localeCompare(b.name));
    const endpoints = this.endpoints.list(builtinIds, (id) => {
      const auth = status(id);
      return { keySet: auth.configured, keySource: auth.source };
    }, (modelId, providerId) => this.dev.lookup(modelId, providerId));
    const { error } = this.endpoints.read();
    // Availability failures are background noise, not configuration problems.
    const configErrors = (models.getError() ?? '')
      .split('\n\n')
      .filter((message) => message.trim() && !message.startsWith('Availability refresh:'));
    return {
      providers,
      endpoints,
      paths: { agentDir: this.opts.agentDir, auth: path.join(this.opts.agentDir, 'auth.json'), models: this.endpoints.file },
      catalogAt: this.dev.lastFetched,
      errors: [error, ...configErrors].filter((e): e is string => Boolean(e)),
    };
  }

  /** Force-refresh pi's catalogs and the models.dev metadata cache. */
  async refresh(): Promise<ModelCatalogInfo> {
    await this.run(async () => {
      await Promise.all([
        this.dev.refresh().catch(() => {}),
        this.opts.refresh({ signal: AbortSignal.timeout(30_000) }).catch(() => {}),
      ]);
      this.changed();
    });
    return this.catalog();
  }

  // ------------------------------------------------------------ login / logout

  private changed() {
    this.opts.emit({ type: 'changed', resource: 'models' });
  }

  login(providerId: string, authType: AuthType, name?: string): Promise<void> {
    return this.run(() => this.loginNow(providerId, authType, name));
  }

  private async loginNow(providerId: string, authType: AuthType, name?: string): Promise<void> {
    const models = this.opts.models();
    const provider = models.getProvider(providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);
    const display = name?.trim() || provider.name;
    if (authType === 'oauth' && !provider.auth.oauth) throw new Error(tr('ag.noOauth', { name: display }));
    if (authType === 'api_key') {
      if (!provider.auth.apiKey) throw new Error(tr('ag.noApiKey', { name: display }));
      if (!provider.auth.apiKey.login) throw new Error(tr('ag.keyFromEnv', { name: display }));
    }
    const login: PendingLogin = { id: crypto.randomUUID(), provider: providerId, name: display, controller: new AbortController(), prompts: new Map() };
    this.logins.set(login.id, login);
    this.opts.emit({ type: 'auth_event', loginId: login.id, provider: providerId, event: { type: 'progress', message: tr('ag.login', { name: display }) } });
    try {
      await models.login(
        providerId,
        authType,
        {
          signal: login.controller.signal,
          prompt: (prompt) => this.ask(login, prompt),
          notify: (event) => this.opts.emit({ type: 'auth_event', loginId: login.id, provider: providerId, event: wireEvent(event) }),
        },
        { getDeviceId: this.opts.deviceId },
      );
    } finally {
      for (const pending of login.prompts.values()) pending.reject(new Error('Login cancelled'));
      login.prompts.clear();
      this.logins.delete(login.id);
    }
    // Like pi after /login: refresh just this provider (dynamic catalogs are keyed to the credential).
    await this.opts.refresh({ providers: [providerId], signal: AbortSignal.timeout(15_000) }).catch(() => {});
    this.changed();
  }

  private ask(login: PendingLogin, prompt: { type: string; message: string; placeholder?: string; options?: readonly { id: string; label: string; description?: string }[]; signal?: AbortSignal }): Promise<string> {
    const requestId = crypto.randomUUID();
    return new Promise<string>((resolve, reject) => {
      const finish = () => {
        login.prompts.delete(requestId);
        prompt.signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        finish();
        reject(new Error('Login cancelled'));
      };
      if (prompt.signal?.aborted || login.controller.signal.aborted) return reject(new Error('Login cancelled'));
      prompt.signal?.addEventListener('abort', onAbort, { once: true });
      login.prompts.set(requestId, {
        resolve: (value) => {
          finish();
          resolve(value);
        },
        reject: (error) => {
          finish();
          reject(error);
        },
      });
      this.opts.emit({ type: 'auth_prompt', loginId: login.id, provider: login.provider, providerName: login.name, requestId, prompt: wirePrompt(prompt) });
    });
  }

  respond(loginId: string, requestId: string, value: string) {
    this.logins.get(loginId)?.prompts.get(requestId)?.resolve(value);
  }

  cancel(loginId: string) {
    const login = this.logins.get(loginId);
    if (!login) return;
    login.controller.abort();
    for (const pending of [...login.prompts.values()]) pending.reject(new Error('Login cancelled'));
  }

  /** The settings window closed while a flow was waiting: stop it. */
  cancelAll() {
    for (const loginId of [...this.logins.keys()]) this.cancel(loginId);
  }

  logout(providerId: string): Promise<void> {
    return this.run(async () => {
      const models = this.opts.models();
      await models.logout(providerId, { signal: AbortSignal.timeout(15_000) });
      await this.opts.refresh({ providers: [providerId], allowNetwork: false, signal: AbortSignal.timeout(15_000) }).catch(() => {});
      this.changed();
    });
  }

  // ------------------------------------------------------------ endpoints

  async discover(draft: EndpointDraft) {
    const models = this.opts.models();
    const id = draft.id.trim().toLowerCase();
    let apiKey = draft.apiKey?.trim() || undefined;
    let headers: Record<string, string> | undefined;
    if (id && models.getProvider(id)) {
      const auth = await models.getAuth(id).catch(() => undefined);
      apiKey ??= auth?.auth.apiKey;
      headers = Object.fromEntries(Object.entries(auth?.auth.headers ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    }
    const found = await discoverModels({ baseUrl: draft.baseUrl, api: draft.api, apiKey, headers });
    await this.dev.ready();
    return {
      models: found.models.map((model) => alignModel(model, this.dev.lookup(model.id, id))),
      error: found.error,
    };
  }

  /** Write the endpoint, store its credential through pi, and return the new catalog. */
  saveEndpoint(draft: EndpointDraft): Promise<ModelCatalogInfo> {
    return this.run(() => this.saveEndpointNow(draft));
  }

  private async saveEndpointNow(draft: EndpointDraft): Promise<ModelCatalogInfo> {
    const models = this.opts.models();
    const id = draft.id.trim().toLowerCase();
    const builtinIds = await this.builtins();
    if (!validProviderId(id)) throw new Error(tr('ag.providerId'));
    // A built-in override may keep the provider's own API; a new endpoint needs one.
    if (!draft.api.trim() && !builtinIds.has(id)) throw new Error(tr('ag.pickApiType'));
    if (!builtinIds.has(id) && !draft.models.length && !this.endpoints.ids().has(id)) throw new Error(tr('ag.addModel'));
    if (draft.apiKey?.trim() && builtinIds.has(id)) throw new Error(tr('ag.builtinKey'));
    // Saving manual values must work immediately even without a public catalog.
    this.dev.ensure();
    const aligned = draft.models.map((model) => alignModel(model, this.dev.lookup(model.id, id)));
    this.endpoints.save({ ...draft, id, models: aligned });
    await this.opts.refresh({ allowNetwork: false, signal: AbortSignal.timeout(15_000) }).catch(() => {});
    // Surface a schema problem instead of silently saving an endpoint pi ignores.
    const configErrors = (models.getError() ?? '')
      .split('\n\n')
      .filter((message) => /models\.json|Invalid models|Provider "/i.test(message));
    if (!models.getProvider(id) || configErrors.length) {
      throw new Error(tr('ag.notLoaded', { errors: configErrors.join('\n') || tr('ag.notAccepted') }));
    }
    if (draft.removeKey) await models.logout(id, { signal: AbortSignal.timeout(15_000) }).catch(() => {});
    if (draft.apiKey?.trim()) {
      const key = draft.apiKey.trim();
      await models.login(id, 'api_key', { prompt: async () => key, notify: () => {} }, { getDeviceId: this.opts.deviceId });
    }
    await this.opts.refresh({ providers: [id], allowNetwork: false, signal: AbortSignal.timeout(15_000) }).catch(() => {});
    this.changed();
    return this.catalog();
  }

  removeEndpoint(id: string): Promise<ModelCatalogInfo> {
    return this.run(async () => {
      const models = this.opts.models();
      const builtinIds = await this.builtins();
      this.endpoints.remove(id);
      await this.opts.refresh({ allowNetwork: false, signal: AbortSignal.timeout(15_000) }).catch(() => {});
      if (!builtinIds.has(id)) await models.logout(id, { signal: AbortSignal.timeout(15_000) }).catch(() => {});
      this.changed();
      return this.catalog();
    });
  }
}
