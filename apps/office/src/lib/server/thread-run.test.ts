// What a run on a thread is told: its goal, its work, the owner's answers and the files.
// Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { test } from 'node:test';
import {
  L,
  assertKeychainUntouched,
  gave,
  chat,
  chatOf,
  code,
  followThrough,
  goal,
  odd,
  ownerData,
  runOf,
  type Gave
} from './office-under-test.ts';

test("a lead's chat is told where its goal stands as it starts, and reads the goal's folder; a colleague on the goal's work is told it and reads it too", async () => {
  const [g] = await L.pg<
    { id: number }[]
  >`insert into goals (title) values ('Host the summer fair') returning id`;
  const h = await L.handOff({
    from: 'lead',
    to: 'paige',
    work: { title: 'Count the chairs', brief: 'Count them.' },
    thread: { title: 'The summer fair', goalId: g.id }
  });
  assert.ok('id' in h, JSON.stringify(h));
  const folder = L.threadFolder(h.thread);
  mkdirSync(folder, { recursive: true });
  const before = await chatOf('lead', 'Where is the fair up to?');
  assert.match(before.system, /Count the chairs \(Paige\): not back yet\./);
  assert.equal(
    before.system.split(`## Work ${h.thread}\n`).length,
    2,
    "the goal's work is told in full once"
  );
  assert.ok(
    !before.system.includes(`- Work ${h.thread}:`),
    "the goal's work is not listed again among the lead's latest work"
  );
  assert.doesNotMatch(before.system, /^0$/m, 'an Odd that serves no goal gets no stray 0');
  assert.match(before.system, /Answer .+ from it, over anything you said earlier in this chat\./);
  const { allow, deny } = before.claudeSettings!.permissions;
  assert.ok(allow.includes(`Read(/${folder}/**)`), "the lead's chat may read the goal's folder");
  assert.ok(before.args.includes(folder), "the goal's folder is added to the lead's chat");
  assert.ok(!deny.includes(`Read(/${L.home('threads')})`), 'no deny rule covers it');
  assert.ok(
    !allow.some((a) => a.startsWith(`Edit(/${folder}`)),
    "the lead's chat writes nothing there"
  );

  const f = await L.startFollowUp(h.id);
  assert.ok(f, "Paige's hand-off could not start");
  await L.finishFollowUp(f, 'Count the chairs', 'done', 'Forty chairs.');
  const after = await chatOf('lead', 'And now?');
  assert.match(after.system, /Count the chairs \(Paige\): finished\./);
  // The lead's pick-up of the result gets the same story, without the result its brief already holds.
  const [back] = await L.pg<{ id: number }[]>`
    select id from follow_ups where staff_id = 'lead' and kind = 'handed_back' and thread_id = ${h.thread}`;
  const pickUp = await runOf(back.id);
  assert.match(pickUp.system, /Count the chairs \(Paige\): finished\./);
  assert.doesNotMatch(pickUp.system, /The latest result, from Paige, in full/);

  const colleague = await chatOf('paige', 'How did the count go?');
  assert.match(colleague.system, /Count the chairs \(Paige\)/);
  assert.ok(colleague.args.includes(folder), "a colleague's chat reads the goal's folder");
});

/** The folders a Grok run's own profile lets it read. */
const grokReads = (run: Gave) =>
  JSON.parse(/^read_only = (.+)$/m.exec(run.profile ?? '')?.[1] ?? '[]') as string[];

test("a Grok lead's chat may read its goal's folder, as it is told, through the Odd's own profile", async () => {
  const [g] = await L.pg<
    { id: number }[]
  >`insert into goals (title) values ('Fix the gate') returning id`;
  const h = await L.handOff({
    from: 'gus',
    to: 'paige',
    work: { title: 'Find a hinge', brief: 'Find one.' },
    thread: { title: 'The gate', goalId: g.id }
  });
  assert.ok('id' in h, JSON.stringify(h));
  const folder = L.threadFolder(h.thread);
  mkdirSync(folder, { recursive: true });
  const run = await chatOf('gus', 'Where is the gate up to?');
  assert.ok(run.system.includes(folder), "the chat is not told the goal's folder");
  assert.match(run.system, /you may read the folder above/);
  assert.ok(run.args.includes('odd-gus'), "the chat leaves the Odd's own profile");
  const reads = grokReads(run);
  assert.deepEqual(reads.slice(0, 4), [
    dirname(process.execPath),
    code('packages'),
    code('node_modules'),
    ownerData
  ]);
  assert.ok(reads.includes(folder), run.profile);
  assert.ok(!run.profile?.includes(`${folder}/gus`), 'the chat writes in the goal folder');
});

