// Exercise the portable source command and the receiving chat in a throwaway office.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { linkSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { L, folder, history, odd } from './office-under-test.ts';

const { previewHandoff } = await import('./codex-handoff.ts');
const { POST } = await import('../../routes/api/staff/[id]/codex-handoff/+server.ts');
const download = await import('../../routes/api/staff/[id]/chat/[turnId]/[index]/+server.ts');
const { activeReply, stopReply } = await import('./staff.ts');
const { POST: reply } = await import('../../routes/api/staff/[id]/chat/+server.ts');
const script = import.meta.resolve('@oddboro/ledger/codex-handoff');
const text = '  Preserve the spacing.\r\nCheck moisture before watering.\r\n';
const notes =
  'Decision: keep the oak.\nOpen question: who brings the mulch?\nNext: draft a planting list.';
const file = join(folder, 'Measurements.txt');
const bytes = Buffer.from('North side\t14 m\r\n', 'utf8');
writeFileSync(file, bytes);

function prepare(selection = text, path = file) {
  const link = execFileSync(process.execPath, [fileURLToPath(script), path], {
    env: { ...process.env, CODEX_THREAD_ID: '01234567-1234-4321-9876-123456789abc' },
    input: JSON.stringify({ key: 'planting', title: 'Planting brief', text: selection, notes }),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const url = new URL(link.trim());
  assert.equal(url.hostname, '127.0.0.1');
  assert.ok(!link.includes('Planting'));
  return url.searchParams.get('handoff')!;
}

function send(id: string, ticket: string, revision: string, goalId: number | null) {
  return POST({
    params: { id },
    request: new Request('http://office/', {
      method: 'POST',
      body: JSON.stringify({ ticket, revision, goalId })
    })
  } as Parameters<typeof POST>[0]);
}

test('a selection keeps its source, exact files and goal in one manager turn per version', async () => {
  await L.pg`insert into staff ${L.pg({ ...odd('robin', 'Robin'), role: 'Office Manager' })}`;
  const [goal] = await L.pg`insert into goals (title) values ('Open the garden') returning id`;
  const ticket = prepare();
  const first = await previewHandoff(ticket);
  assert.equal(first.staff, 'robin');
  assert.equal(first.excerpt, text);
  assert.deepEqual(first.goals, [{ id: goal.id, title: 'Open the garden' }]);
  assert.equal(history('robin').length, 0);
  await assert.rejects(async () => send('paige', ticket, first.revision, null), { status: 409 });
  await assert.rejects(async () => send('robin', ticket, first.revision, -1), { status: 409 });
  await assert.rejects(async () => send('robin', ticket, 'changed', null), { status: 409 });
  const other = prepare();
  const accepts = await Promise.all(
    [ticket, other].map(async (t) => (await send('robin', t, first.revision, goal.id)).json())
  );
  assert.equal(accepts.filter((r) => r.added).length, 1);
  const kept = history('robin');
  assert.equal(kept.length, 1);
  const line = kept[0];
  assert.match(line.text, /Goal #\d+: Open the garden/);
  assert.deepEqual(line.source, {
    kind: 'Codex',
    id: '01234567-1234-4321-9876-123456789abc/planting',
    revision: first.revision
  });
  assert.equal((await previewHandoff(other)).saved, line.turnId);
  const duplicate = await (await send('robin', other, first.revision, null)).json();
  assert.equal(duplicate.added, false);

  const read = async (index: number) => {
    const raw = await download.GET({
      params: { id: 'robin', turnId: line.turnId, index: String(index) }
    } as Parameters<typeof download.GET>[0]);
    return Buffer.from(await raw.arrayBuffer());
  };
  assert.deepEqual(await read(0), Buffer.from(text));
  assert.deepEqual(await read(1), Buffer.from(notes));
  assert.deepEqual(await read(2), bytes);
  const getReply = () =>
    reply({
      params: { id: 'robin' },
      request: new Request('http://office/', {
        method: 'POST',
        body: JSON.stringify({ turnId: line.turnId })
      })
    } as Parameters<typeof reply>[0]);
  const offline = await L.addAccount('claude', 'Garden');
  await L.pg`update staff set account = ${offline.id} where id = 'robin'`;
  const failed = await getReply();
  const old = activeReply('robin')!;
  assert.match(await failed.text(), /not signed in/);
  assert.equal(history('robin').filter((e) => e.from === 'owner').length, 1);
  assert.equal(history('robin').at(-1)?.failed, true);
  await L.pg`update staff set account = null where id = 'robin'`;
  const answer = await getReply();
  const retry = activeReply('robin')!;
  assert.equal(retry.turnId, old.turnId);
  assert.notEqual(retry.runId, old.runId);
  assert.equal(await stopReply('robin', old.runId), false);
  await answer.text();
  const response = history('robin').find(
    (l) => l.from === 'staff' && l.turnId === line.turnId && !l.failed
  );
  assert.ok(response);
  // The current runner opens attachments by path; the downloads above check every byte.
  for (const file of line.files ?? [])
    assert.ok(response.text.includes(L.home('staff', 'robin', 'attachments', file.name)));
  assert.equal(line.files?.length, 3);

  const changed = prepare('A revised planting plan.');
  const next = await previewHandoff(changed);
  assert.notEqual(next.revision, first.revision);
  assert.equal(next.saved, undefined);
  assert.equal(next.previous, line.turnId);
  await send('robin', changed, next.revision, null);
  assert.equal(history('robin').filter((l) => l.from === 'owner').length, 2);
  assert.deepEqual(await read(0), Buffer.from(text));
});

test('the office reads only a source ticket, never a path or a linked file', async () => {
  const ticket = prepare();
  const dir = join(folder, 'codex-handoffs');
  await assert.rejects(previewHandoff('../' + ticket), { status: 404 });
  const alias = '12345678-4321-4321-9876-123456789abc';
  symlinkSync(file, join(dir, alias));
  await assert.rejects(previewHandoff(alias), { status: 404 });
  const second = '12345678-4321-4321-9876-123456789abd';
  linkSync(file, join(dir, second));
  await assert.rejects(previewHandoff(second), { status: 404 });
  assert.throws(() => prepare(text, file), /regular file/);
});
