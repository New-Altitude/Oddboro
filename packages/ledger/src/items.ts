// Items: the asks, tasks and reports on the owner's desk, taken as one kind
// of thing. The owner clears one (it closes with no run of its own), deletes
// one (it leaves every view but its Odd's Deleted list) or restores one they
// deleted. The order of what waits is in `desk-order.ts`, which the page reads.
import { and, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import { db } from './db.ts';
import { asks, reports, tasks, type ItemRef } from './schema.ts';
import { withdrawAsk } from './office-decide.ts';
import { finishTask } from './office-tasks.ts';
import { readReport } from './office-desk.ts';
import { ownerName } from './office-usage.ts';
import { record } from './office-ledger.ts';
import { CLEARED } from './desk-order.ts';

export type { ItemRef };
export { itemKey, orderItems, nextItem, type Waiting } from './desk-order.ts';

/** How long a deleted item can still be restored. */
export const RESTORE_DAYS = 30;

const TABLE = { ask: asks, task: tasks, report: reports } as const;

/**
 * Close an item without answering it. An open ask closes as the office's no,
 * which goes back where the ask came from with no run reading it; an open task
 * is dropped as the owner drops it on the desk; a report is marked read.
 * Nothing reaches outside the office. False when there was nothing to clear.
 */
export async function clearItem(r: ItemRef): Promise<boolean> {
  switch (r.kind) {
    case 'ask': {
      const [a] = await db.select().from(asks).where(eq(asks.id, r.id));
      if (a?.status !== 'open') return false;
      await withdrawAsk(r.id, `Set aside by ${await ownerName()}.`);
      return true;
    }
    case 'task': {
      const [t] = await db.select().from(tasks).where(eq(tasks.id, r.id));
      if (t?.status !== 'open') return false;
      return finishTask(r.id, false, CLEARED, {
        responseVersion: t.responseVersion
      });
    }
    case 'report': {
      const [p] = await db.select().from(reports).where(eq(reports.id, r.id));
      if (!p || p.readAt) return false;
      await readReport(r.id);
      return true;
    }
    default: {
      const missed: never = r.kind;
      throw new Error(`No such item: ${String(missed)}`);
    }
  }
}

/** Clear it if it is open, then hide it from every view but its Odd's Deleted list. */
export async function deleteItem(r: ItemRef): Promise<boolean> {
  await clearItem(r);
  const t = TABLE[r.kind];
  const [row] = await db
    .update(t)
    .set({ hiddenAt: new Date() })
    .where(eq(t.id, r.id))
    .returning({ title: t.title });
  if (!row) return false;
  await record({ kind: 'decision', actor: 'owner', title: `Deleted: ${row.title}` });
  return true;
}

/** Bring back an item deleted in the last `RESTORE_DAYS` days. It stays closed. */
export async function restoreItem(r: ItemRef): Promise<boolean> {
  const t = TABLE[r.kind];
  const since = new Date(Date.now() - RESTORE_DAYS * 86_400_000);
  const [row] = await db
    .update(t)
    .set({ hiddenAt: null })
    .where(and(eq(t.id, r.id), isNotNull(t.hiddenAt), gt(t.hiddenAt, since)))
    .returning({ title: t.title });
  if (!row) return false;
  await record({ kind: 'decision', actor: 'owner', title: `Restored: ${row.title}` });
  return true;
}

/**
 * The items a new ask or task waits on (`after` on the tool that raises it),
 * checked: each must be an ask or task open on the desk now. A new item can
 * only wait on one already there, so no ring of waits can form. A string says
 * what is wrong, in words an Odd can act on.
 */
export async function openNeeds(after: ItemRef[] = []): Promise<ItemRef[] | string> {
  if (!after.length) return [];
  const ids = (k: ItemRef['kind']) => after.filter((r) => r.kind === k).map((r) => r.id);
  const [a, t] = await Promise.all([
    ids('ask').length
      ? db
          .select({ id: asks.id, status: asks.status })
          .from(asks)
          .where(inArray(asks.id, ids('ask')))
      : [],
    ids('task').length
      ? db
          .select({ id: tasks.id, status: tasks.status })
          .from(tasks)
          .where(inArray(tasks.id, ids('task')))
      : []
  ]);
  for (const r of after) {
    const row = (r.kind === 'ask' ? a : r.kind === 'task' ? t : []).find((x) => x.id === r.id);
    if (r.kind === 'report' || row?.status !== 'open')
      return `${r.kind === 'task' ? 'Task' : 'Ask'} ${r.id} is not open on the desk, so nothing can wait on it. Leave it out of after.`;
  }
  return after;
}
