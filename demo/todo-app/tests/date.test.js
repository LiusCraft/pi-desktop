import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, isOverdue } from '../src/utils/date.js';

describe('formatDate', () => {
  it('格式化为 YYYY-MM-DD', () => {
    assert.equal(formatDate('2026-03-05T10:00:00'), '2026-03-05');
  });
});

describe('isOverdue', () => {
  it('过去的日期视为逾期', () => {
    assert.equal(isOverdue('2020-01-01'), true);
  });
});
