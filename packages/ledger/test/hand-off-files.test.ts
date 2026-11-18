// The files a hand-off carries and where they land. Run with `npm test -w @oddboro/ledger`.
import { odd, said, workCount, put, partNow } from './hand-off-setup.ts';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { db, toolServer } from './tool-server.ts';
import { TEMP_IN_APPDATA } from './store-states.ts';

const { staff, threads } = await import('../src/schema.ts');
const { and, eq } = await import('drizzle-orm');
const { givenName, workName } = await import('../src/work-paths.ts');
const { MAIL_FILES_MAX } = await import('../src/mail-attachments.ts');
const { STARTER_TOOLS } = await import('../src/tools.ts');
const { threadPart } = await import('../src/threads.ts');
const { followUps } = await import('../src/schema.ts');
const { home, OFFICE_FILE_NAMES } = await import('../src/home.ts');

/** Fails a refusal that names a file by its path from the office's folder, which hand_off never takes back. */
const notByOfficePath = (r: Awaited<ReturnType<Client['callTool']>>) =>
  assert.doesNotMatch(said(r), /staff[\\/]/, said(r));
/** An Odd of the test's own, with its own folder and its own work, so no test sees another's files. */
async function carrier(id: string) {
  await db.insert(staff).values({ ...odd(id, id), tools: [...STARTER_TOOLS] });
  const c = await toolServer(id, { RUN_KEY: `k-${id}` });
  return {
    c,
    /** Writes a file in this Odd's own folder. */
    own: (path: string, text = 'mine') => put(join(home('staff', id), path), text),
    /** New work this Odd leads, opened by handing Paige its first piece. */
    open: async (title: string) => {
      const r = await c.callTool({
        name: 'hand_off',
        arguments: { to: 'paige', title, brief: 'Start it.' }
      });
      assert.equal(r.isError, undefined, said(r));
      const [t] = await db.select().from(threads).where(eq(threads.title, title));
      return t.id;
    },
    /** Hands Paige a piece of `work`, naming `files`. */
    give: (work: number, title: string, files: string[]) =>
      c.callTool({
        name: 'hand_off',
        arguments: { to: 'paige', title, brief: 'Do it.', continue_work: work, files }
      })
  };
}
const handedOn = (work: number) =>
  db
    .select()
    .from(followUps)
    .where(and(eq(followUps.threadId, work), eq(followUps.kind, 'hand_off')));
const handedAs = async (work: number, title: string) =>
  (await handedOn(work)).find((f) => f.handOff?.title === title);

test("a hand-off carrying a file from other work the sender is on puts it in this work's folder", async () => {
  const { open, give } = await carrier('ann');
  const other = await open('Ann other work');
  const here = await open('Ann this work');
  put(join(threadPart(other, 'ann'), 'x.md'), 'from the other work');
  const r = await give(here, 'Use the notes', [workName(other, 'ann/x.md')]);
  assert.equal(r.isError, undefined, said(r));
  const name = `threads-${other}-ann-x.md`;
  assert.equal(readFileSync(join(threadPart(here, 'ann'), name), 'utf8'), 'from the other work');
  assert.deepEqual((await handedAs(here, 'Use the notes'))?.handOff?.files, [`ann/${name}`]);
});

test('a hand-off naming a file the sender cannot read is refused with an error, and nothing is handed on', async (t) => {
  const { c, own, open, give } = await carrier('bea');
  t.after(() => c.close());
  // Bea's own folder is there, as every Odd's is, so only the rule stops each file.
  own('mine.md');
  const here = await open('Bea work');
  const { c: theirServer, open: openTheirs } = await carrier('bea-other');
  t.after(() => theirServer.close());
  const theirs = await openTheirs('Work Bea is not on');
  put(join(threadPart(theirs, 'bea-other'), 'x.md'), 'not for Bea');
  // Another Odd's own file, by its path from Bea's folder and by its full path.
  put(join(home('staff', 'paige'), 'x.md'), "Paige's");
  const before = (await handedOn(here)).length;
  const shut = [
    'nope.md',
    '../paige/x.md',
    join(home('staff', 'paige'), 'x.md'),
    workName(theirs, 'bea-other/x.md'),
    join(threadPart(theirs, 'bea-other'), 'x.md')
  ];
  for (const name of shut) {
    const r = await give(here, 'Use it', [name]);
    assert.equal(r.isError, true, name);
    assert.ok(said(r).startsWith(`Nothing was handed off yet. You cannot read ${name}.`), said(r));
  }
  assert.equal((await handedOn(here)).length, before);
  const works = await workCount();
  const opening = await c.callTool({
    name: 'hand_off',
    arguments: { to: 'paige', title: 'Bea new work', brief: 'Do it.', files: ['nope.md'] }
  });
  assert.equal(opening.isError, true);
  assert.equal(await workCount(), works, 'a refused hand-off opened new work');
});

