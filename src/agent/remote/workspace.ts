// The project and Work-folder lists, and the folder browser, that a remote client needs from the machine
// that serves it. The Desktop keeps the same lists for its own window; a plain pi has no UI to keep them,
// so this is where they live there.
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_LIMITS, type Project, type WorkProject, type WorkProjectPatch } from '@shared/protocol';
import type { RemoteListing, RemoteWorkspaceMethod } from '@shared/remote';
import { expandHome } from '../app-paths';
import { localPath } from '../local-path';
import type { Store } from '../store';

// A Work folder now carries the user's own instructions and notes, so the list is long enough not to drop them.
const WORK_FOLDER_LIMIT = 100;

export class ProjectBook {
  constructor(private readonly store: Store) {}

  private exists = (p: Project) => fs.existsSync(p.path);

  projects(): Project[] {
    return this.store.get<Project[]>('projects', []).filter(this.exists);
  }
  addProject(dir: string): Project {
    const list = this.store.get<Project[]>('projects', []).filter((p) => p.path !== dir);
    const project = { path: dir, name: path.basename(dir), addedAt: Date.now() };
    this.store.set('projects', [project, ...list]);
    return project;
  }
  removeProject(dir: string): Project[] {
    this.store.set('projects', this.store.get<Project[]>('projects', []).filter((p) => p.path !== dir));
    return this.projects();
  }

  /** Work folders (projects) the user has worked in, most recent first. */
  workFolders(): WorkProject[] {
    return this.store.get<WorkProject[]>('workFolders', []).filter(this.exists);
  }
  /** Adds the folder, or moves a known one to the front with its description, instructions and notes intact. */
  addWorkFolder(dir: string): WorkProject {
    const all = this.store.get<WorkProject[]>('workFolders', []);
    const folder = all.find((p) => p.path === dir) ?? { path: dir, name: path.basename(dir), addedAt: Date.now() };
    this.store.set('workFolders', [folder, ...all.filter((p) => p.path !== dir)].slice(0, WORK_FOLDER_LIMIT));
    return folder;
  }
  removeWorkFolder(dir: string): WorkProject[] {
    this.store.set('workFolders', this.store.get<WorkProject[]>('workFolders', []).filter((p) => p.path !== dir));
    return this.workFolders();
  }
  /** Changes what a Work project holds without reordering the list. */
  updateWorkFolder(dir: string, patch: WorkProjectPatch): WorkProject[] {
    const all = this.store.get<WorkProject[]>('workFolders', []);
    const at = all.findIndex((p) => p.path === dir);
    if (at < 0) throw new Error('That folder is not a project.');
    all[at] = applyPatch(all[at], patch);
    this.store.set('workFolders', all);
    return this.workFolders();
  }
}

const clip = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');

function applyPatch(project: WorkProject, patch: WorkProjectPatch): WorkProject {
  const next = { ...project };
  if (patch.name !== undefined) next.name = clip(patch.name, PROJECT_LIMITS.name).trim() || project.name;
  if (patch.description !== undefined) next.description = clip(patch.description, PROJECT_LIMITS.description).trim();
  if (patch.instructions !== undefined) next.instructions = clip(patch.instructions, PROJECT_LIMITS.instructions);
  if (patch.memory !== undefined) next.memory = clip(patch.memory, PROJECT_LIMITS.memory);
  if (patch.links !== undefined) {
    next.links = (Array.isArray(patch.links) ? patch.links : [])
      .map((l) => ({ title: clip(l?.title, PROJECT_LIMITS.name).trim(), url: clip(l?.url, PROJECT_LIMITS.url).trim() }))
      .filter((l) => /^https?:\/\//i.test(l.url))
      .slice(0, PROJECT_LIMITS.links);
  }
  if (patch.codeFolders !== undefined) {
    const folders = (Array.isArray(patch.codeFolders) ? patch.codeFolders : []).map((f) => clip(f, PROJECT_LIMITS.url).trim()).filter(Boolean);
    next.codeFolders = [...new Set(folders)].slice(0, PROJECT_LIMITS.codeFolders);
  }
  return next;
}

/** A folder named by a remote client: absolute (after `~`), and really a folder. */
export function existingFolder(value: unknown): string {
  const raw = typeof value === 'string' ? expandHome(value) : '';
  const abs = path.resolve(localPath(raw));
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error(`${abs} is not a folder on that machine.`);
  return abs;
}

/** The sub-folders of one directory, for picking a project on the other machine. */
export function browse(dir: unknown): RemoteListing {
  const abs = typeof dir === 'string' && dir.trim() ? existingFolder(dir) : existingFolder('~');
  const parent = path.dirname(abs);
  let dirs: RemoteListing['dirs'] = [];
  try {
    dirs = fs.readdirSync(abs, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => ({ name: e.name, path: path.join(abs, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    // An unreadable folder lists as empty; the client can still step back out.
  }
  return { path: abs, parent: parent === abs ? null : parent, dirs };
}

/** What one workspace call answers: a list of projects, one project, or the folder browser's listing. */
export type WorkspaceResult = Project[] | Project | WorkProject[] | WorkProject | RemoteListing | null;

/** Answer the workspace calls of a remote client from one project book. */
export function workspaceCall(book: ProjectBook, method: RemoteWorkspaceMethod, args: unknown[]): WorkspaceResult {
  switch (method) {
    case 'projects:list': return book.projects();
    case 'projects:addPath': return book.addProject(existingFolder(args[0]));
    case 'projects:remove': return book.removeProject(String(args[0]));
    case 'work:folders': return book.workFolders();
    case 'work:addPath': return book.addWorkFolder(existingFolder(args[0]));
    case 'work:useFolder': {
      const dir = String(args[0]);
      return fs.existsSync(dir) ? book.addWorkFolder(dir) : null;
    }
    case 'work:removeFolder': return book.removeWorkFolder(String(args[0]));
    case 'work:update': return book.updateWorkFolder(String(args[0]), (args[1] ?? {}) as WorkProjectPatch);
    case 'remote:browse': return browse(args[0]);
  }
}
