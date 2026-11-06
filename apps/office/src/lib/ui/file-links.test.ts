// How the page learns which file names lead somewhere. Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { askAbout, openedAs, plainName } from './file-links.ts';

// Every call the page makes, with the answer each one gets.
let calls: unknown[] = [];
let answer: (body: { files: unknown[] }) => Response;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body)) as { files: unknown[] };
  calls.push(body);
  return answer(body);
}) as typeof fetch;
afterEach(() => {
  calls = [];
});
process.on('exit', () => (globalThis.fetch = realFetch));

const jamal = (path: string) => ({ staff: 'jamal', path });

test('names are asked about once, in one call, and each keeps its answer', async () => {
  answer = () => Response.json(['notes/team-note.md', null]);
  assert.equal(openedAs(jamal('team-note.md')), undefined);
  await askAbout([jamal('team-note.md'), jamal('missing.md'), jamal('team-note.md')]);
  assert.deepEqual(calls, [{ files: [jamal('team-note.md'), jamal('missing.md')] }]);
  assert.equal(openedAs(jamal('team-note.md')), 'notes/team-note.md');
  assert.equal(openedAs(jamal('missing.md')), null);
});

test('a name already asked about is never asked again', async () => {
  await askAbout([jamal('team-note.md'), jamal('missing.md')]);
  assert.deepEqual(calls, []);
});

test('when the office cannot answer, the names stay unlinked and are not asked again', async () => {
  const quiet = console.error;
  console.error = () => {};
  answer = () => new Response('Down', { status: 500 });
  await askAbout([jamal('plan.md')]);
  console.error = quiet;
  assert.equal(openedAs(jamal('plan.md')), null);
  await askAbout([jamal('plan.md')]);
  assert.equal(calls.length, 1);
});

test('a name with a stray % stays as written instead of throwing', () => {
  assert.equal(plainName(' max-height:calc(100% - 16px) '), 'max-height:calc(100% - 16px)');
  assert.equal(plainName('notes/team%20note.md'), 'notes/team note.md');
});
