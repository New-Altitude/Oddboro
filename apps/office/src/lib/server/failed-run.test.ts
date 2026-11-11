// A run that fails, in an office under test (office-under-test.ts) whose
// Claude Code is not installed: the owner keeps their words and sees the
// error, in the place RUN_FAILURE declares for that kind of run. Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { UsageKind } from '@oddboro/ledger';
import type { ChatEntry, ChatEvent } from '../staff/chat.ts';
import { L, bin, chatOf, followThrough, odd, refusal, request } from './office-under-test.ts';
import { RUN_FAILURE, type Landing } from './run-failures.ts';
import { chatPreface } from './chat-preface.ts';

// After the office under test set its home and secret store, so the office reads those.
const { start } = await import('./jobs.ts');
const { currentDesign, followDesign, startDesign } = await import('./design-job.ts');
const { replayed, replayedAt } = await import('./replay.ts');
const { keepAttachment } = await import('./chat-files.ts');

/** What every run says when Claude Code is not on the computer. */
const GONE = 'Could not start Claude Code: spawn claude ENOENT';

await L.pg`insert into staff ${L.pg([
  odd('fay', 'Fay'),
  odd('gil', 'Gil'),
  odd('hal', 'Hal'),
  odd('ivy', 'Ivy'),
  odd('kim', 'Kim'),
  odd('lee', 'Lee')
])}`;

/** `fn`, run on a computer without Claude Code: only the stand-ins on PATH, and claude not among them. */
async function withoutClaude<T>(fn: () => Promise<T>): Promise<T> {
  const path = process.env.PATH;
  process.env.PATH = bin;
  renameSync(join(bin, 'claude'), join(bin, 'claude-away'));
  try {
    return await fn();
  } finally {
    renameSync(join(bin, 'claude-away'), join(bin, 'claude'));
    process.env.PATH = path;
  }
}

/** A file the owner sends with a message: by its tag, and its name as the office kept it. */
type Sent = { tag: string; name: string };

/** The owner's page sending one chat message, about a desk item `re` or not, and every event the reply streamed. */
async function send(
  id: string,
  message: string,
  re?: { kind: 'report'; id: number },
  files?: Sent[]
): Promise<ChatEvent[]> {
  const res = await request('/api/staff/[id]/chat', 'POST', {
    params: { id },
    body: { message, re, files }
  });
  return (await res.text())
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice(6)) as ChatEvent);
}

/** The chat as the page loads it, after a reload. */
async function reload(id: string): Promise<ChatEntry[]> {
  const res = await request('/api/staff/[id]/chat', 'GET', { params: { id } });
  return ((await res.json()) as { history: ChatEntry[] }).history;
}

test("a chat whose run fails keeps the owner's message and the error after a reload", async () => {
  const events = await withoutClaude(() => send('fay', 'Are you there?'));
  const failedEvent = events.at(-1);
  assert.ok(failedEvent?.type === 'error');
  assert.equal(failedEvent.message, GONE);
  const [said, failed] = (await reload('fay')).slice(-2);
  assert.deepEqual(
    { from: said.from, text: said.text, failed: said.failed },
    { from: 'owner', text: 'Are you there?', failed: undefined }
  );
  assert.deepEqual(
    { from: failed.from, text: failed.text, failed: failed.failed },
    { from: 'staff', text: GONE, failed: true }
  );
});

