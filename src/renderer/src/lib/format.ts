import { t } from './i18n';

export const fname = (p: string) => String(p).split(/[\\/]/).pop() || '';
export const fdir = (p: string) => String(p).split(/[\\/]/).slice(0, -1).join('/');

/** "5m" / "5 minutes ago" in the app's language. */
export function ago(at: number, long = false) {
  const m = Math.round((Date.now() - at) / 60000);
  if (m < 1) return t('ago.justNow');
  if (m < 60) return long ? t(m === 1 ? 'ago.minOne' : 'ago.minOther', { n: m }) : t('ago.minShort', { n: m });
  if (m < 1440) {
    const h = Math.round(m / 60);
    return long ? t(h === 1 ? 'ago.hourOne' : 'ago.hourOther', { n: h }) : t('ago.hourShort', { n: h });
  }
  const d = Math.round(m / 1440);
  return long ? t(d === 1 ? 'ago.dayOne' : 'ago.dayOther', { n: d }) : t('ago.dayShort', { n: d });
}

export function fmtDur(ms: number) {
  const t = Math.round(ms / 1000);
  if (t < 60) return `${t}s`;
  if (t < 3600) return `${Math.floor(t / 60)}m ${t % 60}s`;
  return `${Math.floor(t / 3600)}h ${Math.floor((t % 3600) / 60)}m`;
}

export const fmtTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** A nested tool call's duration: "84ms" / "1.2s". */
export const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`);

/** A model call's cost: cents for normal amounts, two significant digits below one cent. */
export const fmtCost = (cost: number) => `$${cost >= 0.01 ? cost.toFixed(2) : cost.toPrecision(2)}`;

export const sizeLabel = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** A tool path relative to the session folder (tools may report absolute paths). */
export function relPath(cwd: string, p: string) {
  const root = cwd.replace(/\\/g, '/');
  const q = String(p).replace(/\\/g, '/');
  return q.startsWith(root + '/') ? q.slice(root.length + 1) : q.replace(/^\.\//, '');
}
