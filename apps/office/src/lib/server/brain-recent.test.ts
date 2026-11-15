import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { recentCaptures, textHash } from './brain-recent.ts';

function listing(texts: string[]) {
  if (!texts.length) return 'No thoughts found.';
  const rows = texts.map((text, i) => `${i + 1}. [11/14/2026] (observation - test)\n   ${text}`);
  return texts.length + ' recent thought(s):\n\n' + rows.join('\n\n');
}

test('resume a saved position past a burst and keep multiline source text exact', async () => {
  const old = Array.from({ length: 200 }, (_, i) => 'Old ' + i);
  const added = Array.from({ length: 43 }, (_, i) => 'New ' + i);
  added[40] = 'Confirmed.\n\n  Move the collection desk.\n';
  const saved = await recentCaptures(async (n) => listing(old.slice(0, n)));
  const rows = [...added, ...old.slice(1)];
  const read = (n: number) => Promise.resolve(listing(rows.slice(0, n)));
  const resumed = await recentCaptures(read, JSON.parse(JSON.stringify(saved.head)));
  assert.deepEqual(resumed.added, added);
  assert.deepEqual((await recentCaptures(read, resumed.head)).added, []);
});

test('an empty Brain and a deleted marker can catch up from a verified complete list', async () => {
  const empty = await recentCaptures(async () => listing([]));
  assert.deepEqual(empty.head, []);
  for (const head of [empty.head, [textHash('deleted')]]) {
    const result = await recentCaptures(
      async () => listing(['new']),
      head,
      async () => 1
    );
    assert.deepEqual(result.added, ['new']);
  }
});

test('a capped, ambiguous or broken list cannot advance a saved position', async () => {
  const old = [textHash('last checked')];
  const rows = Array.from({ length: 1001 }, (_, i) => 'Capture ' + i);
  for (const cap of [10, 1000])
    await assert.rejects(
      recentCaptures(
        async (n) => listing(rows.slice(0, Math.min(cap, n))),
        old,
        async () => rows.length
      ),
      /verify the gap/
    );
  await assert.rejects(
    recentCaptures(async () => listing(['one']).replace('1 recent', '2 recent'), old),
    /unreadable/
  );
  await assert.rejects(
    recentCaptures(async () => listing(['one\n\n2. [a date] (type)\n   embedded header']), old),
    /unreadable/
  );
  await assert.rejects(
    recentCaptures(async () => {
      throw new Error('offline');
    }, old),
    /offline/
  );
  assert.deepEqual(old, [textHash('last checked')]);
});
