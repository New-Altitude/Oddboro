// A persona Odd's runs in an office under test (office-under-test.ts): its
// coding tool's stand-in works as its hands, then a fake New Altitude
// (`fake-new-altitude.ts`) answers at the persona's door with whatever a test
// sets. The made-up persona `pat` is installed before the tests start, with
// the account and pat's own sign-in already made. Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { after, test } from 'node:test';
import {
  L,
  bus,
  chat,
  followThrough,
  history,
  runOf,
  secrets,
  startedBy
} from './office-under-test.ts';
import { DOOR_SESSION, fakeNewAltitude, MEMBER, PAT } from './fake-new-altitude.ts';

const fake = await fakeNewAltitude();
process.env.ODDBORO_ACCOUNT_SITE = fake.origin;
/** A sign-in kept as the callback keeps it, with both tokens live at the fake. */
function signedIn(id: string, scope: string, token: string, extra: object = {}) {
  fake.issueGrant(`access-${token}`, `refresh-${token}`, scope);
  secrets.set(
    `${id}:oauth`,
    JSON.stringify({
      tokens: {
        access_token: `access-${token}`,
        refresh_token: `refresh-${token}`,
        token_type: 'Bearer',
        expires_in: 3600,
        scope
      },
      savedAt: Date.now(),
      ...extra
    })
  );
}
signedIn('new-altitude-account', 'profile personas', 'seed', {
  profile: { id: MEMBER.id, name: MEMBER.name, email: MEMBER.email },
  discovery: { authorizationServerUrl: fake.origin }
});
signedIn('new-altitude-persona-pat', 'stream', 'door');
// After the office under test is set up, as its own imports are.
const { installPersona, startPersonaGrant } = await import('./persona.ts');
const { draft, RUN_ENDED, runJob } = await import('./staff.ts');
const { QUIET_LINE } = await import('#lib/persona.ts');
await L.setOwnerName('Ada');
await installPersona('pat');
const pat = (await L.personaOdd('pat'))!;
assert.ok(pat, 'pat was not installed');

after(() => fake.close());

let handsRuns = 0;
bus.on(RUN_ENDED, () => handsRuns++);

/** What the office sent pat's door, each turn in order. */
const doorTurns = () =>
  fake.seen
    .filter((s) => s.method === 'POST' && s.path === '/pat/stream')
    .map(
      (s) =>
        JSON.parse(s.body) as {
          message: string;
          sessionId: string;
          turnIndex: number;
          priorTurns?: Record<string, string>[];
        }
    );
const lastTurn = () => doorTurns().at(-1)!;

/** The door's answered body, as the fake sends it by default. */
const ANSWERED = { ...fake.door };
const SAID = 'From what my hands found:\n\nShip it on Friday.\n\nThis is my view, not advice.';
/** A settled body for one of the door's other outcomes, as New Altitude shapes them. */
const body = (outcome: string, more: object = {}) => ({
  outcome,
  speakable: false,
  sentences: [],
  answer: { sessionId: DOOR_SESSION, turnIndex: 0 },
  ...more
});

/** One chat message to pat: every event it sent the page, and the reply the chat kept. */
async function talk(message: string) {
  const events: { type: string; text?: string; message?: string }[] = [];
  const kept = history(pat.id).length;
  await chat(pat.id, message, (e) => events.push(e));
  const added = history(pat.id).slice(kept);
  return { events, reply: added.find((m) => m.from === 'staff')?.text };
}
const REPORT_HEAD = 'What your hands in the office found and did:';
/** The stand-in's report is the JSON of what its run was given. */
const REPORT_START = '{"args":["-p"';

