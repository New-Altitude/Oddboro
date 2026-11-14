// The owner's housekeeping on desk items: Clear (close with no answer and no
// run), Delete (clear, then hide from every view but the Odd's Deleted list)
// and Restore (bring a deleted one back, closed). One item or several at once.
// Nothing here reaches outside the office.
import { error, json } from '@sveltejs/kit';
import { clearItem, deleteItem, restoreItem, type ItemRef } from '@oddboro/ledger';
import { narrateNext } from '#lib/server/narrate.ts';
import type { RequestHandler } from './$types';

const OPS = { clear: clearItem, delete: deleteItem, restore: restoreItem } as const;
const KINDS = new Set(['ask', 'task', 'report']);

const isRef = (r: unknown): r is ItemRef =>
  !!r &&
  typeof r === 'object' &&
  KINDS.has((r as ItemRef).kind) &&
  Number.isInteger((r as ItemRef).id);

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as { op?: string; refs?: unknown };
  const op = OPS[body.op as keyof typeof OPS];
  if (!op) error(400, 'Say clear, delete or restore');
  if (!Array.isArray(body.refs) || !body.refs.length || !body.refs.every(isRef))
    error(400, 'Name the items');
  const done: ItemRef[] = [];
  for (const r of body.refs) if (await op(r)) done.push(r);
  if (op !== restoreItem && done.length) void narrateNext(done.at(-1)!).catch(() => {});
  return json({ done });
};
