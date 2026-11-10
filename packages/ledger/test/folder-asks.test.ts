// An Odd asks for a folder on this computer with ask_for_folder, and the owner
// gives it from the ask's card. The tool checks the folder as the Settings tab
// does, in the tool server's own process, as the office starts one for each
// run; the owner's Give access gives it through the same change as the
// Settings tab, and only then approves the ask. Two runs asking for one folder
// are twins, as access asks are. Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { db, sql, toolServer } from './tool-server.ts';

// A home of the test's own, for this process and the tool server's, so a
// folder in it can be given and is shown as ~/...
const HOME = realpathSync(mkdtempSync(join(tmpdir(), 'folder-asks-')));
// Windows ignores HOME and reads USERPROFILE.
process.env.HOME = process.env.USERPROFILE = HOME;
after(() => rmSync(HOME, { recursive: true, force: true }));

const { asks, followUps, ledger, staff } = await import('../src/schema.ts');
const { eq } = await import('drizzle-orm');
const O = await import('../src/office.ts');

/** Makes a folder under the test's home, and gives back its path. */
function folder(...parts: string[]): string {
  const p = join(HOME, ...parts);
  mkdirSync(p, { recursive: true });
  return p;
}
const taxes = folder('Documents', 'Taxes');
const receipts = folder('Documents', 'Taxes', '2026');
folder('.ssh');

await db.insert(staff).values({
  id: 'theo',
  name: 'Theo',
  role: 'Bookkeeper',
  remit: 'Tests.',
  variant: 'a',
  portrait: 'a',
  permission: 'draft',
  desk: 'You are Theo.'
});

beforeEach(async () => {
  await sql`delete from ledger`;
  await sql`delete from follow_ups`;
  await sql`delete from asks`;
  await db.update(staff).set({ folders: [] }).where(eq(staff.id, 'theo'));
});

/** The first text a tool call returned, and whether it was an error. */
async function call(c: Client, args: Record<string, unknown>) {
  const r = await c.callTool({ name: 'ask_for_folder', arguments: args });
  return {
    text: (r.content as { text: string }[])[0]?.text ?? '',
    error: r.isError === true
  };
}
const shownTaxes = join('~', 'Documents', 'Taxes');
const theo = (run: string, env: Record<string, string> = {}) =>
  toolServer('theo', { RUN_KEY: run, HOME, USERPROFILE: HOME, ...env });
const folderAsks = () => db.select().from(asks).where(eq(asks.kind, 'folder'));
const row = async (id: number) => (await db.select().from(asks).where(eq(asks.id, id)))[0];
const folders = async () => (await db.select().from(staff).where(eq(staff.id, 'theo')))[0].folders;
const raise = (level: 'read' | 'write', place: { handOffId?: number } = {}) =>
  O.raiseAsk('theo', {
    kind: 'folder',
    title: `Read ${level}`,
    why: 'For the tax return.',
    ifApproved: 'i',
    folder: { path: taxes, level },
    ...place
  }).then((r) => r.ask);

test('the tool refuses a missing, a refused and an already-held folder in the Settings tab words, and puts nothing on the desk', async () => {
  const c = await theo('k-refuse');
  const missing = await call(c, { path: '~/Nowhere', level: 'read', why: 'w' });
  assert.ok(missing.error && missing.text.endsWith(O.FOLDER_REFUSED.missing), missing.text);
  const home = await call(c, { path: '~', level: 'read', why: 'w' });
  assert.ok(home.error && home.text.endsWith(O.FOLDER_REFUSED.home), home.text);
  const keys = await call(c, { path: '~/.ssh', level: 'read', why: 'w' });
  assert.ok(keys.error && keys.text.endsWith(O.FOLDER_REFUSED.secrets), keys.text);
  const relative = await call(c, { path: 'Documents', level: 'read', why: 'w' });
  assert.ok(relative.error, relative.text);

  await db
    .update(staff)
    .set({ folders: [{ path: taxes, write: true }] })
    .where(eq(staff.id, 'theo'));
  const held = await call(c, { path: '~/Documents/Taxes/2026', level: 'write', why: 'w' });
  assert.ok(held.error && held.text.includes(`You already have ${shownTaxes}`), held.text);
  assert.deepEqual(await folderAsks(), []);
});

test('the tool refuses a folder the owner could not give beside one the Odd has', async () => {
  await db
    .update(staff)
    .set({ folders: [{ path: taxes, write: false }] })
    .where(eq(staff.id, 'theo'));
  const r = await call(await theo('k-nested'), {
    path: receipts,
    level: 'write',
    why: 'w'
  });
  assert.ok(r.error && r.text.endsWith(O.FOLDER_REFUSED.nested), r.text);
  assert.deepEqual(await folderAsks(), []);
});

test('the tool raises one folder ask with the real path, and refuses a repeat from the same place', async () => {
  const c = await theo('k-raise');
  const r = await call(c, { path: '~/Documents/Taxes/', level: 'read', why: 'For the return.' });
  assert.ok(!r.error, r.text);
  const [a] = await folderAsks();
  assert.deepEqual(a.folder, { path: taxes, level: 'read' });
  assert.equal(a.title, `Read ${shownTaxes}`);
  const again = await call(c, { path: taxes, level: 'read', why: 'w' });
  assert.ok(again.error && again.text.includes(`revises: ${a.id}`), again.text);
  assert.equal((await folderAsks()).length, 1);
});

