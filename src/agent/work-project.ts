// What a Work project adds to every turn of its sessions: the user's instructions, links and the notes
// the model keeps. Read fresh at the start of each turn, so an edit on the Projects page applies at once.
import { PROJECT_LIMITS, type WorkProject } from '@shared/protocol';
import type { ProjectBook } from './remote/workspace';

/** The system-prompt section for a project, or null when it holds nothing worth saying. */
export function projectContext(p: WorkProject | undefined): string | null {
  if (!p) return null;
  const parts: string[] = [];
  if (p.description?.trim()) parts.push(`## About this project\n${p.description.trim()}`);
  if (p.instructions?.trim()) parts.push(`## Instructions from the user (apply to every task in this project)\n${p.instructions.trim()}`);
  if (p.links?.length) parts.push(`## Reference links\n${p.links.map((l) => `- ${l.title ? `${l.title}: ` : ''}${l.url}`).join('\n')}`);
  parts.push(
    `## Project memory\n${p.memory?.trim() || '(empty)'}\n\n` +
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
