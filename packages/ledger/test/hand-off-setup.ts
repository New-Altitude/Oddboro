// What the hand_off tool's tests share: the tool server in its own process, the
// seeded office, and the helpers that read what a tool said.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach } from 'node:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { db, sql } from './tool-server.ts';
import { oneThreadPerGoal } from './one-thread.ts';

const { connectors, goals, grants, staff, threads } = await import('../src/schema.ts');

const { eq } = await import('drizzle-orm');

const { OFFICE_TOOLS, STARTER_TOOLS } = await import('../src/tools.ts');
const { MANAGER_ROLE } = await import('../src/managers.ts');

afterEach(() => oneThreadPerGoal(sql, MANAGER_ROLE));

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
await db
  .insert(staff)
  .values([
    { ...odd('lead', 'Lena'), tools: [...STARTER_TOOLS, 'propose_goal_plan'] },
    odd('paige', 'Paige')
  ]);
// Lena reads Gmail, which Paige lacks.
// Every office has Gmail (0009_google): mark it connected.
await db.update(connectors).set({ readyAt: new Date() }).where(eq(connectors.id, 'gmail'));
await db.insert(grants).values({ staffId: 'lead', connectorId: 'gmail', level: 'read' });

const handOffTool = async (c: Client) =>
  (await c.listTools()).tools.find((t) => t.name === 'hand_off');
/** The first text a tool call returned. */
const said = (r: Awaited<ReturnType<Client['callTool']>>) =>
  (r.content as { type: string; text: string }[])[0]?.text ?? '';

// The two fixtures below serve later tests but are set up here, above the
// first test: under --test-force-exit the runner drops every test registered
// after a top-level await.

// A goal's thread, led by Mo, that Pia (no job) and Jo (a job) serve.
const { asks, jobs, staffGoals, tasks } = await import('../src/schema.ts');
await db
  .insert(staff)
  .values([
    odd('mo', 'Mo'),
    { ...odd('pia', 'Pia'), tools: [...STARTER_TOOLS, 'propose_hire'] },
    odd('jo', 'Jo')
  ]);
// A job description Pia could propose a hire with, so only the goal check stops it.
const { home } = await import('../src/home.ts');
mkdirSync(home('staff', 'pia', 'notes'), { recursive: true });
writeFileSync(home('staff', 'pia', 'notes', 'jd-printer.md'), 'Prints signs.');
const [fair] = await db.insert(goals).values({ title: 'Run the bake sale' }).returning();
const [sale] = await db
  .insert(threads)
  .values({ title: fair.title, goalId: fair.id, hubId: 'mo', holderId: 'mo' })
  .returning();
await db.insert(staffGoals).values([
  { staffId: 'pia', goalId: fair.id, part: 'The signs' },
  { staffId: 'jo', goalId: fair.id, part: 'The cakes' }
]);
await db.insert(jobs).values({
  staffId: 'jo',
  name: 'Weekly accounts',
  instructions: 'Add up.',
  schedule: { every: 'day', at: '09:00' }
});

// Three Odds serving the bake sale Mo leads, holding no office tool, one, and
// every one.
const HOLDERS: Record<string, readonly string[]> = {
  nil: [],
  uno: ['poke_owner'],
  tot: OFFICE_TOOLS.map((t) => t.id)
};
await db
  .insert(staff)
  .values(
    Object.entries(HOLDERS).map(([id, tools]) => ({ ...odd(id, `Odd ${id}`), tools: [...tools] }))
  );
await db
  .insert(staffGoals)
  .values(Object.keys(HOLDERS).map((staffId) => ({ staffId, goalId: fair.id, part: 'Some' })));
// `withGmail` tools come only with Gmail, which only Tot holds.
await db.insert(grants).values({ staffId: 'tot', connectorId: 'gmail', level: 'read' });

const chat = { OWNER_SAID: 'Pia, can you make the signs blue?' };
const ask = { title: 'Make the signs blue', why: 'They asked.', if_approved: 'I make them.' };
const raisedBy = async (staffId: string) => ({
  asks: await db.select().from(asks).where(eq(asks.staffId, staffId)),
  tasks: await db.select().from(tasks).where(eq(tasks.staffId, staffId))
});

const workCount = async () => (await db.select().from(threads)).length;

const put = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

/** Each file in a part of the work with its words, or null when the part is not there. */
const partNow = (part: string) =>
  existsSync(part)
    ? Object.fromEntries(
        readdirSync(part)
          .sort()
          .map((name) => [name, readFileSync(join(part, name), 'utf8')])
      )
    : null;

export {
  odd,
  handOffTool,
  said,
  fair,
  sale,
  HOLDERS,
  chat,
  ask,
  raisedBy,
  workCount,
  put,
  partNow
};
