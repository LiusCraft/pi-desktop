// Update checks read GitHub's releases; the pure parts (versions, asset choice, newest-wins) are covered here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkForUpdate, downloadInstaller, pickAsset } from '../src/main/updater';
import { compareVersions, parseVersion } from '../src/shared/update';

const asset = (name: string, size = 3) => ({ name, browser_download_url: `https://dl/${name}`, size });
const release = (tag: string, extra: object = {}) => ({
  tag_name: tag,
  name: tag,
  body: `notes ${tag}`,
  html_url: `https://gh/${tag}`,
  published_at: '2026-01-01T00:00:00Z',
  draft: false,
  prerelease: false,
  assets: [asset(`Pi-Desktop-${tag.slice(1)}-win-x64-setup.exe`), asset(`Pi-Desktop-${tag.slice(1)}-arm64.dmg`)],
  ...extra,
});
const fetchOf =
  (body: unknown, status = 200) =>
  async () =>
    new Response(JSON.stringify(body), { status });

describe('versions', () => {
  it('parses plain semver only', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('1.2.3-beta')).toBeNull();
  });
  it('compares numerically, not as text', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });
});

describe('pickAsset', () => {
  const assets = [
    asset('Pi-Desktop-1.0.0-win-x64-setup.exe'),
    asset('Pi-Desktop-1.0.0-arm64.dmg'),
    asset('Pi-Desktop-1.0.0-x64.dmg'),
    asset('SHA256SUMS.txt'),
  ];
  it.each([
    ['win32', 'x64', 'Pi-Desktop-1.0.0-win-x64-setup.exe'],
    ['darwin', 'arm64', 'Pi-Desktop-1.0.0-arm64.dmg'],
    ['darwin', 'x64', 'Pi-Desktop-1.0.0-x64.dmg'],
  ])('%s/%s', (platform, arch, name) => expect(pickAsset(assets, platform, arch)?.name).toBe(name));
  it('has no installer on linux', () => expect(pickAsset(assets, 'linux', 'x64')).toBeNull());
});

describe('checkForUpdate', () => {
  it('reports the newest release when it is newer, skipping drafts and prereleases', async () => {
    const body = [
      release('v0.3.0', { draft: true }),
      release('v0.2.0'),
      release('v0.1.5', { prerelease: true }),
      release('v0.1.0'),
    ];
    const result = await checkForUpdate('0.1.0', fetchOf(body), 'win32', 'x64');
    expect(result.releases.map((r) => r.version)).toEqual(['0.2.0', '0.1.0']);
    expect(result.available?.version).toBe('0.2.0');
    expect(result.available?.asset?.name).toMatch(/win-x64-setup\.exe$/);
  });
  it('is up to date on the newest version', async () => {
    expect((await checkForUpdate('0.2.0', fetchOf([release('v0.2.0')]))).available).toBeNull();
  });
  it('surfaces an API failure', async () => {
    await expect(checkForUpdate('0.1.0', fetchOf({}, 403))).rejects.toThrow(/403/);
  });
});

describe('downloadInstaller', () => {
  const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'update-'));
  const target = { name: 'a.exe', url: 'https://dl/a.exe', size: 3 };
  it('writes the file and reports progress', async () => {
    const seen: number[] = [];
    const file = await downloadInstaller(
      target,
      dir(),
      async () => new Response(new Uint8Array([1, 2, 3])),
      (p) => seen.push(p.received),
    );
    expect(fs.readFileSync(file)).toEqual(Buffer.from([1, 2, 3]));
    expect(seen.at(-1)).toBe(3);
  });
  it('removes a truncated download', async () => {
    const d = dir();
    await expect(
      downloadInstaller(
        target,
        d,
        async () => new Response(new Uint8Array([1])),
        () => {},
      ),
    ).rejects.toThrow(/incomplete/);
    expect(fs.existsSync(path.join(d, 'a.exe'))).toBe(false);
  });
});
