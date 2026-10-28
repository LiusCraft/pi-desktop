// Plain text out of a pseudo-terminal's raw bytes: what a person would have read on screen.
// Kept apart from the pty plumbing so it can be tested without spawning a shell.

/** ANSI escapes, OSC titles and the other control sequences a pty wraps around the text. */
const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()#][0-9A-Za-z]|[=>])/g;

/** The last `lines` lines of output, with no escapes and carriage-return rewrites resolved. */
export function plainText(backlog: string, lines: number): string {
  const rows: string[] = [];
  for (const raw of backlog.replace(ANSI, '').split('\n')) {
    // A carriage return rewrites its line (progress bars): keep what it left.
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const cut = line.lastIndexOf('\r');
    rows.push((cut >= 0 ? line.slice(cut + 1) : line).replace(/\s+$/, ''));
  }
  while (rows.length && !rows[rows.length - 1]) rows.pop();
  return rows.slice(Math.max(0, rows.length - Math.max(1, Math.floor(lines)))).join('\n');
}
