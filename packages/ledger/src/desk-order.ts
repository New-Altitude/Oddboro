// The order of what waits on the owner, and the words about their items, which
// the page reads too, so this imports nothing that reaches Postgres.
import type { ItemRef } from './schema.ts';

/** The note on a task the owner cleared from the desk. */
export const CLEARED = 'Cleared from the desk.';

/** One key per item, the same on the server and the page: `ask:12`. */
export const itemKey = (r: ItemRef) => `${r.kind}:${r.id}`;

/** Something waiting on the owner, as ordering needs it. */
export type Waiting = ItemRef & { createdAt: Date | string; needs?: ItemRef[] };

/**
 * What waits on the owner in the order to do it: what can be done now first,
 * then what unblocks the most, then the oldest. An item is blocked while any
 * item it needs is still waiting.
 */
export function orderItems<T extends Waiting>(
  items: T[]
): (T & { blockedBy: T[]; unblocks: T[] })[] {
  const byKey = new Map(items.map((i) => [itemKey(i), i]));
  const blockedBy = new Map(
    items.map((i) => [itemKey(i), (i.needs ?? []).flatMap((n) => byKey.get(itemKey(n)) ?? [])])
  );
  const unblocks = new Map<string, T[]>(items.map((i) => [itemKey(i), []]));
  for (const i of items)
    for (const b of blockedBy.get(itemKey(i))!) unblocks.get(itemKey(b))!.push(i);
  const time = (i: T) => new Date(i.createdAt).getTime();
  return items
    .map((i) => ({
      ...i,
      blockedBy: blockedBy.get(itemKey(i))!,
      unblocks: unblocks.get(itemKey(i))!
    }))
    .sort(
      (a, b) =>
        Number(a.blockedBy.length > 0) - Number(b.blockedBy.length > 0) ||
        b.unblocks.length - a.unblocks.length ||
        time(a) - time(b)
    );
}

/** The one thing to do next: the first that is ready, or nothing. */
export const nextItem = <T extends Waiting>(items: T[]) =>
  orderItems(items).find((i) => !i.blockedBy.length);
