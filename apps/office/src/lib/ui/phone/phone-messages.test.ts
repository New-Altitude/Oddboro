// What Messages shows under each Odd's name. Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatEntry } from '#lib/staff/chat.ts';
import { lastLine, oneLine, previewLine } from './phone-messages.ts';

const at = '2026-11-13T19:41:00Z';
const said = (from: ChatEntry['from'], text: string, more: Partial<ChatEntry> = {}): ChatEntry => ({
  at,
  from,
  text,
  ...more
});

test('the last line is the newest one with words', () => {
  const got = lastLine([said('owner', 'Hi'), said('staff', 'Drafted and checked.')]);
  assert.deepEqual(got, { from: 'staff', text: 'Drafted and checked.', at });
});

test("a failed run's error is not the Odd's last line", () => {
  const got = lastLine([
    said('owner', "can you pull last quarter's numbers?"),
    said('staff', 'claude exited with code 1', { failed: true })
  ]);
  assert.equal(got?.from, 'owner');
  assert.equal(previewLine(got), "You: can you pull last quarter's numbers?");
});

test('a line with no words, such as a delivery, is skipped', () => {
  const item = { kind: 'ask' as const, id: 3, title: 'Send it', status: 'open' };
  const got = lastLine([
    said('staff', 'I held the archive for your yes.'),
    said('staff', '', { item })
  ]);
  assert.equal(got?.text, 'I held the archive for your yes.');
});

test('a chat with nothing said shows a plain line', () => {
  assert.equal(lastLine([]), undefined);
  assert.equal(previewLine(undefined), 'No messages yet');
});

test('Markdown marks and line breaks come out', () => {
  assert.equal(
    oneLine('**Done:** 12 replies\n\n- see [the list](https://x.test)'),
    'Done: 12 replies - see the list'
  );
});

test('the same characters inside words, ids and sums stay', () => {
  assert.equal(
    oneLine('## Saved\n> to report_q1.md, ticket #42, 3 > 2, *really* done'),
    'Saved to report_q1.md, ticket #42, 3 > 2, really done'
  );
});
