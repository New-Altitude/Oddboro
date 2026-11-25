// A chat whose session grew too long, in a throwaway office
// (office-under-test.ts): before the owner's next message the Odd writes its
// handover note in the old session, the session ends, and the reply starts a
// fresh session that opens with the note. A session under the limit resumes
// as before. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { L, chatOf, gaveIn, odd } from './office-under-test.ts';
import { saveSession } from './resume.ts';

const { HANDOVER_ASK, ROLLOVER_TOKENS, handoverFile } = await import('./chat-rollover.ts');

await L.pg`insert into staff ${L.pg([odd('hana', 'Hana'), odd('hugo', 'Hugo')])}`;

test('a session past the limit hands over: the old session writes the note, and the reply starts fresh with it', async () => {
  const first = await chatOf('hana');
  const home = first.configDir ?? '';
  saveSession(L.chatSession('hana'), {
    sessionId: 'long-chat',
    seen: {},
    home,
    context: ROLLOVER_TOKENS + 1
  });
  const reply = await chatOf('hana', 'Where were we?');
  // The handover ran in the old session and was asked for the note.
  const note = readFileSync(handoverFile('hana'), 'utf8');
  const handover = gaveIn(note);
  assert.equal(handover.args[handover.args.indexOf('--resume') + 1], 'long-chat');
  assert.ok(handover.message.includes(HANDOVER_ASK.split('\n')[0]), handover.message);
  // The reply started a fresh session that heard the note.
  assert.ok(!reply.args.includes('--resume'), reply.args.join(' '));
  assert.ok(reply.message.includes('(Your handover note, written'), reply.message);
  assert.ok(reply.message.includes(note.trim().slice(0, 200)), 'the note is not in the message');
  assert.ok(reply.message.endsWith('Where were we?'), reply.message);
  assert.ok(!existsSync(L.chatSession('hana')), 'the old session was kept');
});

test('a session under the limit resumes, with no handover', async () => {
  const first = await chatOf('hugo');
  saveSession(L.chatSession('hugo'), {
    sessionId: 'short-chat',
    seen: {},
    home: first.configDir ?? '',
    context: ROLLOVER_TOKENS - 1
  });
  const reply = await chatOf('hugo', 'And then?');
  assert.equal(reply.args[reply.args.indexOf('--resume') + 1], 'short-chat');
  assert.ok(!existsSync(handoverFile('hugo')), 'a short session wrote a handover note');
  assert.ok(!reply.message.includes('handover note'), reply.message);
});
