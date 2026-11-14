// Which level a follow-up's run works at, by where the work came from, in an
// office under test (office-under-test.ts). Work that serves a colleague's
// hand-off runs at Draft at most whatever its kind, even after a yes that
// raised the Odd's own level or tools, so a colleague's words never stand in
// for the owner's yes. The one exception is the carry-out of an approval ask:
// the owner said yes to that exact action, so it runs at the Odd's level.
// Every Odd here is at Act when its run starts, so a run held to Draft shows
// it. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Level } from '@oddboro/ledger';
import { L, chatOf, gave, odd, runOf, startedBy, type Gave } from './office-under-test.ts';

// The owner passed the Act check (the ledger's act-check.test.ts), so a yes to
// Act goes through. Their name stays as it was.
await L.pg`insert into owner (name, act_check_at) values ('', now())
  on conflict (id) do update set act_check_at = now()`;
const owner = await L.ownerName();
const said = { title: 'Do the thing', why: 'w', ifApproved: 'i' };
const gmailAtAct = { connector: 'gmail', level: 'act' as const };

/** A fresh Odd for one row, so no row's asks or level reach another. */
async function hire(id: string, permission: Level = 'act'): Promise<string> {
  await L.pg`insert into staff ${L.pg({ ...odd(id, id.toUpperCase()), permission, tools: [] })}`;
  return id;
}

/** Work Lena hands `to`, whose run already ended waiting on the owner, as one that raised an ask does. */
async function handedTo(to: string): Promise<{ handOffId: number; threadId: number }> {
  const h = await gave('lead', to, { title: `Work for ${to}` });
  const run = await L.startFollowUp(h.id);
  assert.ok(run, `${to}'s hand-off could not start`);
  await L.finishFollowUp(run, `Work for ${to}`, 'waiting', 'Asked the owner.');
  return { handOffId: h.id, threadId: h.thread };
}

/** The owner's yes to `ask`, and the connect task an access ask's yes gives, done. */
async function approve(ask: number): Promise<void> {
  await L.decideAsk(ask, 'approve', null);
  const tasks = await L.pg<{ id: number }[]>`select id from tasks where ask_id = ${ask}`;
  for (const t of tasks) await L.finishTask(t.id, true, null);
}

/** The carry-out a yes to `ask` started. */
async function approved(ask: number): Promise<{ follow: number; ask: number }> {
  await approve(ask);
  return { follow: await startedBy(ask, 'carry_out'), ask };
}

const iterated = async (ask: number) => {
  await L.decideAsk(ask, 'iterate', 'Make it shorter.');
  return { follow: await startedBy(ask, 'rework'), ask };
};

type State = {
  id: string;
  /** What the row sets up, in the table's words. */
  says: string;
  /** The level the run works at. */
  ceiling: Level;
  /** Sets the row up and names the run: a follow-up and its ask, or the Odd's own chat. */
  go: (o: string) => Promise<{ follow: number; ask?: number; also?: number } | 'chat'>;
  /** A line the run's prompt must hold, with `{owner}`, `{ask}` and `{also}` filled in. */
  brief?: string;
  /** The Odd's level before the row's yes, when the yes is what raises it. */
  from?: Level;
};

