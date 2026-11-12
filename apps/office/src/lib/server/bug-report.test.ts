// The owner posts to GitHub through a stand-in for its CLI.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { bin, folder, history, withEnv } from './office-under-test.ts';

const { POST } = await import('../../routes/api/staff/[id]/bug-reports/+server.ts');

const post = (fields: unknown, id = 'lead') =>
  POST({
    params: { id },
    request: new Request('http://localhost', { method: 'POST', body: JSON.stringify(fields) })
  } as Parameters<typeof POST>[0]);

test('invalid reports are refused before the CLI runs', async () => {
  await assert.rejects(async () => post({ title: ' ', body: 'text' }), { status: 400 });
  await assert.rejects(async () => post({ title: 'Too long', body: 'x'.repeat(65537) }), {
    status: 400
  });
  await assert.rejects(async () => post({}, 'missing-odd'), { status: 404 });
});

test('an unavailable CLI leaves the chat alone', async () => {
  const before = history('lead').length;
  await withEnv({ PATH: '' }, async () => {
    await assert.rejects(async () => post({ title: 'Example', body: 'Details' }), { status: 503 });
  });
  assert.equal(history('lead').length, before);
});

test(
  'only a confirmed post adds an issue link to the chat',
  { skip: process.platform === 'win32' },
  async () => {
    const gh = join(bin, 'gh');
    const sent = join(folder, 'github-input.json');
    const fields = { title: 'A test report', body: 'A line with "quotes"\nand another line.' };
    const before = history('lead').length;
    writeFileSync(
      gh,
      `#!${process.execPath}
const fs = require('node:fs');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
fs.writeFileSync(${JSON.stringify(sent)}, JSON.stringify({ input, args: process.argv.slice(2), token: process.env.GH_TOKEN }));
console.log(input.title === 'A test report' ? '72' : 'no issue number');
`
    );
    chmodSync(gh, 0o755);
    try {
      await withEnv({ PATH: bin, GH_TOKEN: 'test-only' }, async () => {
        const result = await post({ ...fields, repo: 'other/repo', history: ['private'] });
        assert.equal(result.status, 201);
        assert.deepEqual(await result.json(), { number: 72, saved: true });
        assert.deepEqual(JSON.parse(readFileSync(sent, 'utf8')), {
          input: fields,
          args: [
            'api',
            '--hostname',
            'github.com',
            '--method',
            'POST',
            'repos/New-Altitude/Oddboro/issues',
            '--input',
            '-',
            '--jq',
            '.number'
          ]
        });
        const chat = history('lead');
        assert.equal(chat.length, before + 1);
        assert.equal(
          chat.at(-1)?.text,
          'Filed [Oddboro issue #72](https://github.com/New-Altitude/Oddboro/issues/72).'
        );
        await assert.rejects(async () => post({ ...fields, title: 'Unconfirmed' }), {
          status: 502
        });
        assert.equal(history('lead').length, chat.length);
      });
    } finally {
      if (existsSync(gh)) unlinkSync(gh);
    }
  }
);
