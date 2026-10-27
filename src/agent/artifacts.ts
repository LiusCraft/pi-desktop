/**
 * Artifacts: `<app data>/artifacts/<id>/artifact.json` plus the files in `<id>/site/`.
 * The model's `pidesk_artifact_*` tools and the Settings page both go through this service,
 * so what is saved, previewed and published is the same everywhere. Previewing needs nothing
 * else; publishing goes through the app's object storage (`./storage.ts`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  ARTIFACT_ENTRY, ARTIFACT_ID_PATTERN, ARTIFACT_LIMITS, ARTIFACT_SITE_DIR, ARTIFACT_SKIP, artifactKey, type ArtifactMeta,
} from '@shared/artifacts';
import { appArtifactsDir } from './app-paths';
import type { ObjectStorage } from './storage';

const META_FILE = 'artifact.json';

export interface SaveArtifactInput {
  /** Update this artifact instead of creating a new one. */
  id?: string;
  title?: string;
  /** An HTML file, or a folder that has an index.html. */
  source: string;
}

const slug = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** Everything under `dir` as forward-slash relative paths; throws when it is too big to be an artifact. */
function walk(dir: string, rel = '', out: { rel: string; size: number }[] = []) {
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    if ((ARTIFACT_SKIP as readonly string[]).includes(entry.name)) continue;
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    // Links could point anywhere on the machine: only real files and folders are taken.
    if (entry.isDirectory()) walk(dir, r, out);
    else if (entry.isFile()) out.push({ rel: r, size: fs.statSync(path.join(dir, r)).size });
    if (out.length > ARTIFACT_LIMITS.files) throw new Error(`An artifact can have at most ${ARTIFACT_LIMITS.files} files`);
  }
  return out;
}

export class ArtifactService {
  constructor(private readonly dataDir: string, private readonly storage: ObjectStorage) {}

  private get root() {
    return appArtifactsDir(this.dataDir);
  }
  private folder(id: string) {
    if (!ARTIFACT_ID_PATTERN.test(id)) throw new Error(`Invalid artifact id "${id}"`);
    return path.join(this.root, id);
  }
  /** Folder whose files are previewed and uploaded. */
  siteDir(id: string) {
    return path.join(this.folder(id), ARTIFACT_SITE_DIR);
  }
  private metaFile(id: string) {
    return path.join(this.folder(id), META_FILE);
  }

  // ---------------------------------------------------------------- artifacts

  list(): ArtifactMeta[] {
    let ids: string[];
    try {
      ids = fs.readdirSync(this.root);
    } catch {
      return [];
    }
    const out: ArtifactMeta[] = [];
    for (const id of ids) {
      const meta = this.find(id);
      if (meta) out.push(meta);
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  find(id: string): ArtifactMeta | null {
    try {
      const meta = JSON.parse(fs.readFileSync(this.metaFile(id), 'utf8')) as ArtifactMeta;
      return meta.id === id ? meta : null;
    } catch {
      return null;
    }
  }

  get(id: string): ArtifactMeta {
    const meta = this.find(id);
    if (!meta) throw new Error(`No artifact ${id} (pidesk_artifact_list shows them)`);
    return meta;
  }

  private write(meta: ArtifactMeta) {
    const file = this.metaFile(meta.id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(meta, null, 2));
    fs.renameSync(`${file}.tmp`, file);
  }

  /** Copy a page (or site folder) in as a new artifact, or as the next version of `input.id`. */
  save(input: SaveArtifactInput): ArtifactMeta {
    const source = path.resolve(input.source);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(source);
    } catch {
      throw new Error(`Cannot find ${input.source}`);
    }
    // One list of what to copy: [path inside the artifact, absolute path of the source].
    let files: { rel: string; abs: string; size: number }[];
    if (stat.isDirectory()) {
      if (!fs.existsSync(path.join(source, ARTIFACT_ENTRY))) throw new Error(`${input.source} has no ${ARTIFACT_ENTRY}; an artifact folder needs one`);
      files = walk(source).map((f) => ({ ...f, abs: path.join(source, f.rel) }));
    } else {
      if (!/\.html?$/i.test(source)) throw new Error(`${input.source} is not an HTML file`);
      files = [{ rel: ARTIFACT_ENTRY, abs: source, size: stat.size }];
    }
    const total = files.reduce((n, f) => n + f.size, 0);
    const big = files.find((f) => f.size > ARTIFACT_LIMITS.fileBytes);
    if (big) throw new Error(`${big.rel} is over ${ARTIFACT_LIMITS.fileBytes / 1024 / 1024} MB`);
    if (total > ARTIFACT_LIMITS.totalBytes) throw new Error(`An artifact can be at most ${ARTIFACT_LIMITS.totalBytes / 1024 / 1024} MB`);

    const existing = input.id ? this.get(input.id) : null;
    const title = (input.title ?? existing?.title ?? path.basename(source, path.extname(source))).trim().slice(0, ARTIFACT_LIMITS.title) || 'Untitled';
    const id = existing?.id ?? this.newId(title);

    const site = this.siteDir(id);
    fs.rmSync(site, { recursive: true, force: true });
    for (const f of files) {
      const dest = path.join(site, f.rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(f.abs, dest);
    }
    const now = Date.now();
    const meta: ArtifactMeta = {
      id, title, files: files.map((f) => f.rel).sort(), bytes: total,
      version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
      publishedVersion: existing?.publishedVersion ?? null, publishedAt: existing?.publishedAt ?? null,
      publishedUrl: existing?.publishedUrl ?? null, publishedFiles: existing?.publishedFiles ?? [],
    };
    this.write(meta);
    return meta;
  }

  private newId(title: string) {
    for (;;) {
      const id = `${slug(title) || 'artifact'}-${randomBytes(2).toString('hex')}`;
      if (!fs.existsSync(this.folder(id))) return id;
    }
  }

  /** Delete locally; with `unpublish` the uploaded copy goes too (a failure there keeps the local one). */
  async remove(id: string, unpublish = true) {
    const meta = this.get(id);
    if (unpublish && meta.publishedFiles.length) await this.unpublish(id);
    fs.rmSync(this.folder(id), { recursive: true, force: true });
  }

  // ---------------------------------------------------------------- publishing

  /** Upload the current version, drop files the previous publish had and this one does not, and return the page's URL. */
  async publish(id: string): Promise<ArtifactMeta> {
    const meta = this.get(id);
    const site = this.siteDir(id);
    // Asks for the configuration first: nothing is read or sent while the storage is not set up.
    const url = this.storage.url(artifactKey(id, ARTIFACT_ENTRY));
    for (const file of meta.files) await this.storage.put(artifactKey(id, file), fs.readFileSync(path.join(site, file)));
    // Best effort: a leftover file in the bucket must not fail a publish that otherwise worked.
    for (const old of meta.publishedFiles.filter((f) => !meta.files.includes(f))) await this.storage.remove(artifactKey(id, old)).catch(() => {});
    const next: ArtifactMeta = { ...meta, publishedVersion: meta.version, publishedAt: Date.now(), publishedUrl: url, publishedFiles: [...meta.files] };
    this.write(next);
    return next;
  }

  /** Take the uploaded copy down; the local artifact stays. */
  async unpublish(id: string): Promise<ArtifactMeta> {
    const meta = this.get(id);
    for (const file of meta.publishedFiles) await this.storage.remove(artifactKey(id, file));
    const next: ArtifactMeta = { ...meta, publishedVersion: null, publishedAt: null, publishedUrl: null, publishedFiles: [] };
    this.write(next);
    return next;
  }
}