test('the next chat after a failed one tells the Odd once what the owner said, and that the run failed', async () => {
  await withoutClaude(() => send('gil', 'Are you there?'));
  const { message } = await chatOf('gil', 'Still there?');
  // Gil's session never started, so the new one hears the chat word for word:
  // the owner's line once, never the error as Gil's own.
  assert.match(message, /: Are you there\?\n/);
  assert.equal(message.split('Are you there?').length - 1, 1, 'the owner line was said twice');
  assert.match(message, /Your run on .*'s last message you saw before this one failed/);
  assert.ok(!message.includes(`You: ${GONE}`), 'the error was replayed as the Odd speaking');
  assert.ok(!message.includes('Files attached'), 'a message with no files was retold with some');
});

/** A PDF the owner attached for `id`, kept as the attachments route keeps one. */
function attachPdf(id: string): Sent & { path: string } {
  const { name } = keepAttachment(id, 'report.pdf', 'application/pdf', new Uint8Array([37, 80]));
  return { tag: 'report.pdf', name, path: L.home('staff', id, 'attachments', name) };
}

test("a new session's retry after a failed chat with a file is told where the file is kept", async () => {
  const pdf = attachPdf('ivy');
  await withoutClaude(() => send('ivy', 'Summarise [report.pdf]', undefined, [pdf]));
  const { message } = await chatOf('ivy', 'Try again.');
  assert.ok(message.includes(`- [report.pdf]: ${pdf.path} (application/pdf)`), message);
});

test('a retry after a failed chat whose file was deleted since is told the file is gone, with no path', async () => {
  const pdf = attachPdf('kim');
  await withoutClaude(() => send('kim', 'Summarise [report.pdf]', undefined, [pdf]));
  rmSync(pdf.path);
  const { message } = await chatOf('kim', 'Try again.');
  assert.ok(message.includes('- [report.pdf]: gone, deleted from your folder since'), message);
  assert.ok(!message.includes(pdf.name), 'the retry was given a path to a file that is gone');
});

test("a new session's replay of a chat with a file names where the file is kept", async () => {
  const pdf = attachPdf('lee');
  // Plain lines, so the replay holds both whole; the stand-in names no session, so the next chat is a new one.
  writeFileSync(
    L.home('staff', 'lee', 'chat.jsonl'),
    [
      {
        at: '2026-11-06T09:00:00.000Z',
        from: 'owner',
        text: 'Read [report.pdf]',
        files: [{ tag: pdf.tag, name: pdf.name, mediaType: 'application/pdf', size: 2 }]
      },
      { at: '2026-11-06T09:01:00.000Z', from: 'staff', text: 'Read it.' }
    ]
      .map((l) => JSON.stringify(l) + '\n')
      .join('')
  );
  const { message } = await chatOf('lee', 'What did it say?');
  assert.match(message, /: Read \[report\.pdf\]\n\(Files attached/);
  assert.ok(message.includes(`- [report.pdf]: ${pdf.path} (application/pdf)`), message);
});

test('a failed chat about a report records no feedback on it, and leaves it unread', async () => {
  const [{ id }] = await L.pg<{ id: number }[]>`
    insert into reports (staff_id, title, body) values ('gil', 'Chair count', 'Twelve chairs.')
    returning id`;
  await withoutClaude(() => send('gil', 'Count them again.', { kind: 'report', id }));
  const [{ n }] = await L.pg<{ n: number }[]>`
    select count(*)::int as n from ledger where title = 'Feedback on: Chair count'`;
  assert.equal(n, 0, 'feedback was recorded for a reply the Odd never got');
  assert.equal((await L.report(id))?.readAt, null);
});

test("a chat whose run throws keeps the owner's message and the error after a reload", async () => {
  // A folder where Hal's session file should be: the run throws reading it.
  mkdirSync(L.chatSession('hal'), { recursive: true });
  try {
    const events = await send('hal', 'Are you there?');
    const last = events.at(-1);
    assert.equal(last?.type, 'error');
    const [said, failed] = (await reload('hal')).slice(-2);
    assert.deepEqual(
      { from: said.from, text: said.text, failed: said.failed },
      { from: 'owner', text: 'Are you there?', failed: undefined }
    );
    assert.deepEqual(
      { from: failed.from, text: failed.text, failed: failed.failed },
      { from: 'staff', text: last?.type === 'error' ? last.message : '', failed: true }
    );
    assert.match(failed.text, /EISDIR/);
  } finally {
    rmSync(L.chatSession('hal'), { recursive: true });
  }
});

test("a new session's replay finds its lines in place when the chat ends in a failed run", () => {
  const chat: ChatEntry[] = [
    { at: '2026-11-06T09:00:00Z', from: 'staff', text: 'Hello.', told: true },
    { at: '2026-11-06T09:01:00Z', from: 'owner', text: 'Are you there?' },
    { at: '2026-11-06T09:02:00Z', from: 'staff', text: GONE, failed: true }
  ];
  const kept = replayed(chat);
  assert.deepEqual(
    kept.map((e) => e.text),
    ['Hello.', 'Are you there?']
  );
  // The told line is found in the replay, so the preface does not say it twice.
  assert.deepEqual(replayedAt(chat, kept), [0, 1]);
});

test('the next chat after a failed one still hears what the Odd put on the desk before it', () => {
  const chat: ChatEntry[] = [
    { at: '2026-11-06T09:00:00.000Z', from: 'owner', text: 'Plan the week.' },
    { at: '2026-11-06T09:01:00.000Z', from: 'staff', text: 'On it.' },
    { at: '2026-11-06T09:03:00.000Z', from: 'owner', text: 'Are you there?' },
    { at: '2026-11-06T09:04:00.000Z', from: 'staff', text: GONE, failed: true }
  ];
  const landed = [{ kind: 'ask', title: 'Book the room', at: new Date('2026-11-06T09:02:00Z') }];
  assert.ok(
    chatPreface(chat, landed, 'resumed').some((line) => line.includes('ask "Book the room"')),
    'the ask put on the desk before the failed run went untold'
  );
});

/** One run of each kind, made to fail; a request's refusal is its reply. */
const FAIL: Record<UsageKind, () => Promise<string | undefined>> = {
  chat: async () => {
    await send('fay', 'Count the chairs.');
    return undefined;
  },
  job: async () => {
    const job = await L.addJob({
      staffId: 'fay',
      name: 'Count the chairs',
      instructions: 'Count the chairs.',
      schedule: { every: 'day', at: '07:00' }
    });
    await start(job, 'manual');
    return undefined;
  },
  'follow-up': async () => {
    const [{ id }] = await L.pg<{ id: number }[]>`
      insert into follow_ups (staff_id, kind) values ('fay', 'first_day') returning id`;
    const f = await L.startFollowUp(id);
    assert.ok(f, 'the follow-up did not start');
    // As follow-ups.ts finishes each one it starts.
    const r = await followThrough(f);
    await L.finishFollowUp(f, await L.workTitle(f), r.outcome, r.text);
    return undefined;
  },
  draft: async () =>
    (await refusal(request('/api/staff/draft', 'POST', { body: { brief: 'Counts chairs.' } })))
      .message,
  look: async () =>
    (
      await refusal(
        request('/api/looks', 'POST', {
          // A model that draws, so the office runs rather than refusing to draw.
          body: { description: 'Tall.', name: 'Ann', role: 'Tester', model: 'claude-opus-5-5' }
        })
      )
    ).message,
  office: async () => {
    const job = startDesign({ description: 'A small office.' });
    await new Promise<void>((done) => followDesign(job, () => {}, done));
    return undefined;
  }
};

const like = `%${GONE}%`;
/** How many times each place shows the error. A reply counts once when it says it. */
const SHOWN: Record<Landing, (reply?: string) => Promise<number>> = {
  chat: async () => (await reload('fay')).filter((e) => e.failed && e.text === GONE).length,
  desk: async () =>
    (await L.pg<{ n: number }[]>`select count(*)::int as n from reports where body like ${like}`)[0]
      .n,
  ledger: async () =>
    (await L.pg<{ n: number }[]>`select count(*)::int as n from ledger where body like ${like}`)[0]
      .n,
  jobs: async () => {
    const res = await request('/api/staff/[id]/jobs', 'GET', { params: { id: 'fay' } });
    const jobs = (await res.json()) as { lastRun?: { status: string; summary: string | null } }[];
    return jobs.filter((j) => j.lastRun?.status === 'failed' && j.lastRun.summary?.includes(GONE))
      .length;
  },
  reply: async (reply) => (reply?.includes(GONE) ? 1 : 0),
  drawing: async () =>
    currentDesign()?.lines.filter((l) => l.step === 'error' && l.message.includes(GONE)).length ?? 0
};
const LANDINGS = Object.keys(SHOWN) as Landing[];

test('a failed run of each kind lands where its RUN_FAILURE row says', async (t) => {
  for (const kind of Object.keys(RUN_FAILURE) as UsageKind[])
    await t.test(kind, async () => {
      const before = await Promise.all(LANDINGS.map((l) => SHOWN[l]()));
      const reply = await withoutClaude(FAIL[kind]);
      const after = await Promise.all(LANDINGS.map((l) => SHOWN[l](reply)));
      assert.deepEqual(
        LANDINGS.filter((_, i) => after[i] > before[i]),
        LANDINGS.filter((l) => RUN_FAILURE[kind].includes(l))
      );
    });
});
