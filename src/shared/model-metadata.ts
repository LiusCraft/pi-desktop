import {
  THINKING_LEVELS,
  type EndpointModel,
  type ModelCost,
  type ModelMeta,
  type ThinkingLevel,
  type ThinkingLevelMap,
} from './protocol';

export const COST_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const;

export const positiveLimit = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

export const nonNegativePrice = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/** Drop unknown levels and non-string values from a hand-edited or wire level map. */
export function cleanThinkingLevelMap(value: unknown): ThinkingLevelMap | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: ThinkingLevelMap = {};
  for (const level of THINKING_LEVELS) {
    const mapped = (value as Record<string, unknown>)[level];
    if (mapped === null) out[level] = null;
    else if (typeof mapped === 'string' && mapped.trim()) out[level] = mapped.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

/** pi's rule: unset levels through high use the provider default; xhigh and max need an explicit value. */
export function levelSupported(thinkingLevelMap: ThinkingLevelMap | undefined, level: ThinkingLevel): boolean {
  const mapped = thinkingLevelMap?.[level];
  if (mapped === null) return false;
  return level === 'xhigh' || level === 'max' ? mapped !== undefined : true;
}

/** The levels the thinking-level picker offers for this model, as pi computes them. */
export function supportedThinkingLevels(model: {
  reasoning?: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
}): ThinkingLevel[] {
  if (!model.reasoning) return ['off'];
  return THINKING_LEVELS.filter((level) => levelSupported(model.thinkingLevelMap, level));
}

/** Catalog metadata fills gaps only; explicit zero prices and false capabilities win. */
export function alignModel(model: EndpointModel, meta: ModelMeta | undefined): EndpointModel {
  if (!meta) return model;
  const cost: ModelCost = {};
  for (const key of COST_FIELDS) {
    const value = model.cost?.[key] ?? nonNegativePrice(meta.cost?.[key]);
    if (value !== undefined) cost[key] = value;
  }
  const hasOwnMeta =
    model.name !== undefined ||
    model.contextWindow !== undefined ||
    model.maxTokens !== undefined ||
    model.reasoning !== undefined ||
    model.thinkingLevelMap !== undefined ||
    model.input !== undefined ||
    COST_FIELDS.some((key) => model.cost?.[key] !== undefined);
  return {
    ...model,
    name: model.name ?? meta.name,
    contextWindow: model.contextWindow ?? positiveLimit(meta.contextWindow),
    maxTokens: model.maxTokens ?? positiveLimit(meta.maxTokens),
    reasoning: model.reasoning ?? meta.reasoning,
    thinkingLevelMap: model.thinkingLevelMap ?? meta.thinkingLevelMap,
    input: model.input ?? meta.input,
    cost: Object.keys(cost).length ? cost : undefined,
    source: hasOwnMeta ? (model.source ?? 'manual') : 'models.dev',
  };
}
