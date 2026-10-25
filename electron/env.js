// Environment for every child process we spawn (pi, git, gh, the terminal).
//
// A GUI launch on macOS inherits launchd's PATH — /usr/bin:/bin:/usr/sbin:/sbin —
// so Homebrew's git, or a gh/rg/fd installed by it, would look "missing" even
// though a terminal finds them. Append the usual install prefixes once.
const path = require('node:path');
const os = require('node:os');

const EXTRA_PATHS = process.platform === 'darwin'
  ? [
    '/opt/homebrew/bin', // Apple Silicon Homebrew
    '/opt/homebrew/sbin',
    '/usr/local/bin', // Intel Homebrew, and most manual installers
    '/usr/local/sbin',
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.pi', 'bin'), // pi downloads fd here
  ]
  : [];

function childEnv(extra = {}) {
  const parts = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of EXTRA_PATHS) if (!parts.includes(dir)) parts.push(dir);
  return { ...process.env, ...extra, PATH: parts.join(path.delimiter) };
}

module.exports = { childEnv, EXTRA_PATHS };
