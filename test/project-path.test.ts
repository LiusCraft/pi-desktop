import { expect, it } from 'vitest';
import { projectPathKey } from '@shared/project-path';

it('normalizes Windows drive roots and separators without assuming the client platform', () => {
  expect(projectPathKey('f:\\')).toBe('F:/');
  expect(projectPathKey('F:/')).toBe('F:/');
  expect(projectPathKey('f:\\coding\\app\\')).toBe('F:/coding/app');
  expect(projectPathKey('F:/coding/app')).toBe('F:/coding/app');
});

it('keeps distinct directory names and leaves POSIX and drive-relative paths unchanged', () => {
  expect(projectPathKey('F:/coding/App')).not.toBe(projectPathKey('F:/coding/app'));
  expect(projectPathKey('/home/user/app\\folder')).toBe('/home/user/app\\folder');
  expect(projectPathKey('F:app')).toBe('F:app');
});
