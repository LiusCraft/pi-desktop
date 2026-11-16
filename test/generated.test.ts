import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { generatedKind, isGeneratedFile } from '@shared/generated';

describe('generated file detection', () => {
  it('recognizes lockfiles from every ecosystem', () => {
    const cases = [
      'package-lock.json',
      'npm-shrinkwrap.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      'bun.lockb',
      'deno.lock',
      'go.sum',
      'Cargo.lock',
      'poetry.lock',
      'Pipfile.lock',
      'uv.lock',
      'composer.lock',
      'Gemfile.lock',
      'Podfile.lock',
      'pubspec.lock',
      'mix.lock',
      'flake.lock',
      'Package.resolved',
      'packages.lock.json',
      'gradle.lockfile',
      'shard.lock',
      'MODULE.bazel.lock',
    ];
    for (const path of cases) assert.equal(generatedKind(path), 'lockfile', path);
  });

  it('keeps its match on nested and absolute paths, and ignores separator style', () => {
    assert.equal(generatedKind('app/node_modules/x/package.json'), null);
    assert.equal(generatedKind('app/package-lock.json'), 'lockfile');
    assert.equal(generatedKind('/Users/me/repo/go.sum'), 'lockfile');
    assert.equal(generatedKind('C:\\repo\\yarn.lock'), 'lockfile');
    assert.equal(generatedKind('services/api/lockfiles/whatever-lock.json'), 'lockfile');
  });

  it('matches minified bundles and source maps, and nothing else', () => {
    assert.equal(generatedKind('dist/app.min.js'), 'minified');
    assert.equal(generatedKind('dist/app.min.css'), 'minified');
    assert.equal(generatedKind('dist/app.min.js.map'), 'sourcemap');
    assert.equal(generatedKind('dist/styles.css.map'), 'sourcemap');
    assert.equal(generatedKind('dist/app.js'), null);
    assert.equal(generatedKind('dist/minimal.js'), null);
  });

  it('leaves ordinary source that merely mentions lock or min alone', () => {
    for (const path of [
      'src/lock.ts',
      'src/unlock.js',
      'src/blocked.ts',
      'go.mod',
      'package.json',
      'README.md',
      'src/lock/index.ts',
      'notes.lock.md',
    ]) {
      assert.equal(isGeneratedFile(path), false, path);
    }
    assert.equal(isGeneratedFile(''), false);
  });
});