test("a chat with a persona Odd runs its hands, then sends the owner's words and the report to the door, and the reply is the persona's", async () => {
  // The hello pat said at install is a line the office wrote, which the hands' run is told first.
  assert.ok(history(pat.id).some((m) => m.told));
  const runs = handsRuns;
  const turns = doorTurns().length;
  const { events, reply } = await talk(
    'Should we ship the fair poster on Friday? Think aloud: the hands are reading the notes.'
  );
  assert.equal(handsRuns - runs, 1);
  assert.equal(doorTurns().length - turns, 1);
  const { message } = lastTurn();
  assert.ok(message.length <= 4000, `${message.length} characters`);
  const [owner, report] = message.split(REPORT_HEAD);
  assert.ok(owner.startsWith('Ada wrote to you in Oddboro'), owner);
  assert.ok(owner.includes('Should we ship the fair poster on Friday?'));
  assert.ok(!owner.includes('Before this'), owner);
  assert.ok(!owner.includes("I'm Pat"), owner);
  assert.ok(report.trim().startsWith(REPORT_START), report.slice(0, 80));
  assert.ok(report.endsWith('[cut]'));
  assert.equal(reply, SAID);
  assert.ok(!reply.includes('Outcome:'));
  // The page heard the hands' tool steps, then the persona's reply once, and none of the hands' text.
  const own = events.findIndex((e) => e.type === 'delta' && e.text === SAID);
  assert.ok(own > 0, JSON.stringify(events));
  assert.deepEqual(
    events
      .slice(0, own)
      .filter((e) => e.type !== 'reply')
      .map((e) => e.type),
    Array(events.slice(0, own).filter((e) => e.type !== 'reply').length).fill('tool')
  );
  assert.deepEqual(
    events.filter((e) => e.type === 'delta').map((e) => e.text),
    [SAID]
  );
  assert.deepEqual(events.at(-1), { type: 'done', text: SAID });

  // The hands' system prompt is cut from the door's message with the rest of
  // their report. The full preparation stays local for a retry. A draft shows it whole.
  const drafted = await draft(pat.id, 'Draft a note.');
  assert.equal(doorTurns().length - turns, 1);
  const { system } = JSON.parse(drafted.text.slice(0, drafted.text.lastIndexOf('\nOutcome:'))) as {
    system: string;
  };
  assert.ok(system.startsWith(L.personaDesk('Pat', 'Pat Example', 'Ada')), system.slice(0, 300));
  const odd = PAT.odd as Record<string, string>;
  for (const words of [odd.remit, odd.hello, odd.hello.replace('{owner}', 'Ada'), odd.portraitPx])
    assert.ok(!system.includes(words), `the hands were told: ${words.slice(0, 60)}`);
});

test('a chat sends earlier answered exchanges and keeps the session the door returns', async () => {
  rmSync(L.home('staff', pat.id, 'persona-session.json'), { force: true });
  await talk('First question.');
  const first = lastTurn();
  assert.deepEqual(first.priorTurns, []);
  assert.notEqual(first.sessionId, DOOR_SESSION);
  await talk('Second question.');
  const second = lastTurn();
  assert.deepEqual(second.priorTurns, [
    {
      message: 'First question.',
      answer: 'From what my hands found: Ship it on Friday. This is my view, not advice.'
    }
  ]);
  assert.equal(second.sessionId, DOOR_SESSION);
  assert.equal(second.turnIndex, 1);
  // A turn the door did not answer is never sent back as the persona's words.
  fake.door = body('failed');
  await talk('Third question.');
  fake.door = { ...ANSWERED };
  await talk('Fourth question.');
  assert.deepEqual(
    lastTurn().priorTurns?.map((t) => t.message),
    ['First question.', 'Second question.']
  );

  // Only the newest 50 exchanges go to the door, and only they are kept.
  const file = L.home('staff', pat.id, 'persona-session.json');
  const many = Array.from({ length: 60 }, (_, i) => ({ message: `Q${i}`, answer: `A${i}` }));
  writeFileSync(file, JSON.stringify({ sessionId: DOOR_SESSION, turnIndex: 60, priorTurns: many }));
  await talk('Fifth question.');
  const sent = lastTurn().priorTurns!;
  assert.equal(sent.length, 50);
  assert.equal(sent[0].message, 'Q10');
  const kept = (JSON.parse(readFileSync(file, 'utf8')) as { priorTurns: { message: string }[] })
    .priorTurns;
  assert.equal(kept.length, 50);
  assert.equal(kept[0].message, 'Q11');
  assert.equal(kept.at(-1)?.message, 'Fifth question.');
});

test("a hand-off to a persona Odd gives the persona the colleague's brief and returns its reply with the hands' outcome", async () => {
  const h = await L.handOff({
    from: 'lead',
    to: pat.id,
    work: { title: 'Price the fair tickets', brief: "Find last year's ticket price in the notes." },
    thread: { title: 'The fair tickets' }
  });
  assert.ok('id' in h, JSON.stringify(h));
  const f = await L.startFollowUp(h.id);
  assert.ok(f);
  const r = await followThrough(f);
  assert.equal(r.outcome, 'done', r.text);
  assert.equal(r.text, SAID);
  const { message } = lastTurn();
  assert.ok(
    message.includes(
      "Lena asked you: Price the fair tickets\n\nFind last year's ticket price in the notes."
    ),
    message.slice(0, 300)
  );
  assert.equal(lastTurn().priorTurns, undefined);
});

