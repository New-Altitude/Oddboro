// A chat after a new session starts, in an office under test
// (office-under-test.ts): the session hears the chat so far once, and the
// files that changed during it, and resumed chats hear nothing again. Each
// told and poke line since the owner last wrote is said once: in the replay,
// or in the preface when the replay cut it or the session resumed.
// Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, realpathSync, utimesSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { L, PATCH, chatOf, odd, onPlatform } from './office-under-test.ts';

// After the office under test set its home: replay.ts loads the ledger, which reads it as it loads.
const { REPLAY_CHARS } = await import('./replay.ts');

await L.pg`insert into staff ${L.pg([
  odd('rory', 'Rory'),
  odd('rosa', 'Rosa'),
  odd('reed', 'Reed'),
  odd('dell', 'Dell')
])}`;

const own = (path: string) => L.home('staff', 'rory', path);
const lines = (entries: object[]) => entries.map((l) => JSON.stringify(l) + '\n').join('');
const times = (text: string, part: string) => text.split(part).length - 1;

test('the first chat after a tool switch replays the chat; the next does not', async () => {
  mkdirSync(own(''), { recursive: true });
  // Plain lines, so no stand-in acts on words in them.
  const first = new Date(Date.now() - 60 * 60_000);
  const at = (minutes: number) => new Date(first.getTime() + minutes * 60_000).toISOString();
  writeFileSync(
    own('chat.jsonl'),
    lines([
      // Too long to fit beside the rest, so the replay starts after it.
      { at: at(-30), from: 'owner', text: `Long ago. ${'x'.repeat(REPLAY_CHARS)}` },
      { at: at(0), from: 'owner', text: 'Plant the tulips.' },
      { at: at(1), from: 'staff', text: 'Tulips planted.' },
      { at: at(2), from: 'staff', text: 'I watered them too.', told: true },
      { at: at(3), from: 'staff', text: 'The tulips are up.', poke: true }
    ])
  );
  writeFileSync(own('tulips.md'), 'Six rows.');
  writeFileSync(own('before.md'), 'From last week.');
  const lastWeek = new Date(first.getTime() - 7 * 86_400_000);
  utimesSync(own('before.md'), lastWeek, lastWeek);
  // Changed after the long line and before the first one replayed.
  writeFileSync(own('between.md'), 'Old.');
  utimesSync(own('between.md'), new Date(at(-15)), new Date(at(-15)));

  const moved = await onPlatform('darwin', () =>
    PATCH({
      params: { id: 'rory' },
      request: new Request('http://office/api/staff/rory', {
        method: 'PATCH',
        body: JSON.stringify({ agent: 'codex' })
      })
    } as unknown as Parameters<typeof PATCH>[0])
  );
  assert.equal(moved.status, 200);
  // The office's own files beside the chat log changed too, and are never named
  // as changed. An empty session is no session, so this one is still new.
  for (const name of L.OFFICE_FILE_NAMES)
    if (name !== L.OFFICE_FILES.chat) writeFileSync(own(name), '{}');

  const one = await chatOf('rory', 'What did I just ask you?');
  assert.ok(
    one.message.startsWith('(This is a new session, so you do not remember your chat with '),
    one.message
  );
  assert.ok(!one.message.includes('Long ago.'), 'a line past the budget was replayed');
  for (const line of ['Plant the tulips.', 'Tulips planted.', 'I watered them too.'])
    assert.equal(times(one.message, line), 1, `"${line}" is not in the replay once`);
  // A poke the replay holds is not said again in the preface.
  assert.equal(times(one.message, 'The tulips are up.'), 1, one.message);
  assert.ok(
    one.message.includes('(Files in your folder that changed during it: tulips.md.)'),
    one.message
  );
  assert.ok(one.message.endsWith('What did I just ask you?'), one.message);

  // Lines the office wrote after that chat, which the resumed session never saw.
  appendFileSync(
    own('chat.jsonl'),
    lines([
      { at: new Date().toISOString(), from: 'staff', text: 'I said the bulbs came.', told: true },
      { at: new Date().toISOString(), from: 'staff', text: 'The bulbs came.', poke: true }
    ])
  );
  const two = await chatOf('rory', 'And now?');
  assert.ok(two.args.includes('resume'), 'the second chat started another session');
  assert.ok(!two.message.includes('This is a new session'), two.message);
  assert.ok(!two.message.includes('Plant the tulips.'), two.message);
  assert.equal(times(two.message, '"I said the bulbs came."'), 1, two.message);
  assert.match(
    two.message,
    /\(Before this, you said to [^:]+ in chat: "I said the bulbs came\."\.\)/
  );
  assert.equal(times(two.message, '"The bulbs came."'), 1, two.message);
  assert.ok(
    two.message.includes('the office delivered your pokes to them: "The bulbs came."'),
    two.message
  );
});

test('a told line since the owner last wrote that the replay cut is said once, in the preface', async () => {
  const home = (path: string) => L.home('staff', 'rosa', path);
  mkdirSync(home(''), { recursive: true });
  const at = (minutes: number) => new Date(Date.now() - (60 - minutes) * 60_000).toISOString();
  writeFileSync(
    home('chat.jsonl'),
    lines([
      { at: at(0), from: 'owner', text: 'Water the roses.' },
      { at: at(1), from: 'staff', text: 'I watered the roses.', told: true },
      // Fills the budget alone, so the replay starts after the told line.
      { at: at(2), from: 'staff', text: 'r'.repeat(REPLAY_CHARS) }
    ])
  );
  const run = await chatOf('rosa', 'Did you?');
  assert.ok(run.message.startsWith('(This is a new session'), run.message.slice(0, 200));
  assert.equal(times(run.message, 'I watered the roses.'), 1, run.message.slice(0, 400));
  assert.match(
    run.message,
    /\(Before this, you said to [^:]+ in chat: "I watered the roses\."\.\)/
  );
});

/** A new session's chat for `id`, one line from the owner an hour ago, and its own folder's new file. */
function newChat(id: string): void {
  const home = (path: string) => L.home('staff', id, path);
  mkdirSync(home(''), { recursive: true });
  const hourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
  writeFileSync(
    home('chat.jsonl'),
    lines([{ at: hourAgo, from: 'owner', text: 'Sort the seeds.' }])
  );
  writeFileSync(home('seeds.md'), 'Sorted.');
}
/** A folder outside the Odd's own, by its real path, with one file changed now. */
function given(name: string): string {
  const path = L.home('given-replay', name);
  mkdirSync(path, { recursive: true });
  writeFileSync(`${path}/${name}.md`, 'Changed.');
  return realpathSync(path);
}

test('the replay walks only the given folders the Odd may change that are still there', async () => {
  newChat('reed');
  const write = given('write');
  const read = given('read');
  await L.pg`update staff set folders = ${JSON.stringify([
    { path: write, write: true },
    { path: read, write: false }
  ])}::jsonb where id = 'reed'`;
  const reed = await chatOf('reed', 'Done?');
  assert.ok(reed.message.includes(`${L.shownFolder(write)}/write.md`), reed.message);
  assert.ok(!reed.message.includes('read.md'), 'a read-only folder was walked');

  // A write folder deleted since leaves the line about the Odd's own folder alone.
  newChat('dell');
  await L.pg`update staff set folders = ${JSON.stringify([
    { path: L.home('given-replay', 'gone'), write: true }
  ])}::jsonb where id = 'dell'`;
  const dell = await chatOf('dell', 'Done?');
  assert.ok(
    dell.message.includes('(Files in your folder that changed during it: seeds.md.)'),
    dell.message
  );
});
