// A server added by its address that takes a key, as issue #305 met it: an
// address with ?key= is refused with what to do instead, an Odd that holds a
// tool raises no second ask for it, reconnect_access gives a server that wants
// a key the box for one, and one that connected with no tools can still take
// a key. And issue #291: an Odd told it holds see_office hears that it is no
// tool it calls. The tool server (src/mcp.ts) runs in a process of its own, as
// the office starts one for each run. Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

// The system's secret store, stood in for in this process before anything
// loads it: the tool server's process stands in its own.
const deleted: string[] = [];
mock.module(new URL('../src/secrets.ts', import.meta.url).href, {
  exports: {
    setSecret: () => {},
    getSecret: () => undefined,
    deleteSecret: (id: string, name: string) => {
      deleted.push(`${id}/${name}`);
      return true;
    },
    secretStore: () => ({ ok: true })
  }
});
const { db, toolServer } = await import('./tool-server.ts');

const { asks, connectors, grants, staff, tasks } = await import('../src/schema.ts');
const { and, eq } = await import('drizzle-orm');
const { STARTER_TOOLS } = await import('../src/tools.ts');
const { connector, grantAccess } = await import('../src/office.ts');
const { ensureConnector } = await import('../src/registry.ts');

const odd = (id: string, name: string, tools: string[] = STARTER_TOOLS) => ({
  id,
  name,
  role: 'Researcher',
  remit: 'Notes.',
  variant: 'a',
  portrait: 'a',
  permission: 'act' as const,
  desk: `You are ${name}.`,
  tools: [...tools, 'ask_for_access']
});
await db.insert(staff).values([
  odd('ivy', 'Ivy'),
  odd('jo', 'Jo'),
  odd(
    'kit',
    'Kit',
    STARTER_TOOLS.filter((t) => t !== 'see_office')
  )
]);

const said = (r: Awaited<ReturnType<Client['callTool']>>) =>
  (r.content as { type: string; text: string }[])[0]?.text ?? '';
const call = async (who: string, name: string, args: Record<string, unknown>) =>
  (await toolServer(who, { RUN_KEY: `k-${who}-${name}-${Math.random()}` })).callTool({
    name,
    arguments: args
  });
const openTasks = (staffId: string) =>
  db
    .select()
    .from(tasks)
    .where(and(eq(tasks.staffId, staffId), eq(tasks.status, 'open')));
const brainAddress = 'https://brain.example/functions/v1/brain';

test('an address with ?key= is refused with what to do, and the office keeps no connector for it', async () => {
  const r = await call('ivy', 'ask_for_access', {
    connector: `${brainAddress}?key=abc123`,
    level: 'read',
    why: 'Read my notes.'
  });
  assert.equal(r.isError, true);
  assert.match(said(r), /Leave out everything from "\?"/);
  assert.match(said(r), /Pass key_header/);
  assert.equal((await db.select().from(asks).where(eq(asks.staffId, 'ivy'))).length, 0);
  assert.ok(!(await db.select().from(connectors)).some((c) => c.config.url?.includes('abc123')));
  // The owner's own Add service goes through the same door.
  const owner = await ensureConnector(`${brainAddress}?key=abc123`, { keyHeader: 'x-brain-key' });
  assert.equal(owner.connector, undefined);
  assert.match(owner.problem ?? '', /never in an address/);
});

test('an Odd that holds a tool raises no second ask for it, and is pointed at its open task or at reconnect_access', async () => {
  const first = await call('ivy', 'ask_for_access', {
    connector: brainAddress,
    level: 'read',
    why: 'Read my notes.',
    key_header: 'x-brain-key'
  });
  assert.notEqual(first.isError, true, said(first));
  const conn = (await ensureConnector(brainAddress)).connector!;
  assert.deepEqual(conn.config, { url: brainAddress, headers: ['x-brain-key'], oauth: false });
  // The owner says yes: a grant and its connect task.
  await grantAccess('ivy', { connector: conn.id, level: 'read' });
  const [task] = await openTasks('ivy');
  assert.ok(task);

  const again = await call('ivy', 'ask_for_access', {
    connector: brainAddress,
    level: 'read',
    why: 'Read my notes.'
  });
  assert.equal(again.isError, true);
  assert.match(said(again), new RegExp(`Task ${task.id} to connect .* is already on`));
  assert.equal((await openTasks('ivy')).length, 1, 'no second connect task');

  // With the task gone, the Odd hears to reconnect.
  await db.update(tasks).set({ status: 'dropped' }).where(eq(tasks.id, task.id));
  const later = await call('ivy', 'ask_for_access', {
    connector: conn.id,
    level: 'read',
    why: 'Read my notes.'
  });
  assert.match(said(later), new RegExp(`call reconnect_access with ${conn.id}`));

  // Asking for more than it holds is a new ask.
  const write = await call('ivy', 'ask_for_access', {
    connector: conn.id,
    level: 'write',
    why: 'Save notes too.'
  });
  assert.notEqual(write.isError, true, said(write));
  assert.match(said(write), /^Ask \d+ is on/);
});

