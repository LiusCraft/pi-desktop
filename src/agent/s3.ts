/**
 * A minimal S3 client: AWS Signature V4 over `fetch`, just the three calls publishing needs
 * (PutObject, DeleteObject, a one-key ListObjectsV2 to test the connection). Written out here
 * instead of pulling in the AWS SDK, which is far larger than the host process otherwise needs.
 */
import { createHash, createHmac } from 'node:crypto';

export interface S3Target {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  pathStyle: boolean;
}

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const REQUEST_TIMEOUT_MS = 60_000;
export const EMPTY_PAYLOAD_SHA256 = createHash('sha256').update('').digest('hex');

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();
/** RFC 3986 encoding, which is what SigV4 wants (encodeURIComponent leaves ! ' ( ) * alone). */
const encode = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export interface SignInput {
  method: string;
  url: URL;
  /** Every header that is sent and should be signed (names in any case); `host` is added when missing. */
  headers: Record<string, string>;
  payloadHash: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** `YYYYMMDDTHHMMSSZ` */
  amzDate: string;
}

/** The `Authorization` header value for a request. */
export function signV4(i: SignInput): string {
  const headers: Record<string, string> = { host: i.url.host };
  for (const [k, v] of Object.entries(i.headers)) headers[k.toLowerCase()] = v.trim().replace(/\s+/g, ' ');
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalUri =
    i.url.pathname
      .split('/')
      .map((seg) => encode(decodeURIComponent(seg)))
      .join('/') || '/';
  const canonicalQuery = [...i.url.searchParams.entries()]
    .map(([k, v]) => [encode(k), encode(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonical = [i.method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, i.payloadHash].join('\n');
  const day = i.amzDate.slice(0, 8);
  const scope = `${day}/${i.region}/${SERVICE}/aws4_request`;
  const toSign = [ALGORITHM, i.amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${i.secretAccessKey}`, day), i.region), SERVICE), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return `${ALGORITHM} Credential=${i.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

const amzDateNow = () => new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');

/** URL of an object (or of the bucket when `key` is empty). */
export function objectUrl(t: S3Target, key = ''): URL {
  const base = new URL(t.endpoint.includes('://') ? t.endpoint : `https://${t.endpoint}`);
  const path = key.split('/').map(encode).join('/');
  if (t.pathStyle) {
    base.pathname = `${base.pathname.replace(/\/+$/, '')}/${encode(t.bucket)}${key ? `/${path}` : ''}`;
  } else {
    base.hostname = `${t.bucket}.${base.hostname}`;
    base.pathname = `${base.pathname.replace(/\/+$/, '')}${key ? `/${path}` : '/'}`;
  }
  return base;
}

async function request(
  t: S3Target,
  method: string,
  url: URL,
  body?: Buffer,
  extra: Record<string, string> = {},
): Promise<Response> {
  const payloadHash = body ? sha256(body) : EMPTY_PAYLOAD_SHA256;
  const amzDate = amzDateNow();
  const headers: Record<string, string> = { ...extra, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const authorization = signV4({
    method,
    url,
    headers,
    payloadHash,
    region: t.region,
    accessKeyId: t.accessKeyId,
    secretAccessKey: t.secretAccessKey,
    amzDate,
  });
  const res = await fetch(url, {
    method,
    headers: { ...headers, authorization },
    body: body ? new Uint8Array(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.ok) return res;
  throw new Error(await describeFailure(res));
}

/** The service's own message (S3 answers with a small XML document), not just the status line. */
async function describeFailure(res: Response): Promise<string> {
  const body = await res.text().catch(() => '');
  const code = /<Code>([^<]*)<\/Code>/.exec(body)?.[1];
  const message = /<Message>([^<]*)<\/Message>/.exec(body)?.[1];
  const detail = [code, message].filter(Boolean).join(': ');
  return `Storage answered ${res.status}${detail ? ` (${detail})` : res.statusText ? ` (${res.statusText})` : ''}`;
}

export async function putObject(t: S3Target, key: string, body: Buffer, contentType: string): Promise<void> {
  await request(t, 'PUT', objectUrl(t, key), body, { 'content-type': contentType });
}

export async function deleteObject(t: S3Target, key: string): Promise<void> {
  await request(t, 'DELETE', objectUrl(t, key));
}

/** Lists at most one key: proves the endpoint, bucket and credentials work together. */
export async function checkBucket(t: S3Target): Promise<void> {
  const url = objectUrl(t);
  url.searchParams.set('list-type', '2');
  url.searchParams.set('max-keys', '1');
  await request(t, 'GET', url);
}

const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  webm: 'video/webm',
  pdf: 'application/pdf',
  wasm: 'application/wasm',
};
export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[file.slice(file.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';
}