test('a hand-off naming an instruction file is refused', async () => {
  const { own, open, give } = await carrier('cat');
  const here = await open('Cat work');
  // The last is a backslash in a name on a Mac and Linux, and the Windows path on Windows.
  const names = ['CLAUDE.md', join('.claude', 'x'), join('.Claude', 'y'), '.claude\\w'];
  for (const name of names) own(name);
  const inWork = join(threadPart(here, 'paige'), '.claude', 'z');
  put(inWork, 'in the work');
  const before = (await handedOn(here)).length;
  for (const name of [...names, workName(here, 'paige/.claude/z')]) {
    const r = await give(here, 'Use it', [name]);
    assert.equal(r.isError, true, name);
    assert.ok(said(r).startsWith(`Nothing was handed off yet. ${name} is an instruction`), said(r));
    notByOfficePath(r);
  }
  assert.equal((await handedOn(here)).length, before);
  assert.equal(existsSync(threadPart(here, 'cat')), false, 'an instruction file was copied');
});

test("a full path in the giver's own folder carries that file, and one in this work's folder names the file there", async (t) => {
  const { c, own, open, give } = await carrier('amy');
  t.after(() => c.close());
  const here = await open('Amy work');
  own(join('notes', 'full.md'), 'by its full path');
  put(join(threadPart(here, 'paige'), 'z.md'), 'already here');
  const r = await give(here, 'By full paths', [
    join(home('staff', 'amy'), 'notes', 'full.md'),
    join(threadPart(here, 'paige'), 'z.md')
  ]);
  assert.equal(r.isError, undefined, said(r));
  assert.deepEqual((await handedAs(here, 'By full paths'))?.handOff?.files, [
    'paige/z.md',
    'amy/notes-full.md'
  ]);
  assert.equal(
    readFileSync(join(threadPart(here, 'amy'), 'notes-full.md'), 'utf8'),
    'by its full path'
  );
});

test("the office's own files at the top of the giver's folder never go with a hand-off, by any name, and each refusal names the file as the Odd did", async (t) => {
  const { c, own, open, give } = await carrier('ola');
  t.after(() => c.close());
  const here = await open('Ola work');
  // Upper case too: a Mac's and Windows's disks read it as the same file.
  for (const name of OFFICE_FILE_NAMES) for (const n of [name, name.toUpperCase()]) own(n, '{}');
  const before = (await handedOn(here)).length;
  for (const office of OFFICE_FILE_NAMES)
    for (const name of [
      office,
      `./${office}`,
      office.toUpperCase(),
      join(home('staff', 'ola'), office)
    ]) {
      const r = await give(here, 'Use it', [name]);
      assert.equal(r.isError, true, name);
      assert.ok(
        said(r).startsWith(`Nothing was handed off yet. ${name} is one of the office's own files`),
        said(r)
      );
    }
  assert.equal((await handedOn(here)).length, before);
  assert.equal(existsSync(threadPart(here, 'ola')), false, 'an office file was copied');
  // Below the top, a file of that name is the Odd's own, and goes.
  const below = join('notes', OFFICE_FILE_NAMES[0]);
  own(below, 'notes of its own');
  const r = await give(here, 'Use the notes', [below]);
  assert.equal(r.isError, undefined, said(r));
  assert.deepEqual((await handedAs(here, 'Use the notes'))?.handOff?.files, [
    `ola/notes-${OFFICE_FILE_NAMES[0]}`
  ]);
});

test("the office's own files never go with a hand-off through a folder linked to the giver's own", async (t) => {
  const { c, own, open, give } = await carrier('lin');
  t.after(() => c.close());
  const here = await open('Lin work');
  for (const name of OFFICE_FILE_NAMES) own(name, '{}');
  const mine = home('staff', 'lin');
  // A junction on Windows, which needs no admin.
  symlinkSync(mine, join(mine, 'notes'), process.platform === 'win32' ? 'junction' : 'dir');
  const before = (await handedOn(here)).length;
  for (const office of OFFICE_FILE_NAMES) {
    const name = join('notes', office);
    const r = await give(here, 'Use it', [name]);
    assert.equal(r.isError, true, name);
    assert.ok(
      said(r).startsWith(`Nothing was handed off yet. ${name} is reached through a link`),
      said(r)
    );
  }
  assert.equal((await handedOn(here)).length, before);
  assert.equal(existsSync(threadPart(here, 'lin')), false, 'an office file was copied');
});

