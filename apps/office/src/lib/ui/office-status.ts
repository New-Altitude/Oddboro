// The floor, Odds list and strip read the same status and waiting counts.
import type { Desk } from '@oddboro/ledger';
import { LIVE_TABLES, type LiveTable } from '@oddboro/ledger/live-tables';

export const ON_CHANGE = new Map<string, LiveTable['page']>(
  Object.entries(LIVE_TABLES).map(([table, live]) => [table, live.page])
);
import { ACTIVITY_LABEL, type Activity } from '../staff/roster.ts';
import type { ThreadTag } from '../staff/thread-tags.ts';

export const waitingOf = (desk: Desk, id: string) =>
  [...desk.asks, ...desk.tasks, ...desk.reports]
    .filter((item) => item.staffId === id)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

export const waitingCount = (desk: Desk) =>
  desk.asks.length +
  desk.tasks.length +
  desk.reports.length +
  desk.projectWork.length +
  (desk.away.length ? 1 : 0);

export type FloorActivity = { activity: Activity; heading?: string };
export function oddStatus(o: {
  floor?: FloorActivity;
  message?: number;
  waiting: boolean;
  thread?: ThreadTag;
  working?: string;
}): string {
  if (o.floor?.heading) return `→ ${o.floor.heading}`;
  if (o.message) return 'Has a message for you';
  if (o.waiting) return 'Waiting on you';
  return o.thread?.text ?? o.working ?? (o.floor ? ACTIVITY_LABEL[o.floor.activity] : 'Available');
}

/** An ask, task or unread message brings an Odd to the owner's door. */
export const waitingForOwner = (desk: Desk, messages: Record<string, number>) =>
  new Set([
    ...desk.asks.map((a) => a.staffId),
    ...desk.tasks.map((t) => t.staffId),
    ...Object.keys(messages)
  ]);
