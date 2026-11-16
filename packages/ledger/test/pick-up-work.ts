// What the pick-up tests share: the in-memory database, the seeded Odds and the
// helpers that hand work on and read what came back.
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import {
  asks,
  followUps,
  reports,
  staff,
  tasks,
  threads,
  type FollowUpKind
} from '../src/schema.ts';
import { db } from './pglite.ts';

const H = await import('../src/hand-offs.ts');
const O = await import('../src/office.ts');
const T = await import('../src/threads.ts');

const P = await import('../src/task-parking.ts');

const odd = (id: string, name: string) => ({
  id,
  name,
  role: 'Tester',
  remit: 'Tests.',
  variant: 'a',
  portrait: 'a',
  permission: 'draft' as const,
  desk: `You are ${name}.`
});
await db.insert(staff).values([odd('lead', 'Lena'), odd('paige', 'Paige'), odd('rex', 'Rex')]);

type Row = typeof followUps.$inferSelect;

async function byId(id: number): Promise<Row> {
  const [row] = await db.select().from(followUps).where(eq(followUps.id, id));
  return row;
}
/** Every follow-up on a thread of one kind, oldest first. */
const onThread = (id: number, kind: FollowUpKind) =>
  db
    .select()
    .from(followUps)
    .where(and(eq(followUps.threadId, id), eq(followUps.kind, kind)))
    .orderBy(followUps.id);

/** A run that starts and ends at once. */
async function runs(
  f: Row,
  outcome: 'done' | 'failed' | 'waiting',
  text: string,
  joined?: number[]
) {
  assert.ok(await O.startFollowUp(f.id), `follow-up ${f.id} could not start`);
  await O.finishFollowUp(f, f.handOff?.title ?? 'work', outcome, text, { joined });
}
async function threadOf(id: number) {
  const [t] = await db.select().from(threads).where(eq(threads.id, id));
  return t;
}
/** The colleague's run on `h` raises one ask on the hand-off, as raise_ask does. */
async function raises(h: Row, title: string) {
  const { ask } = await O.raiseAsk(h.staffId, {
    title,
    why: 'The work needs it.',
    ifApproved: 'I do it.',
    handOffId: h.id,
    threadId: h.threadId ?? undefined
  });
  return ask;
}

/** Everything on the owner's desk: reports, asks and tasks, in any state. */
const deskItems = async () =>
  (await db.select().from(reports)).length +
  (await db.select().from(asks)).length +
  (await db.select().from(tasks)).length;

/** A piece of work with its own lead and colleague, so no test leans on another's rows. */
async function ownWork(name: string, goalId?: number) {
  const [lead, colleague] = [`lead-${name}`, `colleague-${name}`];
  await db.insert(staff).values([odd(lead, `Lead ${name}`), odd(colleague, `Colleague ${name}`)]);
  const r = await H.handOff({
    from: lead,
    to: colleague,
    work: { title: `Step of ${name}`, brief: 'Do it.' },
    thread: { title: `Work on ${name}`, goalId }
  });
  assert.ok('id' in r, JSON.stringify(r));
  const h = await byId(r.id);
  return { lead, colleague, h, work: h.threadId ?? 0 };
}
async function parksOn(lead: string, work: number, task: number) {
  const parked = await P.parkOnTask(lead, work, task);
  assert.ok('title' in parked, JSON.stringify(parked));
}

// A task the lead gave, on no work: the one kind on no work it may park on (`parkOnTask`).
const aTask = (lead: string, title: string) =>
  O.giveTask(lead, { title, why: 'w', steps: ['Do it'] });

/**
 * Work `hub` leads, with `parker` handed a step on it. `hub` gives a task on
 * that work, and `parker` parks work it leads elsewhere on that task, as an Odd
 * on the task's work may.
 */
async function parkedOnColleaguesTask(name: string) {
  const { lead: hub, colleague: parker, work } = await ownWork(name);
  const helper = `helper-${name}`;
  await db.insert(staff).values(odd(helper, `Helper ${name}`));
  const task = await O.giveTask(hub, {
    title: `Check the ${name} copy`,
    why: 'w',
    steps: ['Check it'],
    threadId: work
  });
  const r = await H.handOff({
    from: parker,
    to: helper,
    work: { title: `Layout of ${name}`, brief: 'Lay it out.' },
    thread: { title: `Layout run of ${name}` }
  });
  assert.ok('id' in r, JSON.stringify(r));
  const parked = (await byId(r.id)).threadId ?? 0;
  await parksOn(parker, parked, task.id);
  return { hub, parker, parked, task: task.id, owner: await O.ownerName() };
}

/** The owner's words reaching `work`'s lead from its colleague's chat (`tellLead`): the lead's pick-up still to start. */
async function toldLead(colleague: string, work: number): Promise<Row> {
  const said = 'Go ahead without the signing.';
  const told = await T.tellLead({
    staffId: colleague,
    threadId: work,
    said,
    words: said,
    reading: 'Sam wants it done now.'
  });
  assert.ok('lead' in told, JSON.stringify(told));
  const pickUp = (await onThread(work, 'resume')).find((f) => f.startedAt === null);
  assert.ok(pickUp, "the owner's words started no pick-up");
  return pickUp;
}

/** A run cut off as a sign-in lapse cuts one off. */
const fails = (f: Row) => O.finishFollowUp(f, 'work', 'failed', 'Claude Code is signed out.');

export {
  odd,
  type Row,
  byId,
  onThread,
  runs,
  threadOf,
  raises,
  deskItems,
  ownWork,
  parksOn,
  aTask,
  parkedOnColleaguesTask,
  toldLead,
  fails
};
