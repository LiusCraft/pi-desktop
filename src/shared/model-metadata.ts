import type { EndpointModel, ModelCost, ModelMeta } from './protocol';

export const COST_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const;

export const positiveLimit = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

export const nonNegativePrice = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/** Catalog metadata fills gaps only; explicit zero prices and false capabilities win. */
export function alignModel(model: EndpointModel, meta: ModelMeta | undefined): EndpointModel {
  if (!meta) return model;
  const cost: ModelCost = {};
  for (const key of COST_FIELDS) {
    const value = model.cost?.[key] ?? nonNegativePrice(meta.cost?.[key]);
    if (value !== undefined) cost[key] = value;
  }
  const hasOwnMeta = model.name !== undefined || model.contextWindow !== undefined || model.maxTokens !== undefined ||
    model.reasoning !== undefined || model.input !== undefined || COST_FIELDS.some((key) => model.cost?.[key] !== undefined);
  return {
    ...model,
    name: model.name ?? meta.name,
    contextWindow: model.contextWindow ?? positiveLimit(meta.contextWindow),
    maxTokens: model.maxTokens ?? positiveLimit(meta.maxTokens),
    reasoning: model.reasoning ?? meta.reasoning,
    input: model.input ?? meta.input,
    cost: Object.keys(cost).length ? cost : undefined,
    source: hasOwnMeta ? (model.source ?? 'manual') : 'models.dev',
  };
}
