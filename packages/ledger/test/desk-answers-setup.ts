// What the desk answer tests share: the in-memory database, the seeded Odds and the
// helpers that read what reached an Odd since a mark.
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';
import { eq, max } from 'drizzle-orm';
import {
  connectors,
  followUps,
  goals,
  grants,
  owner,
  staff,
  staffGoals,
  threads
} from '../src/schema.ts';
import { db } from './pglite.ts';

// The owner passed the Act check (act-check.test.ts), so a level ask's yes to
// Act goes through. No name, so the owner is still "the owner".
await db.insert(owner).values({ name: '', actCheckAt: new Date() });
// A home of the test's own, so a folder ask's folder can be given.
const HOME = realpathSync(mkdtempSync(join(tmpdir(), 'desk-answers-')));
process.env.HOME = HOME;
after(() => rmSync(HOME, { recursive: true, force: true }));

const { MANAGER_ROLE } = await import('../src/managers.ts');

const odd = (id: string, name: string, role = 'Tester') => ({
  id,
  name,
  role,
  remit: 'Tests.',
  variant: 'a',
  portrait: 'a',
  permission: 'draft' as const,
  desk: `You are ${name}.`
});
// Ada asks, Ivy is her colleague, and Max manages the office.
await db
  .insert(staff)
  .values([odd('ada', 'Ada'), odd('ivy', 'Ivy'), odd('max', 'Max', MANAGER_ROLE)]);
// Every office has Gmail (0009_google): mark it connected.
await db.update(connectors).set({ readyAt: new Date() }).where(eq(connectors.id, 'gmail'));

/** A thread Ada leads, with `at` hand-offs used. */
async function thread(at = 0): Promise<number> {
  const [t] = await db
    .insert(threads)
    .values({ title: 'Plan the fair', hubId: 'ada', holderId: 'ada', handOffsUsed: at })
    .returning({ id: threads.id });
  return t.id;
}
async function aGoal(title: string): Promise<number> {
  const [g] = await db.insert(goals).values({ title }).returning({ id: goals.id });
  return g.id;
}

/**
 * Each grant, each tool an Odd uses without asking, and each Odd serving a
 * goal, keyed by the row, as what it shows an Odd got.
 */
async function held(): Promise<Map<string, string>> {
  const granted = await db.select().from(grants);
  const served = await db.select().from(staffGoals);
  return new Map([
    ...granted.map((g) => [`${g.staffId} ${g.connectorId}`, `grant:${g.staffId}`] as const),
    ...granted.flatMap((g) =>
      g.standing.map(
        (t) => [`${g.staffId} ${g.connectorId} ${t}`, `standing:${g.staffId}`] as const
      )
    ),
    ...served.map((s) => [`${s.staffId} goal ${s.goalId}`, `serves:${s.staffId}`] as const)
  ]);
}
type Mark = { followUp: number; notes: Map<number, string | null>; held: Map<string, string> };
async function markNow(): Promise<Mark> {
  const [last] = await db.select({ id: max(followUps.id) }).from(followUps);
  const notes = await db.select({ id: followUps.id, note: followUps.note }).from(followUps);
  return {
    followUp: last?.id ?? 0,
    notes: new Map(notes.map((f) => [f.id, f.note])),
    held: await held()
  };
}
/**
 * The follow-ups an answer reached since `mark`: each new one, and each one
 * waiting since before that an answer joined as a line (`offWorkAnswer`).
 */
async function since(mark: Mark) {
  const ups = await db.select().from(followUps).orderBy(followUps.id);
  return ups.filter((f) => f.id > mark.followUp || f.note !== mark.notes.get(f.id));
}
/**
 * What reached an Odd since `mark`: each follow-up new or joined as `<kind>:<odd>`, each
 * new grant as `grant:<odd>`, each tool it newly uses without asking as
 * `standing:<odd>`, and each Odd newly serving a goal as `serves:<odd>`.
 */
async function reached(mark: Mark): Promise<string[]> {
  const ups = await since(mark);
  const now = await held();
  return [
    ...ups.map((f) => `${f.kind}:${f.staffId}`),
    ...[...now].filter(([key]) => !mark.held.has(key)).map(([, shown]) => shown)
  ].sort();
}

/** Ada's `answered` runs an answer reached since `mark`. */
const heard = async (mark: Mark) =>
  (await since(mark)).filter((f) => f.staffId === 'ada' && f.kind === 'answered');

export { HOME, odd, thread, aGoal, markNow, reached, heard };
