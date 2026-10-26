// Background side requests (session naming, next-message prediction) run on a
// cheap model of the session's own provider. Sharing the provider keeps
// credentials (and model availability) a given; cost decides which one is small.
import type { ModelInfo } from '@shared/protocol';

export type SideModelCandidate = Pick<ModelInfo, 'provider' | 'id' | 'cost' | 'contextWindow'> & { type?: string };

export function pickSideModel(models: readonly SideModelCandidate[], current: string | null | undefined) {
  const list = (models || []).filter((m) => (!m.type || m.type === 'chat') && m.provider !== 'demo');
  if (!list.length) return null;
  const provider = current ? String(current).split('/')[0] : null;
  const same = provider ? list.filter((m) => m.provider === provider) : [];
  const pool = same.length ? same : list;
  const score = (m: SideModelCandidate) => {
    const input = Number(m.cost?.input) || 0;
    const output = Number(m.cost?.output) || 0;
    // Names like haiku/mini/flash only break ties between equally priced models.
    const small = /(haiku|mini|nano|flash|lite|small|fast|turbo)/i.test(m.id || '') ? -1e-6 : 0;
    return input * 0.25 + output + small;
  };
  const best = [...pool].sort((a, b) => score(a) - score(b) || (a.contextWindow || 0) - (b.contextWindow || 0))[0];
  return best ? `${best.provider}/${best.id}` : null;
}
