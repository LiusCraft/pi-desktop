/**
 * Skills that ship with the app. They are written into `~/.pi-desktop/skills` on start and refreshed
 * when the app updates, then handed to every session as an extra skill path — so they work in every
 * project without touching pi's own folders (`~/.pi/agent/skills`).
 */
import fs from 'node:fs';
import path from 'node:path';
import pluginAuthor from './skills/plugin-author/SKILL.md?raw';

const BUILTIN: { dir: string; content: string }[] = [{ dir: 'plugin-author', content: pluginAuthor }];

/** Write (or refresh) the built-in skills under `root`; a file that already matches is left alone. */
export function writeBuiltinSkills(root: string) {
  for (const skill of BUILTIN) {
    const dir = path.join(root, skill.dir);
    const file = path.join(dir, 'SKILL.md');
    try {
      if (fs.readFileSync(file, 'utf8') === skill.content) continue;
    } catch {
      // Not written yet.
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, skill.content, 'utf8');
  }
}
