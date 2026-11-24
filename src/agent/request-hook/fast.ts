import { canSendFast, isGptModel, knownFastModel, modelKey } from '@shared/fast-mode';

type FastModel = { provider: string; id: string; api: string };

export function supportsFast(model: FastModel | null | undefined, configured?: boolean): boolean {
  if (!model || !canSendFast(model.api)) return false;
  return configured === undefined ? knownFastModel(model.id) : isGptModel(model.id) && configured;
}

/** Pi's streamSimple does not forward the provider-specific serviceTier option. */
export function fastPayload(payload: unknown, model: FastModel, selected: string | undefined, configured?: boolean) {
  if (!selected || selected !== modelKey(model) || !supportsFast(model, configured)) return undefined;
  // A provider extension may already have made an explicit tier choice. Leave it alone.
  if (typeof payload !== 'object' || !payload || Array.isArray(payload) || 'service_tier' in payload) return undefined;
  return { ...payload, service_tier: 'priority' };
}
