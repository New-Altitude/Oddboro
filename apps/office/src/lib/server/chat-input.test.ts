// The owner's POST, saved history and download in an isolated office. The
// test tools answer with the actual arguments and stdin the staff run sent.
import assert from 'node:assert/strict';
import { randomFillSync, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { createImage, encodePng } from '@oddboro/sprites/png';
import { L, folder, history, odd } from './office-under-test.ts';

const { GET, POST } = await import('../../routes/api/staff/[id]/chat/+server.ts');
const download = (await import('../../routes/api/staff/[id]/chat/[turnId]/[index]/+server.ts')).GET;
const { keepOwnerTurn, sayInChat } = await import('./staff.ts');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=',
  'base64'
);
const pic = () => new File([png], 'diagram.png', { type: 'image/png' });

async function post(id: string, turn: object, files?: File[]) {
  const picks =
    files &&
    (await Promise.all(
      files.map(async (f) => ({
        name: f.name,
        data: Buffer.from(await f.arrayBuffer()).toString('base64')
      }))
    ));
  return POST({
    params: { id },
    request: new Request('http://office/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...turn, ...(picks ? { files: picks } : {}) })
    })
  } as Parameters<typeof POST>[0]);
}

async function last(res: Response) {
  const events = (await res.text()).trim().split('\n\n');
  return JSON.parse(events.at(-1)!.slice(6));
}

function gave(event: { type: string; text: string; message?: string }) {
  assert.equal(event.type, 'done', event.message);
  return JSON.parse(event.text.split('\nOutcome:')[0]);
}

test('a failed turn reloads with its exact brief and files, and retry answers the same turn once', async () => {
  const id = 'fern';
  await L.pg`insert into staff ${L.pg({ ...odd(id, 'Fern'), agent: 'gemini' })}`;
  const [{ id: ask }] = await L.pg<
    { id: number }[]
  >`insert into asks (staff_id, kind, title, why, if_approved)
    values (${id}, 'approval', 'Plot map', 'Plan the rows', 'Keep the plan') returning id`;
  const re = { kind: 'ask', id: ask };
  const turnId = randomUUID();
  const wait = join(folder, 'ready');
  const message = `  A brief for {owner}.\n${'plant seeds; '.repeat(1200)}\nHold until ${wait} exists.  `;
  const note = '# Plot map\r\n\r\nKeep {owner} as written.\r\n';
  const markdown = new File([note], 'plan.md');
  const sent = await post(id, { turnId, message, re }, [markdown, pic()]);
  assert.match((await last(sent)).message, /Gemini cannot receive pictures/);
  const get = () => GET({ params: { id } } as Parameters<typeof GET>[0]);
  const reload = await (await get()).json();
  assert.equal(reload.busy, false);
  const own = reload.history.filter((e: { from: string }) => e.from === 'owner');
  assert.equal(own.length, 1);
  const [line] = own;
  assert.deepEqual(line.re, { ...re, title: 'Plot map' });
  assert.equal(line.text, message);
  assert.equal(line.turnId, turnId);
  assert.deepEqual(line.source, { kind: 'chat' });
  assert.deepEqual(
    line.files.map((f: { tag: string }) => f.tag),
    ['plan.md', 'diagram.png']
  );
  const file = await download({ params: { id, turnId, index: '1' } } as Parameters<
    typeof download
  >[0]);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), png);
  await L.pg`update staff set agent = 'claude' where id = ${id}`;
  const trying = await post(id, { turnId });
  await assert.rejects(async () => post(id, { turnId }), { status: 409 });
  assert.equal(
    (await (await get()).json()).history.filter(
      (e: { turnId?: string; from: string }) => e.turnId === turnId && e.from === 'owner'
    ).length,
    1
  );
  writeFileSync(wait, '');
  const result = await last(trying);
  const run = gave(result);
  assert.ok(run.args.includes('--input-format'));
  const blocks = JSON.parse(run.message).message.content;
  assert.deepEqual(blocks[0], {
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') }
  });
  assert.ok(blocks[1].text.includes(message));
  assert.equal(readFileSync(L.home('staff', id, 'attachments', line.files[0].name), 'utf8'), note);
  assert.match(blocks[1].text, /Plot map/);
  const repeated = await last(await post(id, { turnId, message, re }, [markdown, pic()]));
  assert.deepEqual(repeated, result);
  await assert.rejects(async () => post(id, { turnId, message: 'Changed.' }), { status: 400 });
  assert.deepEqual(
    history(id).map((e) => [e.from, e.turnId]),
    [
      ['owner', turnId],
      ['staff', turnId], // The failed attempt remains part of the history.
      ['staff', turnId]
    ]
  );
});

