// What a new chat session hears of the chat it never saw: the newest lines
// within the budget, word for word, and the files in the Odd's folder and the
// folders the owner gave it to change that changed during them. Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import {
  changedSince,
  REPLAY_CHARS,
  REPLAY_FILES,
  replay,
  replaySince,
  replayed
} from './replay.ts';
import { OFFICE_FILES } from '@oddboro/ledger/home';
import type { ChatEntry } from '../staff/chat.ts';
import type { KeptFile } from './chat-preface.ts';

const owner = (text: string): ChatEntry => ({
  at: '2026-11-04T09:00:00.000Z',
  from: 'owner',
  text
});
const reply = (text: string): ChatEntry => ({
  at: '2026-11-04T09:00:01.000Z',
  from: 'staff',
  text
});
const told = (text: string): ChatEntry => ({ ...reply(text), told: true });
const poke = (text: string): ChatEntry => ({ ...reply(text), poke: true });
/** A desk item's line, which has no text of its own. */
const item: ChatEntry = { ...reply(''), item: { kind: 'ask', id: 1, title: 'A', status: 'open' } };
/** No files changed. */
const none = { files: [], granted: false };
const OLDER = `(The chat goes back further. All of it is in ${OFFICE_FILES.chat} in your folder, one line per message, oldest first. Read it when something earlier matters.)`;
const HEAD =
  '(This is a new session, so you do not remember your chat with {owner} so far. Here is the latest of it, word for word, oldest first:)';

test('replay keeps the newest whole lines within the budget, and says where the rest is', () => {
  const chat = [owner('aaaa'), reply('bbbbbb'), item, told('cc'), poke('dd')];
  // Every line's text fits in 14 characters: each is kept, oldest first, by who said it.
  assert.equal(replay(chat, none, 14), `${HEAD}\n\n{owner}: aaaa\nYou: bbbbbb\nYou: cc\nYou: dd`);
  // At exactly the budget the oldest line that fits is kept whole; one short of it, it goes,
  // and the session is told the whole chat is in chat.jsonl.
  assert.equal(replay(chat, none, 10), `${HEAD}\n\nYou: bbbbbb\nYou: cc\nYou: dd\n\n${OLDER}`);
  assert.equal(replay(chat, none, 9), `${HEAD}\n\nYou: cc\nYou: dd\n\n${OLDER}`);
  // An older short line never fills in behind a longer one that did not fit.
  assert.equal(
    replay([owner('x'), reply('yyyyyy'), owner('zz')], none, 4),
    `${HEAD}\n\n{owner}: zz\n\n${OLDER}`
  );
  // A newest line over the budget alone keeps its end.
  assert.equal(
    replay([owner('x'), reply('abcdefghij')], none, 4),
    `${HEAD}\n\nYou: …ghij\n\n${OLDER}`
  );
  assert.equal(replay([reply('abcdefghij')], none, 4), `${HEAD}\n\nYou: …ghij\n\n${OLDER}`);
  assert.equal(REPLAY_CHARS, 24_000);
  const long = 'w'.repeat(REPLAY_CHARS + 5);
  assert.equal(
    replay([reply(long)], none),
    `${HEAD}\n\nYou: …${'w'.repeat(REPLAY_CHARS)}\n\n${OLDER}`
  );
});

