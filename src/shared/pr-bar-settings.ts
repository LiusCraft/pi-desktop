export const PR_BAR_PLACEMENTS = ['composer', 'overview'] as const;
export const PR_BAR_CAPABILITIES = ['fixCi', 'resolveConflicts', 'addressComments', 'autoMerge'] as const;
export const PR_BAR_INTERVALS = {
  fastSeconds: { min: 10, max: 300, default: 15 },
  slowSeconds: { min: 15, max: 1800, default: 60 },
  idleSeconds: { min: 60, max: 3600, default: 300 },
  backoffSeconds: { min: 60, max: 3600, default: 300 },
} as const;

export type PrBarCapability = (typeof PR_BAR_CAPABILITIES)[number];
export type PrBarInterval = keyof typeof PR_BAR_INTERVALS;
export type PrBarSettings = Record<PrBarCapability, boolean> &
  Record<PrBarInterval, number> & {
    enabled: boolean;
    placement: (typeof PR_BAR_PLACEMENTS)[number];
    watchInactive: boolean;
  };

export const DEFAULT_PR_BAR: PrBarSettings = {
  enabled: true,
  placement: 'composer',
  fixCi: true,
  resolveConflicts: true,
  addressComments: true,
  autoMerge: true,
  watchInactive: true,
  fastSeconds: PR_BAR_INTERVALS.fastSeconds.default,
  slowSeconds: PR_BAR_INTERVALS.slowSeconds.default,
  idleSeconds: PR_BAR_INTERVALS.idleSeconds.default,
  backoffSeconds: PR_BAR_INTERVALS.backoffSeconds.default,
};

export function normalizePrBar(value?: Partial<PrBarSettings> | null): PrBarSettings {
  const next = { ...DEFAULT_PR_BAR };
  for (const key of ['enabled', 'watchInactive', ...PR_BAR_CAPABILITIES] as const) {
    const flag = value?.[key];
    if (typeof flag === 'boolean') next[key] = flag;
  }
  if (value?.placement === 'overview') next.placement = 'overview';
  for (const key of Object.keys(PR_BAR_INTERVALS) as PrBarInterval[]) {
    const n = value?.[key];
    const { min, max } = PR_BAR_INTERVALS[key];
    if (typeof n === 'number' && Number.isFinite(n)) next[key] = Math.min(max, Math.max(min, Math.round(n)));
  }
  next.slowSeconds = Math.max(next.fastSeconds, next.slowSeconds);
  next.backoffSeconds = Math.max(next.slowSeconds, next.backoffSeconds);
  return next;
}

export const allowsPrRepair = (settings: PrBarSettings) =>
  settings.enabled && (settings.fixCi || settings.resolveConflicts || settings.addressComments);