test('reconnect_access with key_header gives a server that wanted a key the box for one, and only such a server', async () => {
  // As the report met it: added to sign in, and the server wants a key.
  const address = 'https://notes.example/mcp';
  const conn = (await ensureConnector(address)).connector!;
  assert.deepEqual(conn.config, { url: address, oauth: true });
  await db.insert(grants).values({ staffId: 'jo', connectorId: conn.id, level: 'read' });
  await db.update(connectors).set({ readyAt: new Date() }).where(eq(connectors.id, conn.id));

  const plain = await call('jo', 'reconnect_access', {
    connector: conn.id,
    problem: 'It says the access key is missing.'
  });
  assert.notEqual(plain.isError, true, said(plain));
  const [signIn] = await openTasks('jo');
  assert.ok(!signIn.steps.some((s) => s.action?.kind === 'secret'), 'no box before');

  const r = await call('jo', 'reconnect_access', {
    connector: conn.id,
    problem: 'It says the access key is missing.',
    key_header: 'x-brain-key'
  });
  assert.notEqual(r.isError, true, said(r));
  assert.deepEqual((await connector(conn.id))?.config, {
    url: address,
    headers: ['x-brain-key'],
    oauth: false
  });
  const open = await openTasks('jo');
  assert.equal(open.length, 1, 'the sign-in task made way for the new one');
  assert.notEqual(open[0].id, signIn.id);
  assert.deepEqual(
    open[0].steps.filter((s) => s.action).map((s) => s.action?.kind),
    ['secret', 'tools']
  );

  const header = await call('jo', 'reconnect_access', {
    connector: conn.id,
    problem: 'Again.',
    key_header: 'not a header'
  });
  assert.equal(header.isError, true);
  assert.match(said(header), /is not a header name/);

  await db.insert(grants).values({ staffId: 'jo', connectorId: 'gmail', level: 'read' });
  const gmail = await call('jo', 'reconnect_access', {
    connector: 'gmail',
    problem: 'Signed out.',
    key_header: 'x-api-key'
  });
  assert.equal(gmail.isError, true);
  assert.match(said(gmail), /has its own way in/);
  assert.deepEqual((await connector('gmail'))?.config.headers, undefined);
});

test('a server that connected with no tools can still be given a key', async () => {
  const address = 'https://empty.example/mcp';
  const conn = (await ensureConnector(address)).connector!;
  await db.update(connectors).set({ readyAt: new Date() }).where(eq(connectors.id, conn.id));
  const keyed = await ensureConnector(address, { keyHeader: 'x-api-key' });
  assert.deepEqual(keyed.connector?.config, {
    url: address,
    headers: ['x-api-key'],
    oauth: false
  });
  assert.ok(deleted.includes(`${conn.id}/oauth`), 'the sign-in it no longer uses is gone');
  // One connected with its tools keeps its way in.
  await db
    .update(connectors)
    .set({ tools: ['search'], config: { url: address, oauth: true } })
    .where(eq(connectors.id, conn.id));
  const kept = await ensureConnector(address, { keyHeader: 'x-other' });
  assert.deepEqual(kept.connector?.config, { url: address, oauth: true });
});

test('see_office is told apart as no tool the Odd calls, held or lacked (#291)', async () => {
  const held = await call('ivy', 'ask_for_office_tool', {
    tools: ['see_office'],
    why: 'I need the room names.'
  });
  assert.equal(held.isError, true);
  assert.match(said(held), /You already have Sees who's in the office\. It is not a tool you call/);

  const lister = await toolServer('kit', { RUN_KEY: 'k-kit-list' });
  const { tools } = await lister.listTools();
  const ask = tools.find((t) => t.name === 'ask_for_office_tool');
  assert.match(
    ask?.description ?? '',
    /Sees who's in the office: .* It is not a tool you call: with it, your instructions list the other Odds/
  );
  assert.ok(!tools.some((t) => t.name === 'see_office'), 'never offered as a tool');
});