test('retold files count inside the budget, and an older line goes with its files', () => {
  // The review's probe: 200 short owner lines with 10 pictures each.
  const pictures = (line: number): KeptFile[] =>
    Array.from({ length: 10 }, (_, n) => ({
      tag: `Image #${n + 1}`,
      name: `20261104-090000-ab${line}-picture.png`,
      mediaType: 'image/png',
      size: 1,
      path: `/office/staff/odd/attachments/20261104-090000-ab${line}-${n}-picture.png`
    }));
  const chat = Array.from({ length: 200 }, (_, i) => ({
    ...owner(`Look at these, ${i}.`),
    now: pictures(i)
  }));
  const said = replay(chat, none);
  const kept = said.split('{owner}: Look at these').length - 1;
  // Past the budget, all a replay adds is its two framing sentences with their
  // blank lines, and each kept line's "{owner}: " and line break.
  assert.ok(
    said.length <= REPLAY_CHARS + HEAD.length + OLDER.length + 4 + kept * '{owner}: \n'.length,
    `${said.length} characters for ${kept} lines`
  );
  assert.ok(kept > 0 && kept < 200, `${kept} lines kept`);
  // Every kept line keeps all ten of its pictures, and the newest line is kept.
  assert.equal(said.split('\n- [Image #').length - 1, kept * 10);
  assert.ok(said.includes('Look at these, 199.'));
  assert.ok(!said.includes('Look at these, 0.'));
  // A newest line over the budget alone keeps its pictures and the end of its text that fits beside them.
  const alone = replay([{ ...owner('w'.repeat(REPLAY_CHARS)), now: pictures(0) }], none);
  assert.ok(alone.length <= REPLAY_CHARS + HEAD.length + OLDER.length + 4 + '{owner}: …'.length);
  assert.equal(alone.split('\n- [Image #').length - 1, 10);
  assert.ok(alone.includes('{owner}: …w'));
});

test('a cut replay sends the session to the chat log by the name the office keeps it under', () => {
  const said = replay([owner('older'), reply('newest')], none, 6);
  assert.equal(said.match(/All of it is in (\S+) in your folder/)?.[1], OFFICE_FILES.chat);
});

/** A file under `dir`, last changed at `at`. */
function put(dir: string, path: string, at: Date): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), 'x');
  utimesSync(join(dir, path), at, at);
}
const since = new Date('2026-11-04T09:00:00.000Z');
const later = (minutes: number) => new Date(since.getTime() + minutes * 60_000);