test("a hidden file never goes with a hand-off, from the giver's folder or the work's", async (t) => {
  const { c, own, open, give } = await carrier('hid');
  t.after(() => c.close());
  const here = await open('Hid work');
  own('.notes.md');
  own(join('drafts', '.x.md'));
  put(join(threadPart(here, 'paige'), '.y.md'), 'hidden in the work');
  const before = (await handedOn(here)).length;
  for (const name of [
    '.notes.md',
    join('drafts', '.x.md'),
    join(home('staff', 'hid'), '.notes.md'),
    workName(here, 'paige/.y.md')
  ]) {
    const r = await give(here, 'Use it', [name]);
    assert.equal(r.isError, true, name);
    assert.ok(said(r).startsWith(`Nothing was handed off yet. ${name} is a hidden file`), said(r));
  }
  assert.equal((await handedOn(here)).length, before);
  assert.equal(existsSync(threadPart(here, 'hid')), false, 'a hidden file was copied');
});

test(
  "the owner's chat attachments go with a hand-off from the giver's attachments folder, and never through one swapped for a link",
  { skip: TEMP_IN_APPDATA },
  async (t) => {
    const { c, own, open, give } = await carrier('ada');
    t.after(() => c.close());
    const here = await open('Ada work');
    const kept = 'attachments/20261110-081108-35bc-image.png';
    own(kept, 'png');
    const r = await give(here, 'Look at the screenshot', [kept]);
    assert.equal(r.isError, undefined, said(r));
    const lands = 'attachments-20261110-081108-35bc-image.png';
    assert.deepEqual((await handedAs(here, 'Look at the screenshot'))?.handOff?.files, [
      `ada/${lands}`
    ]);
    const part = threadPart(here, 'ada');
    assert.deepEqual(partNow(part), { [lands]: 'png' });

    // The Odd writes its own folder, so it can swap attachments/ for a link:
    // out of its folder, or to another folder in it.
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'oddboro-attachments-')));
    t.after(() => rmSync(outside, { recursive: true, force: true }));
    writeFileSync(join(outside, 'out.png'), 'not hers');
    own(join('pics', 'in.png'), 'hers');
    const folder = join(home('staff', 'ada'), 'attachments');
    rmSync(folder, { recursive: true });
    const before = (await handedOn(here)).length;
    for (const [target, named, why] of [
      [outside, 'attachments/out.png', 'You cannot read attachments/out.png'],
      [
        join(home('staff', 'ada'), 'pics'),
        'attachments/in.png',
        'attachments/in.png is reached through a link'
      ]
    ]) {
      symlinkSync(target, folder, 'dir');
      try {
        const linked = await give(here, 'Through a linked folder', [named]);
        assert.equal(linked.isError, true, said(linked));
        assert.ok(said(linked).startsWith(`Nothing was handed off yet. ${why}`), said(linked));
        notByOfficePath(linked);
      } finally {
        unlinkSync(folder);
      }
    }
    assert.equal((await handedOn(here)).length, before);
    assert.deepEqual(partNow(part), { [lands]: 'png' });
  }
);

test('a hand-off carries as many files as an email may, and no more', async (t) => {
  const { c, own, open, give } = await carrier('max');
  t.after(() => c.close());
  const here = await open('Max work');
  const names = Array.from({ length: MAIL_FILES_MAX + 1 }, (_, i) => `f${i}.md`);
  for (const name of names) own(name, name);
  const before = (await handedOn(here)).length;
  const over = await give(here, 'Too many', names);
  assert.equal(over.isError, true, said(over));
  assert.equal((await handedOn(here)).length, before);
  assert.equal(existsSync(threadPart(here, 'max')), false, 'a file was copied');
  const r = await give(here, 'As many as it may', names.slice(0, MAIL_FILES_MAX));
  assert.equal(r.isError, undefined, said(r));
  assert.equal((await handedAs(here, 'As many as it may'))?.handOff?.files?.length, MAIL_FILES_MAX);
});

