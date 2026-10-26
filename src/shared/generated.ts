// Files whose contents are produced by tooling: their diffs are noise, not review material.
// The Diff panel still lists them, but renders no rows until the user asks for them.

export type GeneratedKind = 'lockfile' | 'minified' | 'sourcemap';

/** Dependency-manager lockfiles, matched by exact (lowercased) basename. */
const LOCKFILES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'deno.lock',
  'go.sum',
  'go.work.sum',
  'cargo.lock',
  'poetry.lock',
  'pipfile.lock',
  'pdm.lock',
  'uv.lock',
  'composer.lock',
  'gemfile.lock',
  'podfile.lock',
  'pubspec.lock',
  'mix.lock',
  'flake.lock',
  'package.resolved',
  'packages.lock.json',
  'gradle.lockfile',
  'shard.lock',
  'bazel.lock',
  'module.bazel.lock',
  'devcontainer-lock.json',
]);

/** `*.lock`, plus the `foo-lock.json` / `foo.lock.yaml` family not covered by LOCKFILES. */
const LOCKFILE_SUFFIX = /\.lock$|[-._]lock(file)?\.(json|ya?ml|toml)$/;
const SOURCEMAP_SUFFIX = /\.(js|mjs|cjs|css)\.map$/;
const MINIFIED_SUFFIX = /\.min\.(js|mjs|cjs|css)$/;

/**
 * Why `filePath` counts as generated, or null when it is ordinary source.
 * Accepts workspace-relative paths and absolute paths with either separator.
 */
export function generatedKind(filePath: string): GeneratedKind | null {
  const name = (filePath.split(/[\\/]/).pop() || '').toLowerCase();
  if (!name) return null;
  if (LOCKFILES.has(name) || LOCKFILE_SUFFIX.test(name)) return 'lockfile';
  if (SOURCEMAP_SUFFIX.test(name)) return 'sourcemap';
  if (MINIFIED_SUFFIX.test(name)) return 'minified';
  return null;
}

export const isGeneratedFile = (filePath: string) => generatedKind(filePath) !== null;
