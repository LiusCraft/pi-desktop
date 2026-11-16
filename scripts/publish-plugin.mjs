#!/usr/bin/env node
// Publishes `plugin/pi-remote` at the release tag's version; `release.yml` runs it on a v* tag after
// `npm run build:plugin`. The plugin mirrors the app, so its version is the tag, not its own number:
// `pi install npm:@liuscraft/pi-remote` then always matches the dmg that was released with it. The
// workflow authenticates with trusted publishing (OIDC), so no npm token is stored anywhere.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PACKAGE = '@liuscraft/pi-remote';
const DIR = path.join(import.meta.dirname, '..', 'plugin', 'pi-remote');
const ENTRY = path.join(DIR, 'index.js');
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const EXIT_FAILURE = 1;

class FatalError extends Error {}
const fail = (message) => {
  throw new FatalError(message);
};

function parseArgs(argv) {
  const flags = {};
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (!match) fail(`unknown argument: ${arg}`);
    flags[match[1]] = match[2];
  }
  return flags;
}

const parseVersion = (text) => SEMVER.exec(text)?.slice(1).map(Number) ?? null;
const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Run npm. On Windows it is a .cmd shim, which only runs through cmd.exe, and the whole command line
 *  goes in as one string: that is also what keeps Node from warning about args handed to a shell. */ function npm(
  args,
  options,
) {
  const [command, argv] =
    process.platform === 'win32'
      ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', ['npm', ...args].join(' ')]]
      : ['npm', args];
  return execFileSync(command, argv, options);
}

/** npm's answer, or null when the registry does not know the spec (a version that was never published). */
function npmView(spec) {
  try {
    return npm(['view', spec, 'version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      .trim()
      .split('\n')[0];
  } catch {
    return null;
  }
}

function run(args) {
  npm(args, { cwd: DIR, stdio: 'inherit' });
}

function main() {
  const version = parseVersion(parseArgs(process.argv.slice(2)).version ?? '');
  if (!version) fail('pass the release version as --version=x.y.z');
  const text = version.join('.');
  if (!fs.existsSync(ENTRY)) fail(`missing ${ENTRY}: run npm run build:plugin first`);

  if (npmView(`${PACKAGE}@${text}`)) {
    process.stdout.write(`→ ${PACKAGE}@${text} is already on npm\n`);
    return;
  }
  // npm moves the `latest` dist-tag to whatever was published last, even if it is older. Publishing a
  // force-pushed tag would silently hand everyone an outdated plugin, so that is refused instead.
  const latest = npmView(PACKAGE);
  const latestVersion = latest ? parseVersion(latest) : null;
  if (latestVersion && compare(version, latestVersion) < 0)
    fail(`${PACKAGE}@${latest} is already on npm, newer than the tag's ${text}: publish a higher version`);

  if (!process.env.CI && !process.env.NODE_AUTH_TOKEN)
    fail('no npm credentials: publish through CI (trusted publishing) or set NODE_AUTH_TOKEN');

  run(['pkg', 'set', `version=${text}`]);
  run(['publish', '--access', 'public', '--provenance']);
  process.stdout.write(`→ ${PACKAGE}@${text}\n`);
}

try {
  main();
} catch (error) {
  if (!(error instanceof FatalError)) throw error;
  process.stderr.write(`error: ${error.message}\n`);
  process.exit(EXIT_FAILURE);
}