/** A hand-off from Lena to `to` on work of its own, with no goal. */
async function handedOn(to: string, title: string): Promise<{ id: number; thread: number }> {
  const h = await L.handOff({
    from: 'lead',
    to,
    work: { title, brief: 'Do it.' },
    thread: { title }
  });
  assert.ok('id' in h, JSON.stringify(h));
  return h;
}

/** An ask Lena raised on the work, which the owner approved with `words`. */
async function ownerApproved(thread: number, title: string, words: string): Promise<void> {
  const { ask } = await L.raiseAsk('lead', {
    title,
    why: 'The asking text.',
    ifApproved: 'It goes ahead.',
    threadId: thread
  });
  await L.decideAsk(ask.id, 'approve', words);
}

/** One chat message sent as a reply to a desk item: what its run was given. */
async function replyAbout(id: string, item: { kind: 'ask' | 'task'; id: number }): Promise<Gave> {
  let text = '';
  await chat(
    id,
    'About this one.',
    (e) => {
      if (e.type === 'done') text = e.text;
      if (e.type === 'error') text = e.message;
    },
    item
  );
  assert.ok(text.startsWith('{'), `${id}'s chat gave no reply: ${text}`);
  return JSON.parse(text.slice(0, text.lastIndexOf('\nOutcome:'))) as Gave;
}

test("a colleague's chat on work with no goal is told what each step did and what the owner said on it, and may read its folder, and writes nothing there", async () => {
  const h = await handedOn('paige', 'Sort the receipts');
  const folder = L.threadFolder(h.thread);
  mkdirSync(folder, { recursive: true });
  const f = await L.startFollowUp(h.id);
  assert.ok(f, "Paige's hand-off could not start");
  await L.finishFollowUp(f, 'Sort the receipts', 'done', 'Two boxes sorted.');
  await ownerApproved(h.thread, 'Keep the old receipts', 'Yes, keep them.');

  const run = await chatOf('paige', 'How are the receipts?');
  assert.match(run.system, /1\. Sort the receipts \(Paige\): finished\. Two boxes sorted\./);
  assert.match(run.system, /"Keep the old receipts": approved\. Their words: Yes, keep them\./);
  const { allow } = run.claudeSettings!.permissions;
  assert.ok(allow.includes(`Read(/${folder}/**)`), "the colleague's chat may read the folder");
  assert.ok(
    !allow.some((a) => a.startsWith(`Edit(/${folder}`)),
    "the colleague's chat writes nothing there"
  );
});

test("a lead's chat is told the latest of its work with no goal, by openings, never the full latest result", async () => {
  const h = await handedOn('paige', 'Price the paint');
  const f = await L.startFollowUp(h.id);
  assert.ok(f, "Paige's hand-off could not start");
  await L.finishFollowUp(f, 'Price the paint', 'done', 'Forty pounds.\n\nThe rest of the quote.');

  const run = await chatOf('lead', 'What about the paint?');
  assert.match(run.system, /1\. Price the paint \(Paige\): finished\. Forty pounds\./);
  assert.doesNotMatch(run.system, /The latest result, from Paige, in full/);
  assert.ok(!run.system.includes('The rest of the quote.'), 'the chat holds only the opening');
});

/** Ten answers at their longest on `thread`, from asks `staffId` raised: the most a story's "said" holds. */
async function longestSaid(staffId: string, thread: number): Promise<void> {
  await L.pg`
    insert into asks (staff_id, title, why, if_approved, status, reason, thread_id, decided_at)
    select ${staffId}, ${'t'.repeat(136)}::text || n, 'Why', 'Then', 'approved',
      ${'r'.repeat(500)}::text, ${thread}::int, now()
    from generate_series(1000, 1009) n`;
}

