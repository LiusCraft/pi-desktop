#!/usr/bin/env node
// `make help` without grep/awk, so it also works where make falls back to cmd.exe (PowerShell).
import fs from 'node:fs';

const makefile = process.argv[2] ?? 'Makefile';
const rows = [];
for (const line of fs.readFileSync(makefile, 'utf8').split(/\r?\n/)) {
  const m = /^([a-z-]+):.*?## (.*)$/.exec(line);
  if (m) rows.push(m);
}
const width = Math.max(10, ...rows.map((m) => m[1].length));
for (const [, name, text] of rows) console.log(`  \x1b[36m${name.padEnd(width)}\x1b[0m ${text}`);