test("a run that reads the owner's no or edit for a lesson stays with its hands and never reaches New Altitude", async () => {
  const turns = doorTurns().length;
  const no = await L.raiseAsk(pat.id, { title: 'Post the fair poster', why: 'w', ifApproved: 'i' });
  await L.decideAsk(no.ask.id, 'deny', 'Never post on a Sunday.');
  const denied = await runOf(await startedBy(no.ask.id, 'denied'), no.ask.id);
  assert.equal(denied.env.LESSON_RUN, '1');

  writeFileSync(L.home('staff', pat.id, 'notes.md'), 'The owner wrote this.');
  assert.ok(await L.learnFromEdit(pat.id, { path: 'notes.md', before: 'Pat wrote this.' }, 'x'));
  const [f] = await L.pg<{ id: number }[]>`
    select id from follow_ups where staff_id = ${pat.id} and kind = 'edited' and outcome is null`;
  const edited = await runOf(f.id);
  assert.equal(edited.env.LESSON_RUN, '1');
  assert.equal(doorTurns().length, turns);
});

test('an over-long report is cut so the message stays within 4,000 characters', async () => {
  // The stand-in's report echoes the job's instructions, so it runs past 10,000 characters.
  const job = await L.addJob({
    staffId: pat.id,
    name: 'Long read',
    instructions: 'Read every note. '.repeat(600),
    schedule: { every: 'day', at: '09:00' }
  });
  const r = await runJob(job, 'manual');
  assert.ok(r.ok, r.text);
  const { message } = lastTurn();
  assert.ok(message.length <= 4000, `${message.length} characters`);
  assert.ok(message.startsWith("Your job in Ada's Oddboro office just ran."), message.slice(0, 80));
  assert.ok(message.endsWith('[cut]'), message.slice(-80));
  assert.equal(r.text, SAID);
});

test('every other door answer returns the report with a note, and a budget wait reads in whole minutes or hours, rounded up', async () => {
  const budget = (seconds: number, line: string): [string, () => void, string] => [
    `refused_budget after ${seconds} seconds`,
    () =>
      void (fake.door = body('refused_budget', {
        refusal: { retryAfterSeconds: seconds }
      })),
    line
  ];
  const cases: [string, () => void, string][] = [
    [
      'refused_content',
      () =>
        void (fake.door = body('refused_content', {
          presentation: { text: 'I only talk about pricing.' }
        })),
      'I only talk about pricing.'
    ],
    budget(30, 'Try again in 1 minute.'),
    budget(70, 'Try again in 2 minutes.'),
    budget(3_600, 'Try again in 1 hour.'),
    budget(73_000, 'Try again in 21 hours.'),
    ['failed', () => void (fake.door = body('failed')), 'Pat could not answer just now.'],
    ['abandoned', () => void (fake.door = body('abandoned')), 'Pat could not answer just now.'],
    [
      'interrupted',
      () => void (fake.door = body('interrupted', { partialReply: 'Ship' })),
      'Pat could not answer just now.'
    ],
    ['503', () => void fake.refused.set('/pat/stream', 503), 'Pat could not answer just now.'],
    [
      'an unreachable refresh',
      () => {
        const blob = JSON.parse(secrets.get('new-altitude-persona-pat:oauth')!);
        secrets.set(
          'new-altitude-persona-pat:oauth',
          JSON.stringify({ ...blob, savedAt: Date.now() - 3_600_000 })
        );
        fake.down.add('/token');
      },
      'Pat could not answer just now.'
    ]
  ];
  for (const [name, set, line] of cases) {
    set();
    const { reply, events } = await talk(`About ${name}?`);
    assert.equal(events.at(-1)?.type, 'error', name);
    assert.equal(history(pat.id).at(-1)?.failed, true, name);
    fake.door = { ...ANSWERED };
    fake.refused.clear();
    fake.down.clear();
    assert.ok(reply, `${name}: the chat kept no reply`);
    assert.ok(reply.split('\n')[0].includes(line), `${name}: ${reply.slice(0, 120)}`);
    assert.ok(reply.includes("Here is what Pat's hands found.\n\n" + REPORT_START), name);
    assert.equal((await L.personaOdd('pat'))?.package?.quiet, undefined, name);
  }
  // The refresh that could not reach New Altitude kept pat's sign-in.
  assert.ok(JSON.parse(secrets.get('new-altitude-persona-pat:oauth')!).tokens);
});

