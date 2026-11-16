// Update checking: the GitHub releases of the project are the source of truth. The release workflow names
// its assets by platform, and every release body (the "changes") is shown before anything is downloaded.

export const UPDATE_REPO = 'liuscraft/pi-desktop';
export const UPDATE_RELEASES_URL = `https://api.github.com/repos/${UPDATE_REPO}/releases`;
/** How many past releases the changes list covers. */
export const UPDATE_HISTORY_LIMIT = 20;
/** Delay after launch before the first automatic check, and the gap between later ones. */
export const UPDATE_FIRST_CHECK_MS = 10_000;
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}
export interface ReleaseNote {
  version: string;
  name: string;
  /** Markdown body of the GitHub release. */
  notes: string;
  /** Release page. */
  url: string;
  publishedAt: string;
  /** The installer for this machine, when the release carries one. */
  asset: ReleaseAsset | null;
}
export interface UpdateCheck {
  current: string;
  /** Newest release first. */
  releases: ReleaseNote[];
  /** The newest release when it is newer than the running app. */
  available: ReleaseNote | null;
}

export type UpdateStage = 'downloading' | 'launching';
export interface UpdateProgress {
  stage: UpdateStage;
  received: number;
  total: number;
}

type Triple = [number, number, number];

/** `v1.2.3` / `1.2.3` → [1, 2, 3]; anything else (including pre-release suffixes) is not a version. */
export function parseVersion(text: string): Triple | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Positive when `a` is newer than `b`; 0 when equal or either is not a version. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}
