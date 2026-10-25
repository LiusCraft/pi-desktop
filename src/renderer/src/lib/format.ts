export const fname = (p: string) => String(p).split(/[\\/]/).pop() || '';
export const fdir = (p: string) => String(p).split(/[\\/]/).slice(0, -1).join('/');

export function ago(t: number, long = false) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return long ? `${m} minute${m > 1 ? 's' : ''} ago` : `${m}m`;
  if (m < 1440) {
    const h = Math.round(m / 60);
    return long ? `${h} hour${h > 1 ? 's' : ''} ago` : `${h}h`;
  }
  const d = Math.round(m / 1440);
  return long ? `${d} day${d > 1 ? 's' : ''} ago` : `${d}d`;
}

export function fmtDur(ms: number) {
  const t = Math.round(ms / 1000);
  if (t < 60) return `${t}s`;
  if (t < 3600) return `${Math.floor(t / 60)}m ${t % 60}s`;
  return `${Math.floor(t / 3600)}h ${Math.floor((t % 3600) / 60)}m`;
}

export const fmtTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export const sizeLabel = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** A tool path relative to the session folder (tools may report absolute paths). */
export function relPath(cwd: string, p: string) {
  const root = cwd.replace(/\\/g, '/');
  const q = String(p).replace(/\\/g, '/');
  return q.startsWith(root + '/') ? q.slice(root.length + 1) : q.replace(/^\.\//, '');
}
