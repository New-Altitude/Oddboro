// The page hears each piece of news once, however the notices that prompt a
// read arrive. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bus, teller, type OfficeEvent } from './events.ts';

/** News rows with ids, read the way the ledger's cursors read them: everything after the mark. */
function store() {
  const rows: number[] = [];
  return {
    rows,
    mark: async () => rows.at(-1) ?? 0,
    since: async (mark: number) => {
      const news = rows.filter((id) => id > mark);
      return { news, mark: news.at(-1) ?? mark };
    }
  };
}

/** Every lesson event the bus carries while `run` goes on. */
async function heard(run: () => Promise<void>): Promise<number[]> {
  const got: number[] = [];
  const hear = (e: OfficeEvent) => {
    if (e.type === 'lesson') got.push(e.lesson);
  };
  bus.on('event', hear);
  try {
    await run();
  } finally {
    bus.off('event', hear);
  }
  return got;
}

const settled = () => new Promise((done) => setTimeout(done, 10));

test('each piece of news reaches the page once, even when two notices arrive together', async () => {
  const s = store();
  const tell = teller({
    name: 'Test',
    mark: s.mark,
    since: s.since,
    event: (lesson: number): OfficeEvent => ({ type: 'lesson', kind: 'kept', staff: 'ada', lesson })
  });
  const got = await heard(async () => {
    await settled();
    s.rows.push(1);
    tell();
    tell();
    await settled();
    s.rows.push(2);
    tell();
    await settled();
  });
  assert.deepEqual(got, [1, 2]);
});

test('news already there when the office starts is never told', async () => {
  const s = store();
  s.rows.push(1);
  const tell = teller({
    name: 'Test',
    mark: s.mark,
    since: s.since,
    event: (lesson: number): OfficeEvent => ({ type: 'lesson', kind: 'kept', staff: 'ada', lesson })
  });
  const got = await heard(async () => {
    tell();
    await settled();
  });
  assert.deepEqual(got, []);
});
