/**
 * `pidesk_web_fetch`: download one http(s) page and hand the model readable text. Only public
 * hosts are reachable (no loopback, LAN or link-local addresses), every redirect is checked again,
 * and a page is read up to a size cap, so a model-chosen URL cannot reach into the user's network.
 */
import dns from 'node:dns/promises';
import net from 'node:net';
import { WEB_LIMITS } from '@shared/web-search';

const USER_AGENT = 'Mozilla/5.0 (compatible; PiDesktop/1.0; +https://github.com/LiusCraft/pi-desktop)';

export interface FetchedPage {
  url: string;
  title: string;
  /** The whole page as text, before paging. */
  text: string;
}

// ------------------------------------------------------------ address checks

function privateV4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return privateV4(ip);
  const v6 = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return privateV4(mapped[1]);
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

async function assertPublic(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`Only http and https URLs can be fetched, not ${url.protocol}`);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error(`${url.hostname} is not a public address, so it cannot be fetched`);
}

// ------------------------------------------------------------ html to text

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', copy: '©', laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function htmlToText(html: string, base?: string): { title: string; text: string } {
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim();
  const absolute = (href: string) => {
    try { return new URL(href, base).href; } catch { return href; }
  };
  const text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|template|head|iframe|nav|footer)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\b[^>]*?href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
      const label = inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      return label && !/^(javascript|mailto|tel):/i.test(href) ? `[${label}](${absolute(decode(href))})` : label;
    })
    .replace(/<h([1-6])\b[^>]*>/gi, (_m, n: string) => `\n\n${'#'.repeat(Number(n))} `)
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|main|header|tr|ul|ol|table|blockquote|pre|h[1-6])>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');
  return {
    title,
    text: decode(text).replace(/[ \t\f\v]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
  };
}

// ------------------------------------------------------------ download

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < WEB_LIMITS.pageBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  void reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString('utf8');
}

export async function fetchPage(rawUrl: string, signal?: AbortSignal): Promise<FetchedPage> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error(`Not a valid URL: ${rawUrl}`); }
  const timeout = AbortSignal.timeout(WEB_LIMITS.timeoutMs);
  const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
  for (let hop = 0; hop <= WEB_LIMITS.redirects; hop++) {
    await assertPublic(url);
    const res = await fetch(url, {
      redirect: 'manual', signal: abort,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5' },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error(`HTTP ${res.status} without a Location header`);
      url = new URL(location, url);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const body = await readCapped(res);
    if (/html|xml/.test(type) || (!type && /^\s*</.test(body))) {
      const page = htmlToText(body, url.href);
      return { url: url.href, ...page };
    }
    if (type.startsWith('text/') || /json|javascript|yaml|csv/.test(type)) return { url: url.href, title: '', text: body.trim() };
    throw new Error(`Cannot read ${type || 'this'} content (only web pages and text)`);
  }
  throw new Error(`Too many redirects (more than ${WEB_LIMITS.redirects})`);
}
