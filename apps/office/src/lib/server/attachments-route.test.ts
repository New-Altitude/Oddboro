// The routes that keep a chat attachment and serve it back, through the Odd's
// own attachments folder only (`attachmentPath` and `keepAttachment` in
// chat-files.ts). Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { L, folder, odd } from './office-under-test.ts';

const upload = await import('../../routes/api/staff/[id]/attachments/+server.ts');
const served = await import('../../routes/api/staff/[id]/attachments/[name]/+server.ts');
type UploadEvent = Parameters<typeof upload.POST>[0];
type ServedEvent = Parameters<typeof served.GET>[0];

await L.pg`insert into staff ${L.pg([odd('ines', 'Ines')])}`;

const send = (bytes: string) =>
  upload.POST({
    params: { id: 'ines' },
    request: new Request('http://127.0.0.1/api/staff/ines/attachments', {
      method: 'POST',
      headers: { 'x-file-name': 'shot.png', 'x-media-type': 'image/png' },
      body: bytes
    })
  } as UploadEvent);
const fetchFile = (name: string) => served.GET({ params: { id: 'ines', name } } as ServedEvent);

test('a picture sent to an Odd is kept in its own attachments folder and served back from it', async () => {
  const kept = (await (await send('picture')).json()) as { name: string };
  const res = await fetchFile(kept.name);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(await res.text(), 'picture');
});

test('through an attachments folder the Odd swapped for a link, nothing is kept and nothing is served', async () => {
  const outside = join(folder, 'ines-outside');
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, 'secret.png'), 'outside');
  const dir = L.home('staff', 'ines', 'attachments');
  mkdirSync(dir, { recursive: true });
  renameSync(dir, `${dir}-away`);
  symlinkSync(outside, dir);
  try {
    await assert.rejects(
      async () => send('through the link'),
      (e: { status?: number; body?: { message?: string } }) =>
        e.status === 409 && /attachments folder is not its own/.test(e.body?.message ?? '')
    );
    assert.deepEqual(readdirSync(outside), ['secret.png'], 'a file was kept through the link');
    await assert.rejects(
      async () => fetchFile('secret.png'),
      (e: { status?: number }) => e.status === 404
    );
  } finally {
    rmSync(dir);
    renameSync(`${dir}-away`, dir);
  }
});