test(
  'a file in a folder the owner gave the giver never goes with a hand-off, by its full path or its office name',
  { skip: TEMP_IN_APPDATA },
  async (t) => {
    const { c, own, open, give } = await carrier('gil');
    t.after(() => c.close());
    // Its own folder is there, as every Odd's is, so only the rule stops the file.
    own('notes.md');
    const given = realpathSync(mkdtempSync(join(tmpdir(), 'oddboro-given-')));
    t.after(() => rmSync(given, { recursive: true, force: true }));
    writeFileSync(join(given, 'site.md'), 'from the given folder');
    await db
      .update(staff)
      .set({ folders: [{ path: given, write: false }] })
      .where(eq(staff.id, 'gil'));
    const here = await open('Gil work');
    const before = (await handedOn(here)).length;
    for (const name of [join(given, 'site.md'), givenName(basename(given), 'site.md')]) {
      const r = await give(here, 'Use the site', [name]);
      assert.equal(r.isError, true, name);
      assert.ok(said(r).startsWith(`Nothing was handed off yet. You cannot read ${name}`), said(r));
    }
    assert.equal((await handedOn(here)).length, before);
  }
);

test("a file already in this work's folder is listed for the colleague and not copied", async () => {
  const { open, give } = await carrier('dee');
  const here = await open('Dee work');
  put(join(threadPart(here, 'paige'), 'y.md'), 'already here');
  const r = await give(here, 'Check it', [workName(here, 'paige/y.md')]);
  assert.equal(r.isError, undefined, said(r));
  assert.deepEqual((await handedAs(here, 'Check it'))?.handOff?.files, ['paige/y.md']);
  assert.equal(existsSync(threadPart(here, 'dee')), false, 'the file was copied');
});

test("a hand-off a v0.0.9 office stored, naming a file in the giver's own folder, briefs the colleague that the file is no longer there", async () => {
  const { handOffBrief } = await import('../src/hand-offs.ts');
  const { own, open } = await carrier('vic');
  const here = await open('Vic work');
  // Before the upgrade, hand_off stored the path in the giver's own folder and
  // copied the file only as the colleague's run started.
  const kept = 'attachments/20261110-081108-35bc-image.png';
  own(kept, 'png');
  const [row] = await db
    .insert(followUps)
    .values({
      staffId: 'paige',
      kind: 'hand_off',
      threadId: here,
      handOff: { from: 'vic', title: 'Look at the screenshot', brief: 'Say.', files: [kept] }
    })
    .returning();
  try {
    assert.ok(row.handOff && row.threadId);
    const brief = handOffBrief({
      kind: 'hand_off',
      h: row.handOff,
      colleague: { id: 'vic', name: 'Vic' },
      me: 'paige',
      result: null,
      thread: row.threadId
    }).join('\n');
    assert.ok(
      brief.includes(
        `- Files Vic named for this work that are no longer there: ${kept}. Say so in your reply if the work needs them.`
      ),
      brief
    );
    assert.doesNotMatch(brief, /in reach/);
  } finally {
    await db.delete(followUps).where(eq(followUps.id, row.id));
  }
});

test('a hand-off naming two files that would land under one name is refused and names both', async () => {
  const { own, open, give } = await carrier('eve');
  const here = await open('Eve work');
  const nested = join('a', 'b.md');
  own('a-b.md');
  own(nested);
  const before = (await handedOn(here)).length;
  const r = await give(here, 'Use both', ['a-b.md', nested]);
  assert.equal(r.isError, true);
  assert.ok(said(r).includes('a-b.md') && said(r).includes(nested), said(r));
  // Named as the Odd wrote it, not as the office found it in its folder.
  const dotted = await give(here, 'Use both', ['./a-b.md', nested]);
  assert.ok(said(dotted).includes(`one name: ./a-b.md and ${nested}.`), said(dotted));
  // A backslash too: `ownFile` gives Windows's separator there. And case, which
  // a Mac's and Windows's disks do not tell apart.
  own('a\\c.md');
  own('a-c.md');
  own('Q-r.md');
  own(join('q', 'r.md'));
  for (const pair of [
    ['a-c.md', 'a\\c.md'],
    ['Q-r.md', join('q', 'r.md')]
  ]) {
    const again = await give(here, 'Use both', pair);
    assert.equal(again.isError, true, said(again));
  }
  assert.equal(existsSync(threadPart(here, 'eve')), false, 'a file was copied');
  assert.equal((await handedOn(here)).length, before);
});

