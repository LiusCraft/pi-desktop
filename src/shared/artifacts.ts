/**
 * Artifacts: web pages (or small sites) the model builds for the user. They live in the app's data
 * folder and open in a preview window; publishing them to the user's own S3-compatible bucket (see
 * `@shared/storage`) is what turns one into a link others can open, so only that step needs it.
 */

/** The page an artifact opens on; a single-file artifact is stored under this name. */
export const ARTIFACT_ENTRY = 'index.html';
/** Folder (inside an artifact's own folder) that holds the files that get previewed and published. */
export const ARTIFACT_SITE_DIR = 'site';

export const ARTIFACT_LIMITS = {
  /** Files in one artifact. */
  files: 100,
  /** Size of one file, bytes. */
  fileBytes: 10 * 1024 * 1024,
  /** Size of the whole artifact, bytes. */
  totalBytes: 50 * 1024 * 1024,
  title: 80,
} as const;

/** Folder and file names a directory artifact never takes along. */
export const ARTIFACT_SKIP = ['node_modules', '.git', '.DS_Store'] as const;

/** Screenshot (kept beside the site, never uploaded): `<id>/thumbnail-<version>.jpg`. */
export const ARTIFACT_THUMBNAIL = {
  width: 1280,
  height: 800,
  scaledWidth: 640,
  quality: 80,
  settleMs: 700,
  timeoutMs: 15_000,
} as const;
export const artifactThumbnailName = (version: number) => `thumbnail-${version}.jpg`;

export const ARTIFACT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface ArtifactMeta {
  id: string;
  title: string;
  /** Paths inside the artifact, forward slashes, sorted. */
  files: string[];
  bytes: number;
  /** Bumped on every save, so an edited page can be told apart from the published one. */
  version: number;
  createdAt: number;
  updatedAt: number;
  /** The version last uploaded, or null while it has never been published. */
  publishedVersion: number | null;
  publishedAt: number | null;
  publishedUrl: string | null;
  /** What is in the bucket right now, to remove files an update no longer has. */
  publishedFiles: string[];
}

/** Folder of the bucket (inside the app's prefix) that published artifacts live in. */
export const ARTIFACT_STORAGE_FOLDER = 'artifacts';
/** Key of one file of an artifact in the bucket. */
export const artifactKey = (id: string, file: string) => `${ARTIFACT_STORAGE_FOLDER}/${id}/${file}`;

export type ArtifactPublishState = 'draft' | 'published' | 'outdated';
export function publishState(a: Pick<ArtifactMeta, 'version' | 'publishedVersion'>): ArtifactPublishState {
  if (a.publishedVersion === null) return 'draft';
  return a.publishedVersion === a.version ? 'published' : 'outdated';
}
