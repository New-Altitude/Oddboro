// From an Odd's own tool server through the owner's chat and back to the waiting work.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { L, history, runOf } from './office-under-test.ts';
import type { ChatEvent } from '#lib/staff/chat.ts';
const { keepAttachment } = await import('./chat-files.ts');

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

test('one switch card grants only its Odd and picks the work up once', async () => {
  const why = 'Compare the two garden catalogues and bring back a short list.';
  const raise = (id: string) =>
    L.raiseAsk(id, {
      kind: 'switch',
      switches: ['web'],
      title: 'Turn on browsing',
      why,
      ifApproved: 'Compare the catalogues.'
    }).then((r) => r.ask);
  const first = await raise('cleo');
  const other = await raise('sam');
  const chat = await (await chats.GET(event({ id: 'cleo' }))).json();
  assert.deepEqual(
    chat.history.find((l: { item?: { id: number } }) => l.item?.id === first.id).item.switches,
    ['web']
  );
  const click = () =>
    decisions.POST(event({ id: String(first.id) }, { decision: 'approve', odds: ['sam'] }));
  const both = await Promise.allSettled([click(), click()]);
  assert.equal(both.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await L.staffer('cleo'))?.web, true);
  assert.equal((await L.staffer('sam'))?.web, false);
  assert.equal((await L.ask(other.id))?.status, 'open');
  const due = (await L.followUpsToDo()).filter((f) => f.ask?.id === first.id);
  assert.equal(due.length, 1);
  const run = await runOf(due[0].id, first.id);
  assert.ok(run.system.includes(why));
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
  const file = keepAttachment('paige', 'seeds.txt', 'text/plain', Buffer.from('Seeds for spring.'));
  const files = [{ name: file.name, tag: 'File #1' }];
  const blocked = (await send('paige', { turnId, message, re, files })).at(-1);
  assert.equal(blocked?.type, 'error');
  if (blocked?.type !== 'error') return;
  assert.deepEqual(blocked.signIn, { agent: 'codex', account: account.id, how: 'browser' });
  assert.deepEqual(
    history('paige')
      .filter((l) => !l.failed)
      .map((l) => [l.from, l.turnId]),
    [['owner', turnId]]
  );
  const dir = L.accountHome('codex', account.id);
  const signIn = () =>
    agents.POST(event({ tool: 'codex' }, { action: 'sign-in', account: account.id }));
  const first = await signIn();
  await agents.DELETE(event({ tool: 'codex' }));
  assert.match(await first.text(), /"ok":false/);
  assert.deepEqual(
    history('paige')
      .filter((l) => !l.failed)
      .map((l) => [l.from, l.turnId]),
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
    history('paige')
      .filter((l) => !l.failed)
      .map((l) => [l.from, l.turnId]),
    [
      ['owner', turnId],
      ['staff', turnId]
    ]
  );
  assert.equal(history('paige')[0].files?.[0].name, file.name);
  assert.equal(history('paige').filter((l) => l.failed).length, 1);
  assert.deepEqual(
    history('paige')
      .filter((l) => l.from === 'owner')
      .map((l) => [l.text, l.re?.id]),
    [[message, ask.id]]
  );
});

test('a folder or switch answered on its chat card marks the run it starts to reply there', async () => {
  const folderRoute = await import('../../routes/api/asks/[id]/folder/+server.ts');
  const wanted = mkdtempSync(join(tmpdir(), 'oddboro-chat-folder-'));
  try {
    const { ask: folderAsk } = await L.raiseAsk('cleo', {
      kind: 'folder',
      title: 'Read the garden notes',
      why: 'For the planting list.',
      ifApproved: 'Read them.',
      folder: { path: wanted, level: 'read' }
    });
    // A temporary folder may count as system files, which warn first: this is the Accept.
    const given = await folderRoute.POST(
      event(
        { id: String(folderAsk.id) },
        { path: wanted, level: 'read', accept: true, chat: true }
      ) as never
    );
    assert.ok('given' in (await given.json()));
    const { ask: switchAsk } = await L.raiseAsk('paige', {
      kind: 'switch',
      switches: ['web'],
      title: 'Turn on browsing',
      why: 'Look up the seed prices.',
      ifApproved: 'Look them up.'
    });
    await decisions.POST(event({ id: String(switchAsk.id) }, { decision: 'approve', chat: true }));
    for (const a of [folderAsk, switchAsk]) {
      const [row] = await L.pg<{ chat_card: unknown }[]>`
        select chat_card from follow_ups where ask_id = ${a.id}`;
      assert.deepEqual(row?.chat_card, { kind: 'ask', id: a.id, title: a.title });
    }
  } finally {
    rmSync(wanted, { recursive: true, force: true });
  }
});
