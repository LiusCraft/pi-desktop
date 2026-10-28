#!/usr/bin/env node
// `make release`: tag HEAD and push the tag. CI reads the version from the tag,
// writes it into package.json and publishes the release, so nothing is bumped or
// committed here. The version comes from VERSION=x.y.z; without it the latest
// v* tag is bumped by BUMP=patch|minor|major (patch by default).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const BUMP_KINDS = ['patch', 'minor', 'major'];
const DEFAULT_BUMP = 'patch';
// Where each bump kind lands in the [major, minor, patch] triple; the fields
// after it reset to 0.
const BUMP_FIELD = { major: 0, minor: 1, patch: 2 };
const FIELDS = ['major', 'minor', 'patch'];
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const TAG_PREFIX = 'v';
const REMOTE = 'origin';
const EXIT_FAILURE = 1;

class FatalError extends Error {}

function fail(message) {
  throw new FatalError(message);
}

function parseArgs(argv) {
  const flags = {};
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (!match) fail(`unknown argument: ${arg}`);
    flags[match[1]] = match[2];
  }
  return flags;
}

/** Run git and return its trimmed stdout, or null when the caller allows failure. */
function git(args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    if (allowFailure) return null;
    fail(`git ${args.join(' ')} failed: ${(error.stderr || error.message).trim()}`);
  }
}

function parseVersion(text) {
  const bare = text.startsWith(TAG_PREFIX) ? text.slice(TAG_PREFIX.length) : text;
  const match = SEMVER.exec(bare);
  if (!match) return null;
  const [, major, minor, patch] = match;
  return { major: Number(major), minor: Number(minor), patch: Number(patch) };
}

function formatVersion({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

function compareVersions(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function bumpVersion(version, kind) {
  const bumped = { ...version };
  const field = BUMP_FIELD[kind];
  bumped[FIELDS[field]] += 1;
  for (const name of FIELDS.slice(field + 1)) bumped[name] = 0;
  return bumped;
}

function packageVersion() {
  const raw = fs.readFileSync('package.json', 'utf8');
  try {
    return parseVersion(JSON.parse(raw).version ?? '');
  } catch {
    return fail('package.json is not valid JSON');
  }
}

/** Highest v<semver> tag in the repo, falling back to package.json's version. */
function latestVersion() {
  const tags = git(['tag', '--list', `${TAG_PREFIX}*`, '--sort=-v:refname'], { allowFailure: true }) ?? '';
  for (const tag of tags.split('\n')) {
    const version = parseVersion(tag.trim());
    if (version) return { tag: tag.trim(), version };
  }
  const version = packageVersion();
  return version ? { tag: null, version } : null;
}

function tagExistsLocally(tag) {
  return git(['rev-parse', '--quiet', '--verify', `refs/tags/${tag}`], { allowFailure: true }) !== null;
}

function tagExistsOnRemote(tag) {
  return Boolean(git(['ls-remote', '--tags', REMOTE, `refs/tags/${tag}`], { allowFailure: true }));
}

function warnIfHeadIsUnpushed() {
  const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { allowFailure: true });
  if (!upstream) return;
  if (git(['merge-base', '--is-ancestor', 'HEAD', upstream], { allowFailure: true }) !== null) return;
  console.warn(`warning: HEAD is not pushed to ${upstream} — the tag releases a commit only you have locally`);
}

function release(flags) {
  const bumpKind = flags.bump || DEFAULT_BUMP;
  if (!BUMP_KINDS.includes(bumpKind)) {
    fail(`BUMP must be one of ${BUMP_KINDS.join(', ')}, got "${bumpKind}"`);
  }
  if (git(['status', '--porcelain']) !== '') fail('worktree is dirty — commit or stash first');

  const latest = latestVersion();
  const explicit = flags.version ? parseVersion(flags.version) : null;
  if (flags.version && !explicit) fail(`VERSION must look like 1.2.3, got "${flags.version}"`);

  const base = latest?.version ?? { major: 0, minor: 0, patch: 0 };
  const version = formatVersion(explicit ?? bumpVersion(base, bumpKind));
  const tag = `${TAG_PREFIX}${version}`;

  if (latest && compareVersions(parseVersion(version), latest.version) <= 0 && flags.force !== '1') {
    const latestLabel = latest.tag ?? `package.json ${formatVersion(latest.version)}`;
    fail(`${tag} is not newer than ${latestLabel} — pass FORCE=1 to release it anyway`);
  }
  if (tagExistsLocally(tag)) fail(`tag ${tag} already exists locally`);
  if (tagExistsOnRemote(tag)) fail(`tag ${tag} already exists on ${REMOTE}`);

  // Only a bump has a base worth naming; an explicit VERSION stands on its own.
  const from = explicit || !latest?.tag ? '' : ` (${bumpKind} bump of ${latest.tag})`;
  console.log(`→ ${tag}${from}`);
  warnIfHeadIsUnpushed();

  if (flags['dry-run'] === '1') {
    console.log('dry run: nothing tagged or pushed');
    return;
  }

  git(['tag', tag]);
  try {
    git(['push', REMOTE, tag]);
  } catch (error) {
    git(['tag', '--delete', tag], { allowFailure: true });
    fail(`${tag} not pushed, local tag removed — ${error.message}`);
  }
  console.log(`${tag} pushed — GitHub Actions builds and publishes the release`);
}

try {
  release(parseArgs(process.argv.slice(2)));
} catch (error) {
  if (!(error instanceof FatalError)) throw error;
  console.error(`error: ${error.message}`);
  process.exit(EXIT_FAILURE);
}
