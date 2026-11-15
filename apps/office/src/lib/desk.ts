// What the page and the server share about the owner's desk.
import type { Desk } from '@oddboro/ledger';
import type { DeskItem } from '@oddboro/ledger/desk-answers';

/**
 * Each item on the desk by kind and id, such as `ask-12`. The page tells the
 * owner about a key it has not seen, and so does the phone buzz (`push.ts`).
 */
export const deskKeys = (d: Desk): Set<string> =>
  new Set([
    ...d.asks.map((a) => `ask-${a.id}`),
    ...d.tasks.map((t) => `task-${t.id}`),
    ...d.reports.map((r) => `report-${r.id}`)
  ]);

/**
 * The desk key of an item an Odd delivered, while it still waits on the desk,
 * else undefined: a chat opens such an item on the desk, and one that left it
 * elsewhere.
 */
export function waitingKey(d: Desk, item: { kind: DeskItem; id: number }): string | undefined {
  const rows = (() => {
    switch (item.kind) {
      case 'ask':
        return d.asks;
      case 'task':
        return d.tasks;
      case 'report':
        return d.reports;
      default: {
        const missed: never = item.kind;
        throw new Error(`Nothing opens a ${String(missed)}`);
      }
    }
  })();
  return rows.some((r) => r.id === item.id) ? `${item.kind}-${item.id}` : undefined;
}
