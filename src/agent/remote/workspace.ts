// The project and Work-folder lists, and the folder browser, that a remote client needs from the machine
// that serves it. The Desktop keeps the same lists for its own window; a plain pi has no UI to keep them,
// so this is where they live there.
import fs from 'node:fs';
import path from 'node:path';
import type { Project } from '@shared/protocol';
import type { RemoteListing, RemoteWorkspaceMethod } from '@shared/remote';
import { expandHome } from '../app-paths';
import { localPath } from '../local-path';
import type { Store } from '../store';

const WORK_FOLDER_LIMIT = 12;

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

  /** Work folders the user has worked in, most recent first. */
  workFolders(): Project[] {
    return this.store.get<Project[]>('workFolders', []).filter(this.exists);
  }
  addWorkFolder(dir: string): Project {
    const list = this.store.get<Project[]>('workFolders', []).filter((p) => p.path !== dir);
    const folder = { path: dir, name: path.basename(dir), addedAt: Date.now() };
    this.store.set('workFolders', [folder, ...list].slice(0, WORK_FOLDER_LIMIT));
    return folder;
  }
  removeWorkFolder(dir: string): Project[] {
    this.store.set('workFolders', this.store.get<Project[]>('workFolders', []).filter((p) => p.path !== dir));
    return this.workFolders();
  }
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

/** Answer the workspace calls of a remote client from one project book. */
export function workspaceCall(book: ProjectBook, method: RemoteWorkspaceMethod, args: unknown[]): unknown {
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
    case 'remote:browse': return browse(args[0]);
  }
}
