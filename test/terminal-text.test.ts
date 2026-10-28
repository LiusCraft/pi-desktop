import { describe, expect, it } from 'vitest';
import { plainText } from '../src/main/terminal-text';

describe('plainText', () => {
  it('drops color escapes and keeps what was readable', () => {
    const raw = '\x1b[32m$ npm test\x1b[0m\r\n\x1b[1mPASS\x1b[0m 12 tests\r\n';
    expect(plainText(raw, 10)).toBe('$ npm test\nPASS 12 tests');
  });

  it('resolves carriage-return rewrites and keeps only the last lines asked for', () => {
    expect(plainText('step 1\rstep 2\rstep 3\ndone\n\n\n', 2)).toBe('step 3\ndone');
  });

  it('drops terminal titles and handles empty output', () => {
    expect(plainText('\x1b]0;my title\x07hello\n', 5)).toBe('hello');
    expect(plainText('', 5)).toBe('');
  });
});
