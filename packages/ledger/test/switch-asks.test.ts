// An Odd asks for Run commands or Browse the web with ask_for_switch, and the
// owner turns it on from the ask's card with one click. The tool checks the
// switch as the Settings tab does, in the tool server's own process, as the
// office starts one for each run; the owner's yes turns it on in the same
// transaction that approves the ask, with the Settings tab's ledger words,
// and starts the run that needs it. Two runs asking for the same are twins.
// The Odd runs on Codex, which follows the switch on a Mac and on Linux. Run
// with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { db, sql, toolServer } from './tool-server.ts';

const { asks, followUps, ledger, staff } = await import('../src/schema.ts');
const { eq } = await import('drizzle-orm');
const O = await import('../src/office.ts');

await db.insert(staff).values({
  id: 'sage',
  name: 'Sage',
  role: 'Builder',
  remit: 'Tests.',
  variant: 'a',
  portrait: 'a',
  permission: 'draft',
  agent: 'codex',
  desk: 'You are Sage.'
});

beforeEach(async () => {
  await sql`delete from ledger`;
  await sql`delete from follow_ups`;
  await sql`delete from asks`;
  await db
    .update(staff)
    .set({ commands: false, web: false, agent: 'codex' })
    .where(eq(staff.id, 'sage'));
});

/** The first text a tool call returned, and whether it was an error. */
async function call(c: Client, args: Record<string, unknown>) {
  const r = await c.callTool({ name: 'ask_for_switch', arguments: args });
  return {
    text: (r.content as { text: string }[])[0]?.text ?? '',
    error: r.isError === true
  };
}
const sage = (run: string) => toolServer('sage', { RUN_KEY: run });
const switchAsks = () => db.select().from(asks).where(eq(asks.kind, 'switch'));
const row = async (id: number) => (await db.select().from(asks).where(eq(asks.id, id)))[0];
const me = async () => (await db.select().from(staff).where(eq(staff.id, 'sage')))[0];
const raise = (switches: ('commands' | 'web')[], place: { handOffId?: number } = {}) =>
  O.raiseAsk('sage', {
    kind: 'switch',
    title: 'Turn on',
    why: 'To clone the repo.',
    ifApproved: 'i',
    switches,
    ...place
  }).then((r) => r.ask);

test('the tool raises one ask for the switches that are off, and refuses a repeat from the same place', async () => {
  await db.update(staff).set({ web: true }).where(eq(staff.id, 'sage'));
  const c = await sage('k-raise');
  const first = await call(c, { switches: ['commands', 'web'], why: 'To clone the repo.' });
  assert.equal(first.error, false, first.text);
  const [a] = await switchAsks();
  assert.deepEqual(a.switches, ['commands']);
  assert.equal(a.title, 'Turn on Run commands');
  const again = await call(c, { switches: ['commands'], why: 'Again.' });
  assert.ok(again.error && again.text.includes(`Your ask #${a.id}`), again.text);
  assert.equal((await switchAsks()).length, 1);
});

test('the tool refuses what is on already, and Run commands on a tool that never runs them, in plain words', async () => {
  await db.update(staff).set({ web: true }).where(eq(staff.id, 'sage'));
  const c = await sage('k-refuse');
  const on = await call(c, { switches: ['web'], why: 'w' });
  assert.ok(on.error && on.text.includes('You already have Browse the web on.'), on.text);
  await db.update(staff).set({ agent: 'grok' }).where(eq(staff.id, 'sage'));
  const grok = await call(c, { switches: ['commands'], why: 'w' });
  assert.ok(grok.error && grok.text.includes('not open to an Odd on Grok'), grok.text);
  assert.deepEqual(await switchAsks(), []);
});

test('the owner says yes: the switches turn on with one ledger line, and the run that needs them starts', async () => {
  const a = await raise(['commands', 'web']);
  await O.decideAsk(a.id, 'approve', null);
  const after = await me();
  assert.equal(after.commands, true);
  assert.equal(after.web, true);
  assert.equal((await row(a.id)).status, 'approved');
  const lines = await db.select().from(ledger);
  assert.deepEqual(
    lines.map((l) => l.title),
    ['Let Sage run commands and browse the web']
  );
  const runs = await db.select().from(followUps).where(eq(followUps.askId, a.id));
  assert.deepEqual(
    runs.map((f) => f.kind),
    ['carry_out']
  );
});

test('a yes for an Odd that moved to a tool with no commands since it asked turns nothing on and leaves the ask open', async () => {
  const a = await raise(['commands']);
  await db.update(staff).set({ agent: 'grok' }).where(eq(staff.id, 'sage'));
  await assert.rejects(O.decideAsk(a.id, 'approve', null), /cannot run commands here/);
  assert.equal((await me()).commands, false);
  assert.equal((await row(a.id)).status, 'open');
});

test('two runs asking for the same are twins: the desk shows the first, and one yes answers both', async () => {
  const first = await raise(['commands', 'web']);
  const twin = await raise(['web'], { handOffId: 7 });
  const shown = (await O.desk()).asks.map((x) => x.id);
  assert.ok(shown.includes(first.id) && !shown.includes(twin.id), 'the twin waits behind it');
  await O.decideAsk(first.id, 'approve', null);
  assert.equal((await row(twin.id)).status, 'approved');
  const runs = await db.select().from(followUps);
  assert.deepEqual(
    runs.map((f) => f.askId),
    [twin.id],
    'one run, the hand-off twin, does the work'
  );
});

test('an ask for more than the first is no twin', async () => {
  const web = await raise(['web']);
  const both = await raise(['commands', 'web'], { handOffId: 8 });
  const shown = (await O.desk()).asks.map((x) => x.id);
  assert.ok(shown.includes(web.id) && shown.includes(both.id));
});

test('Deny leaves the switches off', async () => {
  const a = await raise(['commands']);
  await O.decideAsk(a.id, 'deny', 'Not now.');
  assert.equal((await me()).commands, false);
  assert.equal((await row(a.id)).status, 'denied');
});
