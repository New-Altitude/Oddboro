// The migration journal drizzle runs from. Drizzle runs a migration only when
// its journal time is later than the last one an office recorded, so one that
// sorts earlier is skipped on every office already past it, with no error.
// Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const folder = new URL('../migrations/', import.meta.url);

type Entry = { idx: number; when: number; tag: string };

/** The journal's entries, in the order drizzle reads them, after checking each one's shape. */
function journal(): Entry[] {
  const parsed: unknown = JSON.parse(readFileSync(new URL('meta/_journal.json', folder), 'utf8'));
  const entries = (parsed as { entries?: unknown }).entries;
  assert.ok(Array.isArray(entries), 'the journal has no entries list');
  for (const entry of entries)
    assert.ok(
      typeof entry?.idx === 'number' &&
        typeof entry.when === 'number' &&
        typeof entry.tag === 'string',
      `a journal entry is not { idx, when, tag }: ${JSON.stringify(entry)}`
    );
  // Each entry's three fields were checked just above.
  return entries as Entry[];
}

test("every migration's journal time is later than the one before it, and every migration file has one entry", () => {
  const entries = journal();
  assert.ok(entries.length > 0, 'the journal lists no migration: nothing to check');
  for (let i = 1; i < entries.length; i++) {
    const [before, entry] = [entries[i - 1], entries[i]];
    assert.equal(
      entry.idx,
      before.idx + 1,
      `${entry.tag}: idx ${entry.idx} does not follow ${before.tag}'s ${before.idx}`
    );
    assert.ok(
      entry.when > before.when,
      `${entry.tag}: its journal time ${entry.when} is not later than ${before.tag}'s ${before.when}, so an office that ran ${before.tag} would skip it`
    );
  }
  const files = readdirSync(folder)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => name.slice(0, -'.sql'.length))
    .sort();
  const tags = entries.map((entry) => entry.tag).sort();
  assert.deepEqual(
    files,
    tags,
    'each migrations/*.sql file needs one journal entry, and each entry a file'
  );
});