test('work whose story does not fit a chat keeps its line in the list, and its folder stays readable', async () => {
  const goals: number[] = [];
  const work: { thread: number; goal: string }[] = [];
  try {
    for (const n of [1, 2, 3, 4, 5]) {
      const title = `Far goal ${n}`;
      const goalId = await goal(title);
      goals.push(goalId);
      const h = await gave('cleo', 'sam', { title, goalId });
      mkdirSync(L.threadFolder(h.thread), { recursive: true });
      await longestSaid('cleo', h.thread);
      work.push({ thread: h.thread, goal: title });
    }
    // Newer work with no goal fills the latest-work list, so the left-out goals' lines are their own.
    for (const n of [1, 2, 3, 4, 5, 6]) await gave('cleo', 'sam', { title: `Near work ${n}` });
    const whole = L.workLedBrief(await L.ledStories('cleo', 'chat')).length;
    assert.ok(whole > L.CHAT_STORIES_MAX, `the stories fit a chat at ${whole} characters`);

    const run = await chatOf('cleo', 'Where is it all up to?');
    const oldest = work[0];
    const newest = work[4];
    assert.ok(
      run.system.includes(
        `- Work ${oldest.thread}: ${oldest.goal} (under way, for the goal "${oldest.goal}").`
      ),
      'the work left out has no line in the list'
    );
    assert.ok(!run.system.includes(`## Work ${oldest.thread}\n`), 'the oldest story is told');
    assert.ok(run.system.includes(`## Work ${newest.thread}\n`), 'the newest story is not told');
    assert.ok(
      run.claudeSettings!.permissions.allow.includes(`Read(/${L.threadFolder(oldest.thread)}/**)`),
      "the left-out work's folder is not readable"
    );
  } finally {
    // A live goal's story is told in every later chat of Cleo's and Sam's.
    await L.pg`update goals set status = 'dropped' where id = any(${goals}::int[])`;
  }
});

test("a chat's stories of work it leads and of work it is on together keep to the chat's limit", async () => {
  await L.pg`insert into staff ${L.pg([odd('rhea', 'Rhea'), odd('tom', 'Tom')])}`;
  const longWork = async (from: string, to: string, title: string) => {
    const h = await gave(from, to, { title });
    await longestSaid(from, h.thread);
  };
  for (const n of [1, 2]) await longWork('rhea', 'tom', `Led work ${n}`);
  for (const n of [1, 2]) await longWork('tom', 'rhea', `Other work ${n}`);
  const led = await L.ledStories('rhea', 'chat');
  const on = await L.onStories('rhea');
  const ledSize = L.workLedBrief(led).length;
  const onSize = L.workOnBrief(on).length;
  assert.ok(
    ledSize <= L.CHAT_STORIES_MAX && onSize <= L.CHAT_STORIES_MAX,
    `each side alone passes the limit: ${ledSize} led, ${onSize} on`
  );
  assert.ok(
    ledSize + onSize > L.CHAT_STORIES_MAX,
    `the two sides fit the limit together at ${ledSize + onSize} characters`
  );

  const { system } = await chatOf('rhea', 'Where is it all up to?');
  const told = (s: (typeof led)[number]) => system.includes(`## Work ${s.thread.id}\n`);
  assert.ok(led.every(told), 'a story of work Rhea leads is left out');
  assert.ok(on.some(told), 'no story of work Rhea is on is told in what the limit leaves');
  const size = L.workLedBrief(led.filter(told)).length + L.workOnBrief(on.filter(told)).length;
  assert.ok(size <= L.CHAT_STORIES_MAX, `the chat's stories come to ${size} characters`);
});

test('work with no goal whose story a chat is told keeps its line in the list, and the way to continue it', async () => {
  await L.pg`insert into staff ${L.pg([odd('wren', 'Wren')])}`;
  const h = await gave('wren', 'paige', { title: 'Mend the fence' });
  const { system } = await chatOf('wren', 'How is the fence?');
  assert.ok(system.includes(`## Work ${h.thread}\n`), 'the story is not told');
  assert.ok(
    system.includes(`- Work ${h.thread}: Mend the fence (under way).`),
    'the work has no line in the list'
  );
  assert.match(system, /hand_off with continue_work set to its number/);
});

test("a Grok colleague's chat may read the folder of work it is on", async () => {
  const h = await handedOn('gus', 'Oil the hinge');
  const folder = L.threadFolder(h.thread);
  mkdirSync(folder, { recursive: true });
  const run = await chatOf('gus', 'How is the hinge?');
  assert.ok(grokReads(run).includes(folder), run.profile);
});

