// Small JSON store in Pi Desktop's own data directory (atomic writes).
import fs from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }
  file(name: string) {
    return path.join(this.dir, `${name}.json`);
  }
  get<T>(name: string, fallback: T): T {
    try {
      return JSON.parse(fs.readFileSync(this.file(name), 'utf8')) as T;
    } catch {
      return fallback;
    }
  }
  set(name: string, value: unknown) {
    const tmp = this.file(name) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, this.file(name));
  }
}
