// What a Work project adds to every turn of its sessions: the user's instructions, links and the notes
// the model keeps. Read fresh at the start of each turn, so an edit on the Projects page applies at once.
import { PROJECT_LIMITS, type WorkProject, type WorkProjectPatch } from '@shared/protocol';
import type { ProjectBook } from './remote/workspace';

/** What the model may change on a project: the Projects page fields, minus the memory `pidesk_remember` owns. */
export type ProjectEdit = Pick<WorkProjectPatch, 'name' | 'description' | 'instructions' | 'links'>;

/** The system-prompt section for a project, or null when it holds nothing worth saying. */
export function projectContext(p: WorkProject | undefined): string | null {
  if (!p) return null;
  const parts: string[] = [];
  if (p.description?.trim()) parts.push(`## About this project\n${p.description.trim()}`);
  if (p.instructions?.trim()) parts.push(`## Instructions from the user (apply to every task in this project)\n${p.instructions.trim()}`);
  if (p.links?.length) parts.push(`## Reference links\n${p.links.map((l) => `- ${l.title ? `${l.title}: ` : ''}${l.url}`).join('\n')}`);
  if (p.codeFolders?.length) {
    parts.push(
      `## Code folders\nThe code of this project lives in:\n${p.codeFolders.map((f) => `- ${f}`).join('\n')}\n\n` +
      'Read them directly when the task needs the code. When you find coding work (a bug, a change, a refactor), do not do it here: ' +
      'offer it with `pidesk_suggest_task` and set `code_folder` to the folder it belongs in, so the user can start it as a Code session there.',
    );
  }
  parts.push(
    `## Project memory\n${p.memory?.trim() || '(empty)'}\n\n` +
    'The instructions, links and memory above are authoritative: use the paths, documents and addresses they name directly, and only search the computer for something they do not cover. ' +
    'Use `pidesk_remember` to save what a later task in this project should know: decisions made, the user\'s preferences, where things live, what is still open. ' +
    'Keep notes short and factual; do not store secrets or things that are obvious from the files.',
  );
  return `# Project: ${p.name}\n\n${parts.join('\n\n')}`;
}

/** Adds one note to the project's memory, or replaces the whole text to tidy it; returns the saved length. */
export function remember(book: ProjectBook, dir: string, input: { note?: string; rewrite?: string }): number {
  const current = book.workFolders().find((p) => p.path === dir)?.memory?.trim() ?? '';
  let next: string;
  if (input.rewrite !== undefined) next = input.rewrite.trim();
  else if (input.note?.trim()) next = `${current ? `${current}\n` : ''}- ${input.note.trim().replace(/\s*\n\s*/g, ' ')}`;
  else throw new Error('Give a note to add, or rewrite with the full tidied memory.');
  if (next.length > PROJECT_LIMITS.memory) {
    throw new Error(`Project memory is full (${PROJECT_LIMITS.memory} characters). Call pidesk_remember again with rewrite set to a shorter version that keeps what matters.`);
  }
  book.updateWorkFolder(dir, { memory: next });
  return next.length;
}

/**
 * Saves what the chat asked to change on a Work project, checking the limits the Projects page enforces first
 * (the book would clip silently). Memory is not part of this: `pidesk_remember` owns it.
 */
export function editProject(book: ProjectBook, dir: string, patch: ProjectEdit): WorkProject {
  const fields = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (!fields.length) throw new Error('Give at least one field to change: name, description, instructions or links.');
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error('The project name cannot be empty.');
    if (name.length > PROJECT_LIMITS.name) throw new Error(`The name is ${name.length} characters; the limit is ${PROJECT_LIMITS.name}.`);
  }
  for (const key of ['description', 'instructions'] as const) {
    const value = patch[key];
    if (value !== undefined && value.length > PROJECT_LIMITS[key]) {
      throw new Error(`The ${key} is ${value.length} characters; the limit is ${PROJECT_LIMITS[key]}. Shorten it first.`);
    }
  }
  if (patch.links !== undefined) {
    if (patch.links.length > PROJECT_LIMITS.links) {
      throw new Error(`A project holds at most ${PROJECT_LIMITS.links} links; ${patch.links.length} were given.`);
    }
    for (const link of patch.links) {
      if (!/^https?:\/\//i.test(link.url)) throw new Error(`"${link.url}" is not an http(s) address.`);
      if (link.url.length > PROJECT_LIMITS.url) throw new Error(`A link URL is longer than ${PROJECT_LIMITS.url} characters.`);
      if ((link.title ?? '').trim().length > PROJECT_LIMITS.name) throw new Error(`A link title is longer than ${PROJECT_LIMITS.name} characters.`);
    }
  }
  book.updateWorkFolder(dir, patch);
  const saved = book.workFolders().find((p) => p.path === dir);
  if (!saved) throw new Error('That folder is not a project.');
  return saved;
}