const STATES: State[] = [
  {
    id: 's1',
    says: "a yes to Act asked for in a colleague's hand-off carries out at Draft, and says so",
    ceiling: 'draft',
    from: 'draft',
    brief:
      "{owner} approved your ask #{ask} for the Act level. Your own work runs at Act from now on; this run serves a colleague's hand-off, so it works at Draft at most.",
    go: async (o) => {
      const { ask } = await L.raiseAsk(o, {
        ...said,
        kind: 'level',
        level: 'act',
        ...(await handedTo(o))
      });
      return approved(ask.id);
    }
  },
  {
    id: 's2',
    says: "a yes to Act asked for in the Odd's own chat carries out at Act",
    ceiling: 'act',
    from: 'draft',
    brief: '{owner} approved your ask #{ask} for the Act level, and this run has it.',
    go: async (o) => {
      const { ask } = await L.raiseAsk(o, { ...said, kind: 'level', level: 'act' });
      return approved(ask.id);
    }
  },
  {
    id: 's3',
    says: "a yes to an office tool asked for in a colleague's hand-off carries out at Draft",
    ceiling: 'draft',
    go: async (o) => {
      const { ask } = await L.raiseAsk(o, {
        ...said,
        kind: 'office_tool',
        officeTools: ['office_report'],
        ...(await handedTo(o))
      });
      return approved(ask.id);
    }
  },
  {
    id: 's4',
    says: "a yes to an outside tool at write asked for in a colleague's hand-off carries out at Draft",
    ceiling: 'draft',
    go: async (o) => {
      const { ask } = await L.raiseAsk(o, { ...said, access: gmailAtAct, ...(await handedTo(o)) });
      return approved(ask.id);
    }
  },
  {
    id: 's5',
    says: "a yes to an outside tool asked for in the Odd's own job carries out at its level",
    ceiling: 'act',
    go: async (o) => {
      const { ask } = await L.raiseAsk(o, { ...said, access: gmailAtAct });
      return approved(ask.id);
    }
  },
  {
    id: 's6',
    says: "a no with a reason to an ask from a colleague's hand-off is read at Draft",
    ceiling: 'draft',
    go: async (o) => {
      const { ask } = await L.raiseAsk(o, { ...said, ...(await handedTo(o)) });
      await L.decideAsk(ask.id, 'deny', 'Not this week.');
      return { follow: await startedBy(ask.id, 'denied'), ask: ask.id };
    }
  },
  {
    id: 's7',
    says: "the Odd's own chat after a yes to Act works at Act",
    ceiling: 'act',
    from: 'draft',
    go: async (o) => {
      const { ask } = await L.raiseAsk(o, { ...said, kind: 'level', level: 'act' });
      await L.decideAsk(ask.id, 'approve', null);
      return 'chat';
    }
  },
  {
    id: 's8',
    says: "twin outside tool asks, one from the Odd's own job and one from a colleague's hand-off, carry out once, at Draft",
    ceiling: 'draft',
    brief:
      'This also answers your ask #{also}, which another of your runs raised for the same tool: do that work once, here.',
    go: async (o) => {
      const handed = await handedTo(o);
      const own = await L.raiseAsk(o, { ...said, access: gmailAtAct });
      const twin = await L.raiseAsk(o, { ...said, access: gmailAtAct, ...handed });
      await approve(own.ask.id);
      // The hand-off twin carries out and stands for the plain ask, which starts no run.
      const carries = await L.pg<{ id: number; askId: number }[]>`
        select id, ask_id as "askId" from follow_ups where staff_id = ${o} and kind = 'carry_out'`;
      assert.deepEqual(
        carries.map((c) => c.askId),
        [twin.ask.id]
      );
      return { follow: carries[0].id, ask: twin.ask.id, also: own.ask.id };
    }
  },
  {
    id: 's9',
    says: "an ask from a colleague's hand-off sent back to iterate is reworked at Draft",
    ceiling: 'draft',
    go: async (o) => {
      const { ask } = await L.raiseAsk(o, { ...said, access: gmailAtAct, ...(await handedTo(o)) });
      return iterated(ask.id);
    }
  },
  {
    id: 's10',
    says: "a task given in a colleague's hand-off is picked up after at Draft",
    ceiling: 'draft',
    go: async (o) => {
      const task = await L.giveTask(o, {
        title: 'Pick a colour',
        why: 'w',
        steps: ['Pick one.'],
        ...(await handedTo(o))
      });
      await L.finishTask(task.id, true, null);
      const [row] = await L.pg<{ id: number }[]>`
        select id from follow_ups where task_id = ${task.id} and kind = 'task_done'`;
      assert.ok(row, `task ${task.id} started no task_done`);
      return { follow: row.id };
    }
  },
  {
    id: 's11',
    says: "an ask from the Odd's own job sent back to iterate is reworked at its level",
    ceiling: 'act',
    go: async (o) => iterated((await L.raiseAsk(o, said)).ask.id)
  },
  {
    id: 's12',
    says: "a yes to one exact action asked for in a colleague's hand-off carries out at the Odd's level, so it is not held again",
    ceiling: 'act',
    go: async (o) => approved((await L.raiseAsk(o, { ...said, ...(await handedTo(o)) })).ask.id)
  },
  {
    id: 's13',
    says: "one exact action asked for in a colleague's hand-off, sent back to iterate, is reworked at Draft",
    ceiling: 'draft',
    go: async (o) => iterated((await L.raiseAsk(o, { ...said, ...(await handedTo(o)) })).ask.id)
  }
];

for (const s of STATES)
  test(`${s.id.toUpperCase()}: ${s.says}`, async () => {
    const o = await hire(s.id, s.from);
    const started = await s.go(o);
    const who = await L.staffer(o);
    assert.ok(who);
    // At Act when the run starts, so a run held to Draft is told a level below its Odd's.
    assert.equal(who.permission, 'act');
    const run: Gave =
      started === 'chat' ? await chatOf(o) : await runOf(started.follow, started.ask);
    assert.equal(run.env.CEILING, s.ceiling === 'act' ? undefined : s.ceiling);
    assert.ok(
      run.system.includes(`Your level is ${L.LEVEL_NAME[s.ceiling]}:`),
      `${s.id} was not told ${s.ceiling}`
    );
    if (s.brief && started !== 'chat') {
      const line = s.brief
        .replaceAll('{owner}', owner)
        .replace('{ask}', String(started.ask))
        .replace('{also}', String(started.also));
      assert.ok(run.system.includes(line), run.system);
    }
    // The line my_access gives, from the run's own environment as its tool server reads it.
    const access = L.accessInRun(await L.capabilities(who), owner, run.env);
    const capped = `This run serves a colleague's hand-off or was started by the office, so it works at Draft at most, whatever ${owner} has approved.`;
    assert.equal(access.split('\n')[0], L.levelLine(s.ceiling, owner));
    assert.equal(access.includes(capped), s.ceiling === 'draft', access);
  });