test('a failed judgment keeps its completed preparation, retries only the persona and completes once', async () => {
  const { personaRun } = await import('./persona-run.ts');
  const key = randomUUID();
  const file = L.home('staff', pat.id, 'completed-draft.md');
  let preparations = 0;
  const prepare = async () => {
    preparations++;
    writeFileSync(file, 'The completed draft.');
    return { ok: true, text: 'The draft is saved.\nOutcome: done' };
  };
  const opts = { kind: 'follow-up' as const, timeoutMs: 10000, persona: { key, required: true } };
  fake.door = body('failed');
  const failed = await personaRun(pat, 'Review the draft.', opts, prepare);
  assert.equal(failed.ok, false);
  assert.equal(failed.consultation?.state, 'failed');
  assert.match(failed.text, /Outcome: failed$/);
  assert.equal(readFileSync(file, 'utf8'), 'The completed draft.');
  const turns = doorTurns().length;
  fake.door = { ...ANSWERED };
  const [one, two] = await Promise.all([
    personaRun(pat, 'Review the draft.', opts, prepare),
    personaRun(pat, 'Review the draft.', opts, prepare)
  ]);
  assert.equal(one.ok, true);
  assert.equal(one.consultation?.state, 'answered');
  assert.deepEqual(two, one);
  assert.equal(preparations, 1);
  assert.equal(doorTurns().length, turns + 1);
  assert.deepEqual(await personaRun(pat, 'Review the draft.', opts, prepare), one);
  assert.equal(doorTurns().length, turns + 1);
});

test('an unanswered required hand-off stays failed in the work history', async () => {
  fake.door = body('failed');
  const h = await L.handOff({
    from: 'lead',
    to: pat.id,
    work: { title: 'Required price review', brief: 'Judge the ticket price.' },
    thread: { title: 'The next fair' }
  });
  assert.ok('id' in h);
  const f = (await L.startFollowUp(h.id))!;
  const r = await followThrough(f);
  assert.equal(r.outcome, 'failed');
  assert.doesNotMatch(r.text, /Outcome: done$/);
  await L.finishFollowUp(f, 'Required price review', r.outcome, r.text, { joined: r.joined });
  const [saved] = await L.pg`select outcome, result from follow_ups where id = ${f.id}`;
  assert.equal(saved.outcome, 'failed');
  assert.match(saved.result, /could not answer/);
  fake.door = { ...ANSWERED };
});

test('a restart with no saved preparation never repeats uncertain tool work', async () => {
  const { personaRun } = await import('./persona-run.ts');
  const key = randomUUID();
  await L.beginConsultation({
    key: `${pat.id}/pat/job/${key}`,
    staffId: pat.id,
    slug: 'pat',
    kind: 'job',
    asked: 'Prepare and review.',
    required: true
  });
  let tools = 0;
  const r = await personaRun(
    pat,
    'Prepare and review.',
    { kind: 'job', timeoutMs: 10000, persona: { key, required: true } },
    async () => {
      tools++;
      return { ok: true, text: 'Repeated.' };
    }
  );
  assert.equal(r.ok, false);
  assert.equal(r.consultation?.state, 'pending');
  assert.equal(tools, 0);
  assert.match(r.text, /Check the completed files/);
});

test('Retry on the saved chat message calls no preparation tools and keeps one owner turn', async () => {
  fake.door = body('refused_budget', { refusal: { retryAfterSeconds: 30 } });
  await talk('Review this once.');
  const owner = history(pat.id).findLast((e) => e.from === 'owner')!;
  assert.ok(owner.turnId);
  fake.door = { ...ANSWERED };
  const { replyToOwnerTurn } = await import('./chat-run.ts');
  const tools: string[] = [];
  await replyToOwnerTurn(pat.id, owner.turnId, (e) => {
    if (e.type === 'tool') tools.push(e.name);
  });
  assert.deepEqual(tools, []);
  const entries = history(pat.id).filter((e) => e.turnId === owner.turnId);
  assert.equal(entries.filter((e) => e.from === 'owner').length, 1);
  assert.equal(entries.filter((e) => e.failed).length, 1);
  assert.equal(entries.at(-1)?.text, SAID);
});

