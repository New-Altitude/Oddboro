// What every Office Manager's first chat message asks a new owner. Run with
// `npm test -w @oddboro/ledger`. managers.ts imports db.ts, so pglite.ts stands
// in for it, though nothing here reads the database.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import './pglite.ts';

const M = await import('../src/managers.ts');

/** Every hello the office can write: each ready-made manager's, and a described one's. */
const hellos = [
  ...M.MANAGERS.map((m) => ({ who: m.name, text: m.hello('Ada') })),
  { who: 'a described manager', text: M.customHello('Rosa', 'Ada') }
];

test('every hello asks the three questions and names the default for each', () => {
  for (const { who, text } of hellos) {
    assert.match(text, /[^.?!]*\bget done\b[^.?!]*\?/, `${who} asks what to get done`);
    assert.match(text, /without checking with you\?/, `${who} asks how much to do unchecked`);
    assert.match(
      text,
      /everything, or only what needs you\?/,
      `${who} asks how the owner wants to hear`
    );
    assert.match(
      text,
      /check with you before anything leaves the office/,
      `${who} says the office checks first until told otherwise`
    );
    assert.ok(
      (text.match(/only what needs you/g) ?? []).length >= 2,
      `${who} says the owner hears only what needs them until told otherwise`
    );
    assert.match(text, /\bAda\b/, `${who} greets the owner by name`);
  }
});
