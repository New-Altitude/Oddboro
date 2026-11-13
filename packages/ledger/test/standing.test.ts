// A standing yes: tools of one service an Odd at Draft uses without asking.
// The Odd offers one with ask_for_standing_yes, in the tool server's own
// process as the office starts one for each run; the owner's yes puts the
// tools on the grant in the transaction that approves the ask, and a no
// stands. The owner also gives and takes one back from the Settings tab
// (`setStanding`), and lowering the grant to read only ends it. Run with
// `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { db, sql, toolServer } from './tool-server.ts';

const { asks, connectors, grants, ledger, staff } = await import('../src/schema.ts');
const { and, eq } = await import('drizzle-orm');
const O = await import('../src/office.ts');
const S = await import('../src/standing.ts');
const { capabilities, outsideLines } = await import('../src/capabilities.ts');

await db.insert(staff).values({
  id: 'cleo',
  name: 'Cleo',
  role: 'Assistant',
  remit: 'Tests.',
  variant: 'a',
  portrait: 'a',
  permission: 'draft',
  desk: 'You are Cleo.'
});
await db.insert(connectors).values({
  id: 'cal',
  name: 'Calendar',
  description: 'A calendar that stages changes, then applies them.',
  kind: 'http',
  tools: ['list_events', 'add_event', 'apply_changes'],
  readTools: ['list_events'],
  readyAt: new Date()
});
await db.insert(grants).values({ staffId: 'cleo', connectorId: 'cal', level: 'act' });
// The tool server reads the grants as it starts, so it starts once they exist.
const cleo: Client = await toolServer('cleo', { RUN_KEY: 'k-standing' });

const grant = async () =>
  (
    await db
      .select()
      .from(grants)
      .where(and(eq(grants.staffId, 'cleo'), eq(grants.connectorId, 'cal')))
  )[0];

beforeEach(async () => {
  await sql`delete from ledger`;
  await sql`delete from follow_ups`;
  await sql`delete from asks`;
  await db
    .update(grants)
    .set({ level: 'act', standing: [], askFirst: [] })
    .where(eq(grants.connectorId, 'cal'));
  await db.update(staff).set({ permission: 'draft' }).where(eq(staff.id, 'cleo'));
});

async function ask(args: Record<string, unknown>) {
  const r = await cleo.callTool({ name: 'ask_for_standing_yes', arguments: args });
  return { text: (r.content as { text: string }[])[0]?.text ?? '', error: r.isError === true };
}
const standingAsks = () => db.select().from(asks).where(eq(asks.kind, 'standing'));

test('the Odd asks once for a staging tool, and the yes puts it on the grant', async () => {
  const r = await ask({
    connector: 'cal',
    tools: ['add_event'],
    why: 'add_event only stages; apply_changes still waits for you.'
  });
  assert.equal(r.error, false, r.text);
  const [a] = await standingAsks();
  // The card's line names the tool and the service as the service names them.
  assert.equal(a.title, 'Allow add_event in Calendar without asking');
  assert.deepEqual(a.standing, { connector: 'cal', tools: ['add_event'] });
  // The same ask again finds the one on the desk.
  const again = await ask({ connector: 'cal', tools: ['add_event'], why: 'Again.' });
  assert.equal(again.error, true);
  assert.match(again.text, /already there/);
  // Nobody reworks it: yes or no only.
  await assert.rejects(O.decideAsk(a.id, 'iterate', 'Change it'), /Say yes or no/);
  await O.decideAsk(a.id, 'approve', null);
  assert.deepEqual((await grant()).standing, ['add_event']);
  // The Odd hears it in its prompt and my_access, and the commit still waits.
  const [line] = outsideLines(
    await capabilities((await db.select().from(staff).where(eq(staff.id, 'cleo')))[0]),
    'Ada'
  );
  assert.match(line, /Except add_event: Ada lets you use that one without asking/);
  // Asking for it now says it already goes through.
  const had = await ask({ connector: 'cal', tools: ['add_event'], why: 'Again.' });
  assert.match(had.text, /already use add_event in Calendar without asking/);
});

