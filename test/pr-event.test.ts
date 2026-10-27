// The wire message Pi Desktop's PR watcher sends: readable for the model, decodable as a card.
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { decodePrEvent, encodePrEvent, isPrEvent, type PrEvent } from '../src/shared/pr-event';

const event = (p: Partial<PrEvent> = {}): PrEvent => ({
  kind: 'ci-fail', num: 4, url: 'https://github.com/owner/repo/pull/4', head: 'abc123',
  summary: 'build (ubuntu) 失败',
  failed: [{ name: 'build (ubuntu)', url: 'https://github.com/owner/repo/runs/1' }],
  instruction: '读失败日志，修好后提交并推送。',
  ...p,
});

describe('PR event wire message', () => {
  it('round-trips a failing CI event', () => {
    const wire = encodePrEvent(event());
    assert.equal(isPrEvent(wire), true);
    const back = decodePrEvent(wire)!;
    assert.equal(back.kind, 'ci-fail');
    assert.equal(back.num, 4);
    assert.equal(back.head, 'abc123');
    assert.equal(back.summary, 'build (ubuntu) 失败');
    assert.deepEqual(back.failed, [{ name: 'build (ubuntu)', url: 'https://github.com/owner/repo/runs/1' }]);
    assert.equal(back.instruction, '读失败日志，修好后提交并推送。');
  });

  it('round-trips notes, keeping their authors and bodies', () => {
    const wire = encodePrEvent(event({
      kind: 'notes', failed: undefined,
      notes: [
        { id: '1', author: 'alice', body: '这个分支名有点糊\n\n改一下', url: 'https://github.com/owner/repo/pull/4#issuecomment-1' },
        { id: '2', author: 'bob', body: 'tests fail locally' },
      ],
      instruction: '逐条处理评审意见。',
    }));
    const back = decodePrEvent(wire)!;
    assert.equal(back.kind, 'notes');
    assert.equal(back.failed, undefined);
    assert.deepEqual(back.notes?.map((n) => n.author), ['alice', 'bob']);
    assert.equal(back.notes?.[0].body, '这个分支名有点糊\n\n改一下');
    assert.equal(back.instruction, '逐条处理评审意见。');
  });

  it('tells the model this was not the user, and keeps the instruction out of the footer', () => {
    const wire = encodePrEvent(event());
    assert.match(wire, /not the user/);
    assert.match(wire, /^<pr-event kind="ci-fail">/);
    assert.match(wire, /## 交给 Pi 的处理\n读失败日志/);
    assert.equal(decodePrEvent(wire)!.instruction.includes('pi-desktop:'), false);
  });

  it('truncates a very long review body in what history keeps', () => {
    const wire = encodePrEvent(event({ kind: 'notes', notes: [{ id: '1', author: 'a', body: 'x'.repeat(5000) }] }));
    // The model still sees the body in the readable part; the stored copy is capped.
    assert.equal(decodePrEvent(wire)!.notes?.[0].body.length, 2000);
  });

  it('leaves ordinary messages alone', () => {
    assert.equal(decodePrEvent('just a message'), null);
    assert.equal(decodePrEvent('<session-message from="x" from-id="y">\nhi\n</session-message>'), null);
    assert.equal(isPrEvent('just a message'), false);
  });

  it('does not decode a mangled footer', () => {
    const wire = encodePrEvent(event()).replace('{"kind":"ci-fail"', '{oops');
    assert.equal(decodePrEvent(wire), null);
  });
});
