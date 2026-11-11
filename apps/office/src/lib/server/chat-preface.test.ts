// What a chat message tells the session before the owner's words. Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chatPreface, lastExchange } from './chat-preface.ts';
import type { ChatEntry } from '../staff/chat.ts';

const owner = (at: string, text: string): ChatEntry => ({ at, from: 'owner', text });
const reply = (at: string, text: string): ChatEntry => ({ at, from: 'staff', text });
const told = (at: string, text: string): ChatEntry => ({ at, from: 'staff', text, told: true });
const poke = (at: string, text: string): ChatEntry => ({ at, from: 'staff', text, poke: true });

test("the last exchange is the owner line and then the last Odd line, each on a line of its own, the Odd's last", () => {
  const who = { owner: 'Sam', odd: 'Bram' };
  const at = '2026-11-03T09:00:00Z';
  assert.equal(
    lastExchange([owner(at, 'First.'), owner(at, 'Which\nfile?'), reply(at, 'The\n  brief.')], who),
    'Just before, Sam said: "Which file?".\nBram replied: "The brief.".'
  );
  for (const line of [told, poke])
    assert.equal(
      lastExchange([owner(at, 'Hi.'), line(at, 'How did it go?')], who),
      'Just before, Sam said: "Hi.".\nBram replied: "How did it go?".'
    );
  const failedLine: ChatEntry = { at, from: 'staff', text: 'It broke.', failed: true };
  const blank = reply(at, ' ');
  assert.equal(
    lastExchange(
      [owner(at, 'Hi.'), reply(at, 'Hello.'), owner(at, 'Well?'), failedLine, blank],
      who
    ),
    'Just before, Sam said: "Hi.".\nBram replied: "Hello.".'
  );
  assert.equal(
    lastExchange([told(at, 'Three questions?')], who),
    'Just before, Bram said: "Three questions?".'
  );
  assert.equal(lastExchange([owner(at, 'Hi.')], who), undefined);
  assert.equal(lastExchange([], who), undefined);
  const long = 'a'.repeat(299) + '😀' + 'b';
  assert.equal(
    lastExchange([owner(at, long), reply(at, long)], who),
    `Just before, Sam said: "${'a'.repeat(299)}".\nBram replied: "${'a'.repeat(299)}".`
  );
});

test("a line the office said in the staffer's name since the owner last wrote is told to the session", () => {
  const lines = chatPreface([told('2026-11-03T09:00:00Z', 'Three questions?')], [], 'resumed');
  assert.deepEqual(lines, ['(Before this, you said to {owner} in chat: "Three questions?".)']);
});

test('a told line from before the owner last wrote is not told again', () => {
  const past = [
    told('2026-11-03T09:00:00Z', 'Three questions?'),
    owner('2026-11-03T09:05:00Z', 'Check with me first.'),
    reply('2026-11-03T09:06:00Z', 'Got it.')
  ];
  assert.deepEqual(chatPreface(past, [], 'resumed'), []);
});

test('only the told lines since the owner last wrote are told, beside the pokes delivered', () => {
  const past = [
    told('2026-11-03T09:00:00Z', 'old hello'),
    owner('2026-11-03T09:05:00Z', 'hi'),
    reply('2026-11-03T09:06:00Z', 'hello'),
    told('2026-11-03T10:00:00Z', 'new line'),
    poke('2026-11-03T11:00:00Z', 'How did the call go?')
  ];
  assert.deepEqual(chatPreface(past, [], 'resumed'), [
    '(Before this, you said to {owner} in chat: "new line".)',
    '(Since {owner} last wrote, the office delivered your pokes to them: "How did the call go?".)'
  ]);
});