test('a no stands: the Odd cannot ask again for that tool', async () => {
  await ask({ connector: 'cal', tools: ['add_event'], why: 'It only stages.' });
  const [a] = await standingAsks();
  await O.decideAsk(a.id, 'deny', null);
  const again = await ask({ connector: 'cal', tools: ['add_event'], why: 'Please.' });
  assert.equal(again.error, true);
  assert.match(again.text, /said no to ask #\d+.*A no stands/);
  assert.deepEqual((await grant()).standing, []);
});

test('the tool refuses a tool the service does not list, one that only reads, and a read only grant', async () => {
  assert.match(
    (await ask({ connector: 'cal', tools: ['nope'], why: 'x' })).text,
    /lists no tool named nope/
  );
  assert.match(
    (await ask({ connector: 'cal', tools: ['list_events'], why: 'x' })).text,
    /only read/
  );
  await db.update(grants).set({ level: 'read' }).where(eq(grants.connectorId, 'cal'));
  assert.match(
    (await ask({ connector: 'cal', tools: ['add_event'], why: 'x' })).text,
    /read only, so nothing of it waits/
  );
});

test('a yes after the grant went read only leaves the ask open, and gives nothing', async () => {
  await ask({ connector: 'cal', tools: ['add_event'], why: 'It only stages.' });
  const [a] = await standingAsks();
  await db.update(grants).set({ level: 'read' }).where(eq(grants.connectorId, 'cal'));
  await assert.rejects(O.decideAsk(a.id, 'approve', null), /no longer holds that service/);
  assert.equal((await standingAsks())[0].status, 'open');
  assert.deepEqual((await grant()).standing, []);
});

test('the owner gives and takes back a standing yes on the Settings tab, and read only ends it', async () => {
  await S.setStanding('cleo', 'cal', 'add_event', true);
  assert.deepEqual((await grant()).standing, ['add_event']);
  const lines = await db.select().from(ledger);
  assert.deepEqual(
    lines.map((l) => l.title),
    ['Let Cleo use add_event in Calendar without asking']
  );
  await assert.rejects(S.setStanding('cleo', 'cal', 'list_events', true), /only reads/);
  await S.setStanding('cleo', 'cal', 'add_event', false);
  assert.deepEqual((await grant()).standing, []);
  await S.setStanding('cleo', 'cal', 'add_event', true);
  await O.setGrantLevel('cleo', 'cal', 'read');
  assert.deepEqual((await grant()).standing, []);
  await assert.rejects(S.setStanding('cleo', 'cal', 'add_event', true), /read and write/);
});

test('at Act the owner sets a tool to ask first; the Odd hears it, asks for no standing yes, cannot ask past it, and read only ends it', async () => {
  await db.update(staff).set({ permission: 'act' }).where(eq(staff.id, 'cleo'));
  await S.setAskFirst('cleo', 'cal', 'apply_changes', true);
  assert.deepEqual((await grant()).askFirst, ['apply_changes']);
  assert.deepEqual(
    (await db.select().from(ledger)).map((l) => l.title),
    ['Cleo asks first before using apply_changes in Calendar, even at Act']
  );
  await assert.rejects(S.setAskFirst('cleo', 'cal', 'list_events', true), /only reads/);
  const [line] = outsideLines(
    await capabilities((await db.select().from(staff).where(eq(staff.id, 'cleo')))[0]),
    'Ada'
  );
  assert.match(line, /Except apply_changes: each call to that one waits for Ada's yes/);
  // At Act a standing yes changes nothing, so the office refuses one.
  const atAct = await ask({ connector: 'cal', tools: ['add_event'], why: 'Faster.' });
  assert.equal(atAct.error, true);
  assert.match(atAct.text, /You are at Act, so your calls to Calendar already go through/);
  assert.deepEqual(await standingAsks(), []);
  // Back at Draft, an Odd never asks to skip a tool the owner set to ask first.
  await db.update(staff).set({ permission: 'draft' }).where(eq(staff.id, 'cleo'));
  const r = await ask({ connector: 'cal', tools: ['apply_changes'], why: 'Faster.' });
  assert.match(r.text, /set apply_changes in Calendar to ask first even at Act/);
  // Each list keeps its tools as the level moves; read only ends both.
  await S.setStanding('cleo', 'cal', 'add_event', true);
  await O.setGrantLevel('cleo', 'cal', 'read');
  assert.deepEqual([(await grant()).standing, (await grant()).askFirst], [[], []]);
});
