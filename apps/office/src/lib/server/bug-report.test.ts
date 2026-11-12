// The owner posts to GitHub through a stand-in for its CLI.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { L, bin, chat, chatOf, folder, history, withEnv } from './office-under-test.ts';
import type { ChatEvent } from '../staff/chat.ts';

const { POST } = await import('../../routes/api/staff/[id]/bug-reports/+server.ts');
const { activeReply } = await import('./chat-run.ts');

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

test('a typed request to report a bug goes to the Odd as a normal message', async () => {
  const message = 'please report this message as a bug: x';
  const before = history('lead').length;
  const gave = await chatOf('lead', message);
  assert.ok(gave.message.includes(message), gave.message);
  // The Odd hears how to draft one for the owner to file, never a typed command.
  assert.match(gave.message, /draft the report with draft_bug_report/);
  assert.match(gave.message, /Tell them to click File this/);
  const chat = history('lead').slice(before);
  assert.deepEqual(
    chat.map((e) => e.from),
    ['owner', 'staff']
  );
  assert.equal(chat[0].text, message);
  // The reply is the Odd's run, not a line the office wrote.
  assert.equal(chat[1].told, undefined);
});

/**
 * A chat reply while its run drafts `draft`: the run holds until the draft is
 * kept under `run(runId)`, as the Odd's draft_bug_report keeps it, then ends.
 */
async function replyDrafting(
  id: string,
  ready: string,
  keep: (runId: string) => void
): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  const replying = chat(id, `Please report this bug.\nHold until ${ready} exists.`, (e) =>
    events.push(e)
  );
  let runId: string | undefined;
  while (!(runId = activeReply(id)?.runId)) await new Promise((r) => setTimeout(r, 20));
  keep(runId);
  writeFileSync(ready, '');
  await replying;
  return events;
}

test('a draft the Odd keeps in its chat run comes back on its reply, for File this, and nothing is posted', async () => {
  const draft = {
    title: 'Chat lost an attached file',
    body: 'What happened\n\nThe file vanished.'
  };
  const before = history('lead').length;
  const events = await replyDrafting('lead', join(folder, 'bug-draft-ready'), (runId) =>
    L.keepBugDraft('lead', runId, draft)
  );
  const done = events.find((e) => e.type === 'done');
  assert.deepEqual(done?.type === 'done' && done.bug, draft);
  // Only the owner's line and the reply.
  const chat = history('lead').slice(before);
  assert.deepEqual(
    chat.map((e) => e.from),
    ['owner', 'staff']
  );
  // The reply keeps the title and details as the Odd gave them, for the form to open with.
  assert.deepEqual(chat[1].bug, draft);
  // Nothing went to GitHub: a post would add the issue's link as a told line after the reply.
  assert.equal(chat[1].told, undefined);
  assert.equal(existsSync(L.home('staff', 'lead', L.OFFICE_FILES.bugDraft)), false);
});

test("a draft kept for another run never reaches this run's reply", async () => {
  const before = history('lead').length;
  await replyDrafting('lead', join(folder, 'stale-draft-ready'), () =>
    L.keepBugDraft('lead', 'an-earlier-run', { title: 'Old', body: 'Old details' })
  );
  const reply = history('lead').slice(before).at(-1);
  assert.equal(reply?.from, 'staff');
  assert.equal(reply?.bug, undefined);
  assert.equal(existsSync(L.home('staff', 'lead', L.OFFICE_FILES.bugDraft)), false);
});
