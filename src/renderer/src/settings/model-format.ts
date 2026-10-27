// Formatting shared by the model management item lists and dialogs.
import type { EndpointModel, ModelCost } from '@shared/protocol';
import { t } from '@/lib/i18n';

/** 400000 → "400K", 1000000 → "1M". */
export function tokensLabel(n?: number): string {
  if (!n || n <= 0) return '—';
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(2))}M`;
  if (n >= 1000) return `${Number((n / 1000).toFixed(n >= 100_000 ? 0 : 1))}K`;
  return String(n);
}

/** Prices are USD per million tokens; keep small ones readable. */
export function moneyLabel(n?: number): string {
  if (n === undefined) return '—';
  if (n === 0) return '0';
  if (n >= 1) return String(Number(n.toFixed(2)));
  return String(Number(n.toPrecision(2)));
}

export function costLabel(cost?: ModelCost): string | undefined {
  if (!cost || (cost.input === undefined && cost.output === undefined)) return undefined;
  const input = cost.input === undefined ? '—' : `$${moneyLabel(cost.input)}`;
  const output = cost.output === undefined ? '—' : `$${moneyLabel(cost.output)}`;
  return t('fmt.perMtok', { input, output });
}

/** The capability/pricing summary under a model id. */
export function modelMetaLine(model: EndpointModel): string {
  const hasMeta = Boolean(model.contextWindow || model.maxTokens || costLabel(model.cost) || model.reasoning || model.input?.includes('image'));
  if (!hasMeta) return t('fmt.noMeta');
  const parts = [model.contextWindow ? t('fmt.context', { size: tokensLabel(model.contextWindow) }) : t('fmt.defaultContext')];
  if (model.maxTokens) parts.push(t('fmt.output', { size: tokensLabel(model.maxTokens) }));
  const cost = costLabel(model.cost);
  if (cost) parts.push(cost);
  if (model.reasoning) parts.push(t('fmt.reasoning'));
  if (model.input?.includes('image')) parts.push(t('fmt.imageInput'));
  return parts.join(' · ');
}

/** Relative time for metadata freshness. */
export function agoLabel(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return t('fmt.justNow');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('fmt.minutesAgo', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('fmt.hoursAgo', { n: hours });
  return t('fmt.daysAgo', { n: Math.round(hours / 24) });
}

export const API_LABELS: Record<string, string> = {
  'openai-completions': 'OpenAI Chat Completions',
  'openai-responses': 'OpenAI Responses',
  'anthropic-messages': 'Anthropic Messages',
  'google-generative-ai': 'Google Generative AI',
};