test("a colleague's run on a hand-off is told what the owner said on the work", async () => {
  const h = await handedOn('paige', 'Hang the sign');
  await ownerApproved(h.thread, 'Use the blue sign', 'Yes, the blue.');
  const run = await runOf(h.id);
  assert.match(run.system, /"Use the blue sign": approved\. Their words: Yes, the blue\./);
});

test('a chat leaves out the folder of work that has none yet', async () => {
  const made = L.threadFolder((await handedOn('paige', 'Work with a folder')).thread);
  const none = L.threadFolder((await handedOn('paige', 'Work with no folder')).thread);
  mkdirSync(made, { recursive: true });
  const { args, claudeSettings } = await chatOf('paige', 'What are you on?');
  const { allow } = claudeSettings!.permissions;
  assert.ok(args.includes(made), 'the folder that exists is not added');
  assert.ok(allow.includes(`Read(/${made}/**)`), 'the folder that exists is not readable');
  assert.ok(!args.includes(none), 'a folder not made yet is added');
  assert.ok(!allow.includes(`Read(/${none}/**)`), 'a folder not made yet is given a read rule');
});

test('a reply about an ask the Odd replaced hears no reason from the owner, and one the owner answered hears theirs', async () => {
  const asked = { why: 'The asking text.', ifApproved: 'It goes ahead.' };
  const { ask: old } = await L.raiseAsk('paige', { title: 'Book the old hall', ...asked });
  await L.raiseAsk('paige', { title: 'Book the new hall', ...asked, revises: old.id });
  const replaced = await replyAbout('paige', { kind: 'ask', id: old.id });
  assert.match(replaced.message, new RegExp(`replying about your ask #${old.id}, `));
  assert.ok(!replaced.message.includes('Their reason'), replaced.message);

  const { ask: turnedDown } = await L.raiseAsk('paige', { title: 'Book the barn', ...asked });
  await L.decideAsk(turnedDown.id, 'deny', 'It floods.');
  const answered = await replyAbout('paige', { kind: 'ask', id: turnedDown.id });
  assert.ok(answered.message.includes('- Their reason: It floods.'), answered.message);
});

test("a reply about a finished task hears only the owner's choice answers", async () => {
  const task = await L.giveTask('paige', {
    title: 'Finish the setup',
    why: 'It waits on you.',
    steps: [
      { text: 'Pick one', done: false, action: { kind: 'choice', options: ['Navy', 'Teal'] } },
      {
        text: 'Paste the key',
        done: false,
        action: { kind: 'secret', connector: 'paint-shop', name: 'key' }
      }
    ]
  });
  await L.tickStep(task.id, 0, 'Navy');
  await L.tickStep(task.id, 1, 'not-for-the-odd');
  await L.finishTask(task.id, true, null);
  const { message } = await replyAbout('paige', { kind: 'task', id: task.id });
  assert.match(message, /- Step 1: Pick one \(done\)\. Their answer: Navy/);
  assert.match(message, /- Step 2: Paste the key \(done\)/);
  assert.ok(!message.includes('not-for-the-odd'), message);
});

test("the run a finished task starts is told where a file attached from a goal's folder is", async () => {
  const name = 'threads/4242/paige/rules.md';
  const task = await L.giveTask('lead', {
    title: 'Read the rules',
    why: 'They changed.',
    steps: ['Read them'],
    attach: [name]
  });
  await L.finishTask(task.id, true, null);
  const [row] = await L.pg<{ id: number }[]>`
    select id from follow_ups where task_id = ${task.id} and kind = 'task_done'`;
  const f = await L.startFollowUp(row.id);
  assert.ok(f, 'the task_done follow-up could not start');
  const r = await followThrough(f, undefined, task);
  assert.equal(r.outcome, 'done', r.text);
  const { message, system } = JSON.parse(r.text) as Gave;
  assert.ok(
    `${system}\n${message}`.includes(`- Attached, with anything they filled in: ${L.home(name)}.`),
    'the run is not told where the file is'
  );
});

