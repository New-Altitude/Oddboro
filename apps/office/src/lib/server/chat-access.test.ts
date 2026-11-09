// From an Odd's own tool server through the owner's chat and back to the waiting work.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { L, history, runOf } from './office-under-test.ts';
import type { ChatEvent } from './staff.ts';

const decisions = await import('../../routes/api/asks/[id]/+server.ts');
const chats = await import('../../routes/api/staff/[id]/chat/+server.ts');
const agents = await import('../../routes/api/agents/[tool]/+server.ts');

function event(params: Record<string, string>, body?: unknown) {
  return {
    params,
    request: new Request('http://localhost/', {
      method: body ? 'POST' : 'GET',
      ...(body ? { body: JSON.stringify(body) } : {})
    })
  } as Parameters<typeof chats.POST>[0] & Parameters<typeof agents.POST>[0];
}

async function send(id: string, body: unknown) {
  const r = await chats.POST(event({ id }, body));
  return (await r.text())
    .trim()
    .split('\n\n')
    .map((line) => JSON.parse(line.slice(6)) as ChatEvent);
}

test('one decision gives only the named web switches still as shown and picks the work up once', async () => {
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [L.STAFF_SERVER],
      env: Object.fromEntries(
        ['PATH', 'ODDBORO_HOME', 'ODDBORO_ENV', 'DATABASE_URL', 'OLLAMA_URL']
          .map((k) => [k, process.env[k]!])
          .concat([['STAFF_ID', 'lead']])
      ),
      stderr: 'ignore'
    })
  );
  const why = 'Compare the two garden catalogues and bring back a short list.';
  async function ask(odds = ['sam', 'cleo', 'sam']) {
    const r = await client.callTool({
      name: 'ask_to_browse',
      arguments: { odds, why }
    });
    assert.ok(!r.isError, JSON.stringify(r.content));
    return (await L.asksFor('lead')).find((a) => a.web && a.status === 'open')!;
  }
  try {
    const first = await ask();
    assert.deepEqual(
      first.web?.map((t) => t.name),
      ['Cleo', 'Sam']
    );
    assert.equal((await L.staffer('cleo'))?.web, false);
    await decisions.POST(event({ id: String(first.id) }, { decision: 'deny' }));
    assert.equal((await L.staffer('cleo'))?.web, false);
    assert.equal((await L.followUpsToDo()).length, 0);

    const second = await ask();
    const chat = await (await chats.GET(event({ id: 'lead' }))).json();
    assert.deepEqual(
      chat.history.find((l: { item?: { id: number } }) => l.item?.id === second.id).item.web,
      second.web
    );
    await L.setAgent('sam', 'codex'); // A different reach from the one on the card.
    const click = () =>
      decisions.POST(event({ id: String(second.id) }, { decision: 'approve', odds: ['paige'] }));
    const both = await Promise.allSettled([click(), click()]);
    assert.equal(both.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await L.staffer('cleo'))?.web, true);
    assert.equal((await L.staffer('sam'))?.web, false);
    assert.equal((await L.staffer('paige'))?.web, false);
    const decided = await L.ask(second.id);
    assert.deepEqual(
      decided?.web?.map((t) => [t.name, t.result]),
      [
        ['Cleo', 'Switched on.'],
        ['Sam', 'Settings changed. Ask again with the new settings.']
      ]
    );
    const due = await L.followUpsToDo();
    assert.equal(due.length, 1);
    const run = await runOf(due[0].id, second.id);
    assert.ok(run.system.includes(why));
    assert.ok(run.system.includes('Cleo: Switched on.'));
    assert.ok(run.system.includes('Sam: Settings changed.'));
    assert.equal(run.env.APPROVED_ASK, undefined);

    const fresh = await ask(['sam', 'paige']);
    await decisions.POST(event({ id: String(fresh.id) }, { decision: 'approve' }));
    assert.deepEqual(
      (await L.ask(fresh.id))?.web?.map((t) => t.result),
      ['Switched on.', 'Switched on.']
    );
    for (const id of ['sam', 'paige']) assert.equal((await L.staffer(id))?.web, true);
    assert.deepEqual(
      (await L.followUpsToDo()).map((f) => f.ask?.id),
      [fresh.id]
    );
  } finally {
    await client.close();
  }
});

test('a signed-out named account can cancel, sign in, and receive the same chat reply once', async () => {
  const account = await L.addAccount('codex', 'Greenhouse');
  await L.setAgent('paige', 'codex');
  await L.setAccount('paige', account.id);
  const { ask } = await L.raiseAsk('paige', {
    title: 'Pick the seeds',
    why: 'For spring.',
    ifApproved: 'Prepare a list.'
  });
  const message = 'Compare the two seed lists.';
  const re = { kind: 'ask' as const, id: ask.id };
  const turnId = randomUUID();
  const files = [{ name: 'seeds.txt', data: Buffer.from('Seeds for spring.').toString('base64') }];
  const blocked = (await send('paige', { turnId, message, re, files })).at(-1);
  assert.equal(blocked?.type, 'error');
  if (blocked?.type !== 'error') return;
  assert.deepEqual(blocked.signIn, { agent: 'codex', account: account.id, how: 'browser' });
  assert.deepEqual(
    history('paige').map((l) => [l.from, l.turnId]),
    [['owner', turnId]]
  );
  const dir = L.accountHome('codex', account.id);
  const signIn = () =>
    agents.POST(event({ tool: 'codex' }, { action: 'sign-in', account: account.id }));
  const first = await signIn();
  await agents.DELETE(event({ tool: 'codex' }));
  assert.match(await first.text(), /"ok":false/);
  assert.deepEqual(
    history('paige').map((l) => [l.from, l.turnId]),
    [['owner', turnId]]
  );
  const second = await signIn();
  writeFileSync(join(dir, 'login.go'), '');
  const result = await second.text();
  assert.match(result, /"url":"https:/);
  assert.match(result, /"ok":true/);
  assert.equal((await send('paige', { turnId })).at(-1)?.type, 'done');
  // A late second return gets the same completed reply.
  assert.equal((await send('paige', { turnId })).at(-1)?.type, 'done');
  assert.deepEqual(
    history('paige').map((l) => [l.from, l.turnId]),
    [
      ['owner', turnId],
      ['staff', turnId]
    ]
  );
  assert.equal(history('paige')[0].attachments?.[0].name, 'seeds.txt');
  assert.deepEqual(
    history('paige')
      .filter((l) => l.from === 'owner')
      .map((l) => [l.text, l.re?.id]),
    [[message, ask.id]]
  );
});