test('work put on the desk since the last reply is told, even with a told line after it', () => {
  const past = [
    owner('2026-11-03T09:00:00Z', 'hi'),
    reply('2026-11-03T09:01:00Z', 'hello'),
    told('2026-11-03T10:00:00Z', 'a line')
  ];
  const landed = [
    { kind: 'ask', title: 'Before the reply', at: new Date('2026-11-03T09:00:30Z') },
    { kind: 'task', title: 'After the reply', at: new Date('2026-11-03T09:30:00Z') }
  ];
  assert.deepEqual(chatPreface(past, landed, 'resumed'), [
    '(Before this, you said to {owner} in chat: "a line".)',
    '(Since {owner} last wrote, you put these on their desk: task "After the reply".)'
  ]);
});

test('an ask the owner decided since the last reply is told, and one decided before it is not', () => {
  const past = [owner('2026-11-03T09:00:00Z', 'hi'), reply('2026-11-03T09:01:00Z', 'hello')];
  const at = new Date('2026-11-03T08:00:00Z');
  const landed = [
    {
      kind: 'ask',
      title: 'Book the hall',
      at,
      status: 'approved',
      decidedAt: new Date('2026-11-03T09:30:00Z')
    },
    {
      kind: 'ask',
      title: 'Call the band',
      at,
      status: 'revise',
      decidedAt: new Date('2026-11-03T09:40:00Z')
    },
    {
      kind: 'ask',
      title: 'Old news',
      at,
      status: 'denied',
      decidedAt: new Date('2026-11-03T08:30:00Z')
    },
    { kind: 'ask', title: 'Still open', at, status: 'open', decidedAt: null }
  ];
  assert.deepEqual(chatPreface(past, landed, 'resumed'), [
    '(Since your last reply, {owner} decided your asks: "Book the hall" approved, "Call the band" sent back. my_asks has their reasons.)'
  ]);
});

test('each task the owner ended since the last reply is told once, finished or dropped, and not again', () => {
  const past = [owner('2026-11-03T09:00:00Z', 'hi'), reply('2026-11-03T09:01:00Z', 'hello')];
  const at = new Date('2026-11-03T08:00:00Z');
  const landed = [
    {
      kind: 'task',
      title: 'Pick a blue',
      at,
      status: 'done',
      decidedAt: new Date('2026-11-03T09:30:00Z')
    },
    {
      kind: 'task',
      title: 'Sign the poster',
      at,
      status: 'dropped',
      decidedAt: new Date('2026-11-03T09:35:00Z')
    }
  ];
  assert.deepEqual(chatPreface(past, landed, 'resumed'), [
    '(Since your last reply, {owner} ended your tasks: "Pick a blue" finished, "Sign the poster" dropped. my_tasks has what they said.)'
  ]);
  const later = [
    ...past,
    owner('2026-11-03T09:40:00Z', 'Done that.'),
    reply('2026-11-03T09:41:00Z', 'Thanks.')
  ];
  assert.deepEqual(chatPreface(later, landed, 'resumed'), []);
});

const failed = (at: string, text: string, inSession?: true): ChatEntry => ({
  at,
  from: 'staff',
  text,
  failed: true,
  ...(inSession ? { inSession } : {})
});

test('a resumed session hears that its runs failed on messages it took, and each message it never took, once', () => {
  const past = [
    owner('2026-11-06T09:00:00Z', 'Plan the week.'),
    reply('2026-11-06T09:01:00Z', 'Planned.'),
    owner('2026-11-06T09:02:00Z', 'Book the hall.'),
    failed('2026-11-06T09:07:00Z', 'No reply after 5 minutes.', true),
    owner('2026-11-06T09:09:00Z', 'Order the cake.'),
    failed('2026-11-06T09:10:00Z', 'Quota used up.', true),
    owner('2026-11-06T09:11:00Z', 'Call the band.'),
    failed('2026-11-06T09:11:01Z', 'Could not start Gemini.')
  ];
  assert.deepEqual(chatPreface(past, [], 'resumed'), [
    "(Your runs on {owner}'s last 2 messages you saw before this one failed, so they have no reply from you to them.)",
    '({owner} wrote to you before this, but your run failed each time, so you never saw it:)\n{owner}: Call the band.'
  ]);
});