test("changedSince lists the Odd's files changed since a time", () => {
  const dir = mkdtempSync(join(tmpdir(), 'oddboro-replay-'));
  const outside = mkdtempSync(join(tmpdir(), 'oddboro-replay-out-'));
  try {
    put(dir, 'old.md', later(-60));
    put(dir, 'at-the-time.md', since);
    put(dir, 'site/index.html', later(2));
    put(dir, 'notes/intake.md', later(3));
    // The Odd's own file of that name, deeper down, is the Odd's.
    put(dir, 'site/chat.jsonl', later(1));
    for (const office of ['chat.jsonl', 'session.json', '.hidden.md', '.codex/config.toml'])
      put(dir, office, later(4));
    put(outside, 'far.md', later(4));
    symlinkSync(join(outside, 'far.md'), join(dir, 'link.md'));
    const office = [join(dir, 'chat.jsonl'), join(dir, 'session.json')];
    assert.deepEqual(changedSince(dir, since.toISOString(), office, []), {
      files: ['notes/intake.md', 'site/index.html', 'site/chat.jsonl', 'at-the-time.md'],
      granted: false
    });

    // Past the file cap, the rest are counted.
    const many = mkdtempSync(join(dir, 'many-'));
    for (let i = 0; i < REPLAY_FILES + 2; i++) put(many, `f${i}.md`, later(10 + i));
    const told = replay(
      [owner('Make the files.')],
      changedSince(many, since.toISOString(), [], [])
    );
    assert.match(told, /\(Files in your folder that changed during it: f31\.md, f30\.md, /);
    assert.match(told, /, f2\.md, and 2 more\.\)$/);
    assert.doesNotMatch(told, /f1\.md|f0\.md/);
    assert.equal(REPLAY_FILES, 30);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("changedSince looks at no more than 2,000 entries of the Odd's folder", () => {
  const dir = mkdtempSync(join(tmpdir(), 'oddboro-replay-'));
  try {
    for (let i = 0; i < 2_001; i++) writeFileSync(join(dir, `f${i}.md`), 'x');
    assert.equal(changedSince(dir, since.toISOString(), [], []).files.length, 2_000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a folder in the walk that cannot be read is passed over, and the rest is still listed', (t) => {
  if (process.getuid?.() === 0) return t.skip('root reads a shut folder');
  const dir = mkdtempSync(join(tmpdir(), 'oddboro-replay-'));
  try {
    put(dir, 'shut/inside.md', later(1));
    put(dir, 'open.md', later(1));
    chmodSync(join(dir, 'shut'), 0o000);
    assert.deepEqual(changedSince(dir, since.toISOString(), [], []).files, ['open.md']);
    // Nothing to walk at all is no change, not a failed chat.
    assert.deepEqual(changedSince(join(dir, 'gone'), since.toISOString(), [], []).files, []);
  } finally {
    chmodSync(join(dir, 'shut'), 0o700);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a replay that opens on the Odd's reply lists the files changed since the owner line that started its run", () => {
  const dir = mkdtempSync(join(tmpdir(), 'oddboro-replay-'));
  try {
    // Written together after the run: the owner line stamped when sent, the reply when done.
    const asked = { ...owner('Build the page.'), at: later(0).toISOString() };
    const answered = { ...reply('y'.repeat(REPLAY_CHARS)), at: later(10).toISOString() };
    const chat = [asked, answered];
    const kept = replayed(chat);
    assert.deepEqual(kept, [answered], 'the owner line fit beside the reply');
    assert.equal(replaySince(chat, kept), asked.at);
    put(dir, 'page.html', later(5));
    assert.deepEqual(changedSince(dir, asked.at, [], []).files, ['page.html']);
    // One that opens on the owner's line starts from it.
    assert.equal(replaySince([asked], replayed([asked])), asked.at);
    assert.equal(replaySince([], []), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the folders the owner gave the Odd to change are walked as the owner reads them, each file once, links and hidden files and node_modules passed over', () => {
  const real = process.env.HOME;
  // As awayFromHome does (office-under-test.ts), so shownFolder writes this home `~`.
  const home = mkdtempSync(join(tmpdir(), 'oddboro-replay-home-'));
  process.env.HOME = home;
  const dir = join(home, 'own');
  const work = join(home, 'work');
  const outside = mkdtempSync(join(tmpdir(), 'oddboro-replay-out-'));
  try {
    put(dir, 'notes.md', later(1));
    put(work, 'plan.md', later(3));
    put(work, 'inner/deep.md', later(2));
    put(work, 'node_modules/pkg/index.js', later(4));
    put(work, '.cache/x.md', later(4));
    put(work, '.hidden.md', later(4));
    put(outside, 'far.md', later(4));
    symlinkSync(outside, join(work, 'linked'));
    const changed = changedSince(dir, since.toISOString(), [], [work, join(work, 'inner')]);
    assert.deepEqual(changed, {
      files: ['~/work/plan.md', '~/work/inner/deep.md', 'notes.md'],
      granted: true
    });
    assert.match(
      replay([owner('Plan it.')], changed),
      /\(Files that changed during it, in your folder and the folders \{owner\} gave you, newest first: ~\/work\/plan\.md, ~\/work\/inner\/deep\.md, notes\.md\.\)$/
    );

    // Each walk stops at its own cap.
    const big = join(home, 'big');
    mkdirSync(big);
    for (let i = 0; i < 2_001; i++) writeFileSync(join(big, `f${i}.md`), 'x');
    const files = changedSince(dir, since.toISOString(), [], [big]).files;
    assert.equal(files.filter((f) => f.startsWith('~/big/')).length, 2_000);
    assert.ok(files.includes('notes.md'), "the Odd's own folder was not walked");
  } finally {
    if (real === undefined) delete process.env.HOME;
    else process.env.HOME = real;
    rmSync(home, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('a replay names exactly REPLAY_FILES files whole, and counts one more', () => {
  const names = (n: number) => Array.from({ length: n }, (_, i) => `f${i}.md`);
  const all = replay([owner('Go.')], { files: names(REPLAY_FILES), granted: false });
  assert.match(all, new RegExp(`, f${REPLAY_FILES - 1}\\.md\\.\\)$`));
  assert.doesNotMatch(all, /more/);
  const over = replay([owner('Go.')], { files: names(REPLAY_FILES + 1), granted: false });
  assert.match(over, new RegExp(`, f${REPLAY_FILES - 1}\\.md, and 1 more\\.\\)$`));
});