test("a lead woken by a colleague's tell_lead is told the work is its to decide and hand on", async () => {
  const [g] = await L.pg<
    { id: number }[]
  >`insert into goals (title) values ('Paint the barn') returning id`;
  const h = await L.handOff({
    from: 'lead',
    to: 'paige',
    work: { title: 'Mix the paint', brief: 'Mix it.' },
    thread: { title: 'The barn', goalId: g.id }
  });
  assert.ok('id' in h, JSON.stringify(h));
  const said = 'Make the barn red.';
  const told = await L.tellLead({
    staffId: 'paige',
    threadId: h.thread,
    said,
    words: said,
    reading: 'They want red paint.'
  });
  assert.deepEqual(told, { lead: 'Lena' });
  const [wake] = await L.pg<{ id: number }[]>`
    select id from follow_ups where staff_id = 'lead' and kind = 'resume' and thread_id = ${h.thread}`;
  assert.ok(wake, 'tell_lead woke no pick-up');
  const { system } = await runOf(wake.id);
  // The note names the owner as the office does, by the name they gave.
  const owner = await L.ownerName();
  assert.ok(
    system.includes(
      `- Paige passed you what ${owner} told them in chat about this work. You decide what comes of it and hand on any work it needs; Paige does nothing more with it. ${owner}'s words: Make the barn red. Paige's own reading, which is not ${owner}'s words: They want red paint.`
    ),
    system
  );
});

test("a chat's tool server gets the exchange from before the owner's message, for tell_lead", async () => {
  const { sayInChat } = await import('./staff.ts');
  await L.pg`insert into staff ${L.pg([odd('nell', 'Nell')])}`;
  sayInChat('nell', 'Which colour did you want?');
  const run = await chatOf('nell', 'Red, please.');
  assert.equal(run.env.CHAT_EXCHANGE, 'Just before, Nell said: "Which colour did you want?".');
});

test("a chat's tool server gets every file the owner attached to the message, for tell_lead, and a chat with none gets nothing", async () => {
  const { attachedFiles, keepAttachment } = await import('./chat-files.ts');
  await L.pg`insert into staff ${L.pg([odd('opal', 'Opal')])}`;
  const kept = [
    { tag: 'Image #1', ...keepAttachment('opal', 'roof.png', 'image/png', Buffer.from('png')) },
    { tag: 'notes.md', ...keepAttachment('opal', 'notes.md', 'text/markdown', Buffer.from('n')) }
  ];
  let text = '';
  await chat(
    'opal',
    'The leak is here [Image #1].',
    (e) => {
      if (e.type === 'done') text = e.text;
      if (e.type === 'error') text = e.message;
    },
    undefined,
    attachedFiles('opal', kept)
  );
  assert.ok(text.startsWith('{'), `Opal's chat gave no reply: ${text}`);
  const run = JSON.parse(text.slice(0, text.lastIndexOf('\nOutcome:'))) as Gave;
  assert.deepEqual(JSON.parse(run.env.OWNER_FILES ?? '[]'), [
    { tag: 'Image #1', path: `attachments/${kept[0].name}`, name: 'roof.png' },
    { tag: 'notes.md', path: `attachments/${kept[1].name}`, name: 'notes.md' }
  ]);
  assert.equal((await chatOf('opal', 'Thanks.')).env.OWNER_FILES, undefined);
});

test("a lead's pick-up on a thread is not told the other work it leads, since it hands on only there", async () => {
  // Other work Lena leads, which her runs on no thread are told of.
  await L.pg`insert into threads (title, hub_id, holder_id) values ('Sweep the yard', 'lead', 'lead')`;
  const h = await L.handOff({
    from: 'lead',
    to: 'paige',
    work: { title: 'Count the cones', brief: 'Count them.' },
    thread: { title: 'The fete' }
  });
  assert.ok('id' in h, JSON.stringify(h));
  const f = await L.startFollowUp(h.id);
  assert.ok(f, "Paige's hand-off could not start");
  await L.finishFollowUp(f, 'Count the cones', 'done', 'Twelve cones.');
  const [back] = await L.pg<{ id: number }[]>`
    select id from follow_ups where staff_id = 'lead' and kind = 'handed_back' and thread_id = ${h.thread}`;
  assert.ok(back, "Paige's result woke no pick-up");
  const pickUp = await runOf(back.id);
  assert.match(pickUp.system, /Count the cones/);
  assert.doesNotMatch(pickUp.system, /## Work you lead/);
  assert.doesNotMatch(pickUp.system, /Sweep the yard/);
});

test('no test reached the keychain', () => {
  assertKeychainUntouched();
});
