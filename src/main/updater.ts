// Checks the project's GitHub releases and fetches the installer of a newer one. Nothing is installed silently:
// Windows runs the downloaded setup (the app quits for it), macOS opens the dmg for the user to drag in.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  compareVersions, parseVersion, UPDATE_HISTORY_LIMIT, UPDATE_RELEASES_URL,
  type ReleaseAsset, type ReleaseNote, type UpdateCheck, type UpdateProgress,
} from '@shared/update';

export type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

interface GithubAsset { name: string; browser_download_url: string; size: number }
interface GithubRelease { tag_name: string; name: string | null; body: string | null; html_url: string; published_at: string | null; draft: boolean; prerelease: boolean; assets: GithubAsset[] }

/** The installer names `electron-builder.yml` produces: `-<arch>.dmg` on macOS, `-win-<arch>-setup.exe` on Windows. */
export function installerPattern(platform: string, arch: string): RegExp | null {
  if (platform === 'darwin') return new RegExp(`-${arch}\\.dmg$`);
  if (platform === 'win32') return new RegExp(`-win-${arch}-setup\\.exe$`);
  return null;
}

export function pickAsset(assets: GithubAsset[], platform: string, arch: string): ReleaseAsset | null {
  const pattern = installerPattern(platform, arch);
  const hit = pattern && assets.find((a) => pattern.test(a.name));
  return hit ? { name: hit.name, url: hit.browser_download_url, size: hit.size } : null;
}

export function toReleaseNote(release: GithubRelease, platform: string, arch: string): ReleaseNote | null {
  if (!parseVersion(release.tag_name) || release.draft || release.prerelease) return null;
  return {
    version: release.tag_name.replace(/^v/, ''),
    name: release.name || release.tag_name,
    notes: (release.body ?? '').trim(),
    url: release.html_url,
    publishedAt: release.published_at ?? '',
    asset: pickAsset(release.assets, platform, arch),
  };
}

export async function checkForUpdate(current: string, fetchFn: Fetch, platform = process.platform, arch = process.arch): Promise<UpdateCheck> {
  const res = await fetchFn(`${UPDATE_RELEASES_URL}?per_page=${UPDATE_HISTORY_LIMIT}`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const raw = (await res.json()) as GithubRelease[];
  const releases = raw
    .map((r) => toReleaseNote(r, platform, arch))
    .filter((r): r is ReleaseNote => r !== null)
    .sort((a, b) => compareVersions(b.version, a.version));
  const newest = releases[0];
  return { current, releases, available: newest && compareVersions(newest.version, current) > 0 ? newest : null };
}

/** Stream the asset into `dir`, reporting progress; a size mismatch means a cut-off download and removes the file. */
export async function downloadInstaller(asset: ReleaseAsset, dir: string, fetchFn: Fetch, onProgress: (p: UpdateProgress) => void): Promise<string> {
  const res = await fetchFn(asset.url);
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, path.basename(asset.name));
  const total = asset.size || Number(res.headers.get('content-length')) || 0;
  let received = 0;
  const source = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  source.on('data', (chunk: Buffer) => {
    received += chunk.length;
    onProgress({ stage: 'downloading', received, total });
  });
  try {
    await pipeline(source, fs.createWriteStream(dest));
    if (asset.size && received !== asset.size) throw new Error(`Download incomplete: ${received} of ${asset.size} bytes`);
  } catch (err) {
    fs.rmSync(dest, { force: true });
    throw err;
  }
  return dest;
}