test('an optional persona comment cannot undo a completed ordinary result', async () => {
  const { personaRun } = await import('./persona-run.ts');
  fake.door = body('failed');
  const r = await personaRun(
    pat,
    'Acknowledge the completed save.',
    {
      kind: 'follow-up',
      timeoutMs: 10000,
      persona: { key: randomUUID(), required: false }
    },
    async () => ({ ok: true, text: 'The file was saved.\nOutcome: done' })
  );
  assert.equal(r.ok, true);
  assert.equal(r.consultation?.state, 'failed');
  assert.match(r.text, /Outcome: done$/);
  fake.door = { ...ANSWERED };
});

test('Stop during persona judgment interrupts the call and keeps its preparation for retry', async () => {
  const { personaRun } = await import('./persona-run.ts');
  const stop = new AbortController();
  let preparations = 0;
  const opts = {
    kind: 'chat' as const,
    timeoutMs: 10000,
    signal: stop.signal,
    persona: { key: randomUUID(), required: true }
  };
  const prepare = async () => {
    preparations++;
    return { ok: true, text: 'Preparation remains.' };
  };
  const held = fake.hold('/pat/stream');
  const pending = personaRun(pat, 'Review after preparation.', opts, prepare);
  const release = await held;
  stop.abort();
  const stopped = await pending.finally(release);
  assert.equal(stopped.interrupted, true);
  assert.equal(stopped.ok, false);
  const r = await personaRun(
    pat,
    'Review after preparation.',
    { ...opts, signal: undefined },
    prepare
  );
  assert.equal(r.ok, true);
  assert.equal(preparations, 1);
});

test('when the door refuses access the owner still gets the report, the Odd goes quiet and runs nothing next time, and Reconnect signs in afresh', async () => {
  fake.refused.set('/pat/stream', 401);
  const turned = await talk('Are you there?');
  fake.refused.clear();
  assert.ok(turned.reply?.startsWith(QUIET_LINE.grant('Pat')), turned.reply);
  assert.ok(turned.reply?.includes(REPORT_START));
  assert.equal((await L.personaOdd('pat'))?.package?.quiet, 'grant');
  // The refused sign-in is dropped, so Reconnect opens New Altitude's page instead of refreshing it.
  assert.equal(JSON.parse(secrets.get('new-altitude-persona-pat:oauth')!).tokens, undefined);
  assert.ok((await startPersonaGrant('pat')).url);
  signedIn('new-altitude-persona-pat', 'stream', 'door2');
  await L.setQuiet(pat.id, undefined);

  // Tokens a refresh kept while the door turned an older one down stay.
  const KEY = 'new-altitude-persona-pat:oauth';
  const stale = { access_token: 'access-stale', token_type: 'Bearer', expires_in: 3600 };
  secrets.set(KEY, JSON.stringify({ tokens: stale, savedAt: Date.now() }));
  const held = fake.hold('/pat/stream');
  const turning = talk('Anyone there?');
  const release = await held;
  signedIn('new-altitude-persona-pat', 'stream', 'door3');
  release();
  await turning;
  assert.equal(JSON.parse(secrets.get(KEY)!).tokens.access_token, 'access-door3');
  await L.setQuiet(pat.id, undefined);

  fake.door = body('refused_access');
  const { reply } = await talk('Still with us?');
  fake.door = { ...ANSWERED };
  assert.ok(reply?.startsWith(QUIET_LINE.access('Pat')), reply);
  assert.ok(reply?.includes(REPORT_START));
  assert.equal((await L.personaOdd('pat'))?.package?.quiet, 'access');

  const runs = handsRuns;
  const turns = doorTurns().length;
  const kept = history(pat.id).length;
  const quiet = await talk('Hello?');
  assert.ok(!quiet.events.some((e) => e.type === 'tool'));
  assert.equal(handsRuns, runs + 1); // The attempt still has one run-registry lifetime.
  assert.equal(doorTurns().length, turns);
  // A quiet Odd's chat ends as any failed chat does: the owner's line and the
  // quiet line stay, marked failed, so a reload shows both (NEW-1658).
  assert.deepEqual(
    history(pat.id)
      .slice(kept)
      .map(({ from, text, failed }) => ({ from, text, failed })),
    [
      { from: 'owner', text: 'Hello?', failed: undefined },
      { from: 'staff', text: QUIET_LINE.access('Pat'), failed: true }
    ]
  );
  assert.deepEqual(
    quiet.events.filter((e) => e.type !== 'reply'),
    [{ type: 'error', message: QUIET_LINE.access('Pat') }]
  );
});