test('a hand-off is refused when a carried file would land on a file it names from this work', async () => {
  const { own, open, give } = await carrier('fox');
  const here = await open('Fox work');
  own('c.md', 'from the folder');
  put(join(threadPart(here, 'fox'), 'c.md'), 'already here');
  const r = await give(here, 'Use both', ['c.md', workName(here, 'fox/c.md')]);
  assert.equal(r.isError, true);
  assert.equal(readFileSync(join(threadPart(here, 'fox'), 'c.md'), 'utf8'), 'already here');
});

test('a file named twice is carried once', async () => {
  const { own, open, give } = await carrier('gus');
  const here = await open('Gus work');
  own('d.md');
  const r = await give(here, 'Use it', ['d.md', join('.', 'd.md')]);
  assert.equal(r.isError, undefined, said(r));
  assert.deepEqual((await handedAs(here, 'Use it'))?.handOff?.files, ['gus/d.md']);
});

test('a carried file never replaces a different file already in the work, and nothing in the hand-off is copied', async (t) => {
  const { c, own, open, give } = await carrier('ivy');
  // Each tool server holds up to 5 of the office database's 64 connections
  // until it stops, and a later test's server is cut off once they run out.
  t.after(() => c.close());
  const here = await open('Ivy work');
  const part = threadPart(here, 'ivy');
  put(join(part, 'notes.md'), 'DRAFT BUILT ON THE WORK');
  own('notes.md', 'old scratch in own folder');
  own('fresh.md', 'new');
  const before = (await handedOn(here)).length;
  // The last is named as the Odd wrote it, not as the office found it in its folder.
  for (const files of [['notes.md'], ['fresh.md', 'notes.md'], ['./notes.md']]) {
    const r = await give(here, 'Use the notes', files);
    assert.equal(r.isError, true, said(r));
    assert.ok(
      said(r).startsWith(
        `Nothing was handed off yet. ${files.at(-1)} would land on ${workName(here, 'ivy/notes.md')},`
      ),
      said(r)
    );
    notByOfficePath(r);
  }
  assert.deepEqual(partNow(part), { 'notes.md': 'DRAFT BUILT ON THE WORK' });
  assert.equal((await handedOn(here)).length, before);

  // A file from other work is named by its path in that work.
  const other = await open('Ivy other work');
  const from = workName(other, 'ivy/x.md');
  put(join(threadPart(other, 'ivy'), 'x.md'), 'from the other work');
  const lands = `threads-${other}-ivy-x.md`;
  put(join(part, lands), 'A DIFFERENT DRAFT');
  const fromWork = await give(here, 'Use the other notes', [from]);
  assert.equal(fromWork.isError, true, said(fromWork));
  assert.ok(
    said(fromWork).startsWith(
      `Nothing was handed off yet. ${from} would land on ${workName(here, `ivy/${lands}`)},`
    ),
    said(fromWork)
  );
  assert.equal(readFileSync(join(part, lands), 'utf8'), 'A DIFFERENT DRAFT');
  assert.equal((await handedOn(here)).length, before);
});

test('a carried file with the same words as the one already in the work is not copied again, and the hand-off goes', async (t) => {
  const { c, own, open, give } = await carrier('jay');
  t.after(() => c.close());
  const here = await open('Jay work');
  own('same.md', 'the same words');
  const first = await give(here, 'First', ['same.md']);
  assert.equal(first.isError, undefined, said(first));
  const again = await give(here, 'Again', ['same.md']);
  assert.equal(again.isError, undefined, said(again));
  assert.deepEqual((await handedAs(here, 'Again'))?.handOff?.files, ['jay/same.md']);
  assert.deepEqual(partNow(threadPart(here, 'jay')), { 'same.md': 'the same words' });
});

