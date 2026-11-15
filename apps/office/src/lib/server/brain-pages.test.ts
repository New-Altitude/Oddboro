import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capturePages, newestCapture, type ReadPage } from './brain-pages.ts';
import { textHash } from './brain-recent.ts';

function capture(i: number, time = '2026-11-14T15:00:00.000123Z') {
  const text = 'Record ' + i;
  return {
    position: time + '/00000000-0000-4000-8000-' + i.toString(16).padStart(12, '0'),
    text,
    date: time,
    hash: textHash(text)
  };
}

function reader(rows: ReturnType<typeof capture>[], cap = 100): ReadPage {
  return async ({ order, cursor, limit }) => {
    const ordered = order === 'asc' ? rows : [...rows].reverse();
    return JSON.stringify({
      records: ordered
        .filter((r) => !cursor || (order === 'asc' ? r.position > cursor : r.position < cursor))
        .slice(0, Math.min(cap, limit))
    });
  };
}

test('recover the old capture marker across short pages and timestamp ties without losing a record', async () => {
  const old = capture(0, '2026-11-13T08:00:00.000001Z');
  const rows = [old, ...Array.from({ length: 1249 }, (_, i) => capture(i + 1))];
  const read = reader(rows, 37);
  assert.equal(await newestCapture(read), rows.at(-1)?.position);
  const seen: string[] = [];
  for await (const batch of capturePages(read, undefined, [old.hash]))
    seen.push(...batch.records.map((r) => r.position));
  // Replaying the matching timestamp also covers old lists with unordered ties.
  assert.deepEqual(
    seen,
    rows.map((r) => r.position)
  );
  const tied = await Array.fromAsync(capturePages(read, undefined, [rows[500].hash]));
  assert.deepEqual(
    tied.flatMap((b) => b.records.map((r) => r.position)),
    rows.slice(1).map((r) => r.position)
  );
});

test('resume at the last reviewed record and leave concurrent arrivals for the next pass', async () => {
  const rows = [capture(1), capture(2), capture(3), capture(4)];
  const read = reader(rows, 2);
  const first = capturePages(read, null);
  const batch = await first.next();
  assert.ok(!batch.done);
  assert.deepEqual(batch.value.records, rows.slice(0, 2));
  await first.return(undefined);
  const rest = capturePages(read, batch.value.position);
  const seen = [];
  for await (const b of rest) {
    seen.push(...b.records);
    rows.push(capture(5));
  }
  assert.deepEqual(seen, rows.slice(2, 4));
  assert.deepEqual(
    (await Array.fromAsync(capturePages(read, rows[3].position))).flatMap((b) => b.records),
    [rows[4]]
  );
});

test('a malformed or repeated capture cannot advance the reader', async () => {
  const row = capture(1);
  const read: ReadPage = async ({ order }) =>
    JSON.stringify({ records: order === 'desc' ? [capture(2)] : [row, row] });
  await assert.rejects(Array.fromAsync(capturePages(read, null)), /out-of-order/);
});