test('a resumed session holds a message whose run started nothing once a later run that took the session was told it', () => {
  const past = [
    owner('2026-11-06T09:00:00Z', 'Plan the week.'),
    failed('2026-11-06T09:00:01Z', 'Gemini has no API key in this office.'),
    owner('2026-11-06T09:02:00Z', 'Book the hall.'),
    failed('2026-11-06T09:03:00Z', 'Quota used up.', true)
  ];
  assert.deepEqual(chatPreface(past, [], 'resumed'), [
    "(Your runs on {owner}'s last 2 messages you saw before this one failed, so they have no reply from you to them.)"
  ]);
});

test('a new session whose replay the budget cut never had a failed message, whatever session its run took it into', () => {
  const past = [
    owner('2026-11-06T09:02:00Z', 'Book the hall.'),
    failed('2026-11-06T09:07:00Z', 'No reply after 5 minutes.', true)
  ];
  assert.deepEqual(chatPreface(past, [], { replayed: new Set() }), [
    '({owner} wrote to you before this, but your run failed each time, so you never saw it:)\n{owner}: Book the hall.'
  ]);
});

test('a new session hears a failed message its replay holds once, and only that the run on it failed', () => {
  const past = [
    told('2026-11-06T09:00:00Z', 'Three questions?'),
    owner('2026-11-06T09:02:00Z', 'Book the hall.'),
    failed('2026-11-06T09:07:00Z', 'No reply after 5 minutes.')
  ];
  assert.deepEqual(chatPreface(past, [], { replayed: new Set([0, 1]) }), [
    "(Your run on {owner}'s last message you saw before this one failed, so they have no reply from you to it.)"
  ]);
});

test("a failed message the session never saw is retold with its files as they are now: a kept one's path, a gone one said gone", () => {
  const past = [
    {
      ...owner('2026-11-06T09:02:00Z', 'Compare [a.pdf] and [b.png].'),
      now: [
        { tag: 'a.pdf', name: 'k-a.pdf', mediaType: 'application/pdf', size: 1, path: '/o/a.pdf' },
        { tag: 'b.png', gone: true as const }
      ]
    },
    failed('2026-11-06T09:03:00Z', 'Quota used up.')
  ];
  assert.deepEqual(chatPreface(past, [], 'resumed'), [
    [
      '({owner} wrote to you before this, but your run failed each time, so you never saw it:)',
      '{owner}: Compare [a.pdf] and [b.png].',
      '(Files attached, each kept in your folder and named by its tag in brackets. Read each one the answer needs.',
      '- [a.pdf]: /o/a.pdf (application/pdf)',
      '- [b.png]: gone, deleted from your folder since',
      ')'
    ].join('\n')
  ]);
});

test('two failed messages, each with its own pasted [Image #1], each get their own picture under them', () => {
  const picture = (path: string) => [
    { tag: 'Image #1', name: 'k.png', mediaType: 'image/png', size: 1, path }
  ];
  const past = [
    { ...owner('2026-11-06T09:02:00Z', 'What is [Image #1]?'), now: picture('/o/a.png') },
    failed('2026-11-06T09:03:00Z', 'Quota used up.'),
    { ...owner('2026-11-06T09:04:00Z', 'Here it is again, [Image #1]'), now: picture('/o/b.png') },
    failed('2026-11-06T09:05:00Z', 'Quota used up.')
  ];
  const files = (path: string) =>
    [
      '(Files attached, each kept in your folder and named by its tag in brackets. Read each one the answer needs.',
      `- [Image #1]: ${path} (image/png)`,
      ')'
    ].join('\n');
  assert.deepEqual(chatPreface(past, [], 'resumed'), [
    [
      '({owner} wrote to you before this, but your run failed each time, so you never saw it:)',
      '{owner}: What is [Image #1]?',
      files('/o/a.png'),
      '{owner}: Here it is again, [Image #1]',
      files('/o/b.png')
    ].join('\n')
  ]);
});