test(
  'a hand-off naming a file the office cannot open is refused by the name the Odd gave it, and the work is left as it was',
  {
    skip:
      (process.platform === 'win32' && 'Windows keeps letting the owner read a file after chmod') ||
      (process.getuid?.() === 0 && 'root reads a file with no permissions')
  },
  async (t) => {
    const { c, own, open, give } = await carrier('kit');
    t.after(() => c.close());
    const here = await open('Kit work');
    const part = threadPart(here, 'kit');
    const locked = join(home('staff', 'kit'), 'locked.md');
    own('a.md', 'readable');
    own('locked.md', 'the earlier words');
    const before = (await handedOn(here)).length;
    const refused = async (files: string[]) => {
      const r = await give(here, 'Use it', files);
      assert.equal(r.isError, true, said(r));
      assert.ok(
        said(r).startsWith('Nothing was handed off yet. The office cannot open locked.md to copy'),
        said(r)
      );
      notByOfficePath(r);
      for (const full of [home(), realpathSync(home())])
        assert.ok(!said(r).includes(full), `a full path: ${said(r)}`);
      assert.doesNotMatch(said(r), /EACCES/);
    };
    try {
      chmodSync(locked, 0o000);
      await refused(['locked.md']);
      await refused(['a.md', 'locked.md']);
      assert.equal(partNow(part), null, 'a refused hand-off made the part or copied into it');

      chmodSync(locked, 0o644);
      const first = await give(here, 'First', ['locked.md']);
      assert.equal(first.isError, undefined, said(first));
      const handed = (await handedOn(here)).length;
      own('locked.md', 'the new words');
      chmodSync(locked, 0o000);
      await refused(['a.md', 'locked.md']);
      assert.deepEqual(partNow(part), { 'locked.md': 'the earlier words' });
      assert.equal((await handedOn(here)).length, handed);
      assert.equal(handed, before + 1);
    } finally {
      chmodSync(locked, 0o644);
    }

    // A file from other work is named by its path in that work.
    const other = await open('Kit other work');
    const shut = join(threadPart(other, 'kit'), 'shut.md');
    put(shut, 'from the other work');
    const from = workName(other, 'kit/shut.md');
    try {
      chmodSync(shut, 0o000);
      const r = await give(here, 'Use the other', [from]);
      assert.equal(r.isError, true, said(r));
      assert.ok(
        said(r).startsWith(`Nothing was handed off yet. The office cannot open ${from} to copy`),
        said(r)
      );
    } finally {
      chmodSync(shut, 0o644);
    }
  }
);

test(
  "a hand-off never copies through a link in the sender's part of the work",
  { skip: TEMP_IN_APPDATA },
  async () => {
    const { own, open, give } = await carrier('hal');
    const here = await open('Hal work');
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'oddboro-carry-')));
    try {
      own('e.md', 'the new words');
      const target = join(outside, 'target.md');
      writeFileSync(target, 'untouched');
      const part = threadPart(here, 'hal');
      mkdirSync(part, { recursive: true });
      symlinkSync(target, join(part, 'e.md'));
      const r = await give(here, 'Through a file link', ['e.md']);
      assert.equal(r.isError, true, said(r));
      assert.ok(said(r).startsWith('Nothing was handed off yet. e.md would land on'), said(r));
      notByOfficePath(r);
      assert.equal(readFileSync(target, 'utf8'), 'untouched');
      assert.equal(lstatSync(join(part, 'e.md')).isSymbolicLink(), true, 'the link was changed');

      rmSync(part, { recursive: true });
      symlinkSync(outside, part);
      const before = (await handedOn(here)).length;
      const linked = await give(here, 'Through a folder link', ['e.md']);
      assert.equal(linked.isError, true);
      assert.ok(said(linked).startsWith('Nothing was handed off yet.'), said(linked));
      assert.equal(existsSync(join(outside, 'e.md')), false, 'copied through the link');
      assert.equal((await handedOn(here)).length, before, 'the hand-off was not taken back');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  }
);

test(
  'a link in the work to a file with the same words as the carried one is refused, never taken as carried before',
  { skip: TEMP_IN_APPDATA },
  async (t) => {
    const { c, own, open, give } = await carrier('lou');
    t.after(() => c.close());
    const here = await open('Lou work');
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'oddboro-same-')));
    t.after(() => rmSync(outside, { recursive: true, force: true }));
    own('f.md', 'the same words');
    const target = join(outside, 'target.md');
    writeFileSync(target, 'the same words');
    const part = threadPart(here, 'lou');
    mkdirSync(part, { recursive: true });
    symlinkSync(target, join(part, 'f.md'));
    const before = (await handedOn(here)).length;
    const r = await give(here, 'Through a link to the same words', ['f.md']);
    assert.equal(r.isError, true, said(r));
    assert.ok(said(r).startsWith('Nothing was handed off yet. f.md would land on'), said(r));
    notByOfficePath(r);
    assert.equal(lstatSync(join(part, 'f.md')).isSymbolicLink(), true, 'the link was changed');
    assert.equal((await handedOn(here)).length, before);
  }
);