test('a file-only Codex turn sends the picture on a fresh and a resumed session; Grok receives its bytes', async () => {
  await L.pg`insert into staff ${L.pg({ ...odd('kit', 'Kit'), agent: 'codex' })}`;
  const screen = createImage(1152, 768);
  randomFillSync(screen.data);
  const original = Buffer.from(encodePng(screen));
  assert.ok(original.length > 3 * 1024 * 1024);
  for (const resume of [false, true]) {
    const run = gave(
      await last(
        await post('kit', { turnId: randomUUID(), message: '' }, [
          new File([original], 'screen.png')
        ])
      )
    );
    assert.deepEqual(run.pictures, [true]);
    const image = run.args.findIndex((a: string) => a.startsWith('--image='));
    assert.equal(run.args.includes('resume'), resume);
    assert.ok(image > run.args.indexOf('resume'));
    assert.deepEqual(readFileSync(run.args[image].slice(8)), original);
  }
  const auth = join(folder, 'accounts', 'grok', 'office');
  mkdirSync(auth, { recursive: true });
  writeFileSync(
    join(auth, 'auth.json'),
    JSON.stringify({ 'https://auth.x.ai::test': { expires_at: Date.now() + 86_400_000 } })
  );
  const run = gave(await last(await post('gus', { turnId: randomUUID(), message: '' }, [pic()])));
  assert.deepEqual(run.prompt[0], {
    type: 'image',
    mimeType: 'image/png',
    data: png.toString('base64')
  });
});

test('an import keeps a revision once without a run and bad files do not add a line', async () => {
  const input = {
    turnId: randomUUID(),
    message: '',
    source: { kind: 'handoff', id: 'garden', revision: '1' },
    files: [{ name: 'plan.txt', bytes: Buffer.from('Plant bulbs.') }]
  };
  const [a, b] = await Promise.all([keepOwnerTurn('sam', input), keepOwnerTurn('sam', input)]);
  assert.deepEqual(a, b);
  assert.deepEqual(a.source, input.source);
  assert.equal(history('sam').length, 1);
  for (const file of [
    new File(['not a picture'], 'seed.png'),
    new File([new Uint8Array([255])], 'seed.txt')
  ])
    await assert.rejects(async () => post('sam', { turnId: randomUUID(), message: '' }, [file]), {
      status: 400
    });
  assert.equal(history('sam').length, 1);
});

test('a preset answer has one saved reply; files and imports reach the manager even with those words', async () => {
  const [first, second] = L.FIRST_QUESTIONS;
  sayInChat('cleo', first.ask);
  const turnId = randomUUID();
  const done = await last(await post('cleo', { turnId, message: first.answers[0] }));
  assert.ok(done.text.endsWith(second.ask));
  assert.deepEqual(await last(await post('cleo', { turnId })), done);
  assert.deepEqual(
    history('cleo')
      .filter((e) => e.turnId === turnId)
      .map((e) => e.from),
    ['owner', 'staff']
  );
  const input = { turnId: randomUUID(), message: second.answers[0], source: { kind: 'handoff' } };
  await keepOwnerTurn('cleo', input);
  assert.ok(
    gave(await last(await post('cleo', { turnId: input.turnId }))).message.endsWith(input.message)
  );
  sayInChat('cleo', first.ask);
  const file = new File(['Use the north plot.'], 'map.md');
  const run = gave(
    await last(await post('cleo', { turnId: randomUUID(), message: first.answers[0] }, [file]))
  );
  assert.match(run.message, /map\.md/);
  const owner = history('cleo').findLast((e) => e.from === 'owner');
  assert.equal(
    readFileSync(L.home('staff', 'cleo', 'attachments', owner!.files![0].name), 'utf8'),
    'Use the north plot.'
  );
});

test('an older chat keeps its files and accepts ten current uploads, including a PDF, without another store', async () => {
  const { keepAttachment } = await import('./chat-files.ts');
  const { addToChat } = await import('./chat-turns.ts');
  const old = {
    at: '2026-11-01T09:00:00.000Z',
    from: 'owner' as const,
    text: 'Keep this earlier choice.'
  };
  addToChat('paige', old);
  const files = Array.from({ length: 10 }, (_, i) => {
    const name = i === 0 ? 'earlier-plan.pdf' : `note-${i}.md`;
    const bytes = Buffer.from(i === 0 ? '%PDF-1.7\nKept original' : `Note ${i}`);
    return { ...keepAttachment('paige', name, '', bytes), tag: name };
  });
  const turnId = randomUUID();
  const input = { turnId, message: 'Read these ten files.', files };
  assert.equal((await last(await post('paige', input))).type, 'done');
  assert.deepEqual(history('paige')[0], old);
  const own = history('paige').find((e) => e.turnId === turnId && e.from === 'owner');
  assert.deepEqual(
    own?.files,
    files.map(({ tag, name, mediaType, size }) => ({ tag, name, mediaType, size }))
  );
  assert.equal(
    readFileSync(L.home('staff', 'paige', 'attachments', files[0].name), 'utf8'),
    '%PDF-1.7\nKept original'
  );
  await last(await post('paige', input));
  assert.equal(history('paige').filter((e) => e.turnId === turnId && e.from === 'owner').length, 1);
  await assert.rejects(
    async () => post('paige', { ...input, turnId: randomUUID(), files: [...files, files[0]] }),
    { status: 400 }
  );
});