test('Give access gives the folder with one ledger line, approves the ask and starts the run that needs it', async () => {
  const a = await raise('write');
  const done = await O.giveFolder(a.id, '~/Documents/Taxes', 'write');
  assert.deepEqual(done, { given: { path: taxes, level: 'write' } });
  assert.deepEqual(await folders(), [{ path: taxes, write: true }]);
  const approved = await row(a.id);
  assert.equal(approved.status, 'approved');
  assert.deepEqual(approved.folder?.given, { path: taxes, level: 'write' });
  const lines = await db.select().from(ledger);
  assert.deepEqual(
    lines.map((l) => l.title),
    [`Let Theo read and change ${shownTaxes}`]
  );
  const runs = await db.select().from(followUps);
  assert.deepEqual(
    runs.map((f) => [f.kind, f.askId]),
    [['carry_out', a.id]]
  );
  assert.deepEqual(await O.giveFolder(a.id, taxes, 'write'), {
    refused: 'You already answered this ask.',
    status: 409
  });
});

test('the owner narrows the folder and the level before giving it', async () => {
  const a = await raise('write');
  await O.giveFolder(a.id, receipts, 'read');
  assert.deepEqual(await folders(), [{ path: receipts, write: false }]);
  assert.deepEqual((await row(a.id)).folder, {
    path: taxes,
    level: 'write',
    given: { path: receipts, level: 'read' }
  });
});

test('a folder the Settings tab would refuse leaves the ask open and gives nothing', async () => {
  const a = await raise('read');
  const home = await O.giveFolder(a.id, HOME, 'read');
  assert.deepEqual(home, { refused: O.FOLDER_REFUSED.home, status: 400 });
  await db
    .update(staff)
    .set({ folders: [{ path: receipts, write: false }] })
    .where(eq(staff.id, 'theo'));
  const nested = await O.giveFolder(a.id, taxes, 'read');
  assert.deepEqual(nested, { refused: O.FOLDER_REFUSED.nested, status: 400 });
  assert.equal((await row(a.id)).status, 'open');
  assert.deepEqual(await folders(), [{ path: receipts, write: false }]);
  assert.deepEqual(await db.select().from(ledger), []);
});

test('a plain approve is refused', async () => {
  const a = await raise('read');
  await assert.rejects(O.decideAsk(a.id, 'approve', null), /Give the folder/);
  assert.equal((await row(a.id)).status, 'open');
  assert.deepEqual(await folders(), []);
});

test('two runs asking for one folder are twins: the desk shows the first, and giving it answers both', async () => {
  const first = await raise('write');
  const twin = await raise('read', { handOffId: 7 });
  const shown = (await O.desk()).asks.map((x) => x.id);
  assert.ok(shown.includes(first.id) && !shown.includes(twin.id), 'the twin waits behind it');
  await O.giveFolder(first.id, taxes, 'write');
  assert.equal((await row(twin.id)).status, 'approved');
  const runs = await db.select().from(followUps);
  assert.deepEqual(
    runs.map((f) => f.askId),
    [twin.id],
    'one run, the hand-off twin, does the work'
  );
});

test('an ask for more than the first is no twin', async () => {
  const read = await raise('read');
  const write = await raise('write', { handOffId: 8 });
  const shown = (await O.desk()).asks.map((x) => x.id);
  assert.ok(shown.includes(read.id) && shown.includes(write.id));
});

test('Deny and Iterate work as for any ask', async () => {
  const a = await raise('read');
  await O.decideAsk(a.id, 'deny', 'Not that folder.');
  assert.equal((await row(a.id)).status, 'denied');
  assert.deepEqual(await folders(), []);
  const b = await raise('read');
  await O.decideAsk(b.id, 'iterate', 'Only the 2026 folder.');
  assert.equal((await row(b.id)).status, 'revise');
  const runs = await db.select().from(followUps);
  assert.deepEqual(
    runs.map((f) => [f.kind, f.askId]),
    [
      ['denied', a.id],
      ['rework', b.id]
    ]
  );
});

/** A folder outside the test's home, under the system's temp folder: system files on a Mac and Linux. */
function outside(): string {
  const p = realpathSync(mkdtempSync(join(tmpdir(), 'folder-asks-out-')));
  after(() => rmSync(p, { recursive: true, force: true }));
  return p;
}

test(
  'the tool refuses a whole drive or system files: only the owner may give one',
  { skip: process.platform === 'win32' && "Windows' temp folder sits in the home's AppData" },
  async () => {
    const r = await call(await theo('k-broad'), { path: outside(), level: 'read', why: 'w' });
    assert.ok(r.error && r.text.endsWith(O.FOLDER_REFUSED.broad), r.text);
    assert.deepEqual(await folderAsks(), []);
  }
);

test(
  'giving a whole drive or system files warns and changes nothing, and the Accept gives it',
  { skip: process.platform === 'win32' && "Windows' temp folder sits in the home's AppData" },
  async () => {
    const a = await raise('read');
    const out = outside();
    assert.deepEqual(await O.giveFolder(a.id, out, 'read'), { warning: O.FOLDER_WARNING });
    assert.equal((await row(a.id)).status, 'open');
    assert.deepEqual(await folders(), []);
    assert.deepEqual(await db.select().from(ledger), []);
    assert.deepEqual(await O.giveFolder(a.id, out, 'read', null, true), {
      given: { path: out, level: 'read' }
    });
    assert.deepEqual(await folders(), [{ path: out, write: false }]);
  }
);
