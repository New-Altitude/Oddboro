// The Office Manager walks the owner through the desk. When the owner answers,
// finishes, reads or clears one of the manager's items (or one of the office's
// own, which belong to the manager), the office adds one line to the manager's
// chat naming what to do next, with that item's card under it. Fixed words
// built from the desk, never a run, so it costs nothing.
import { ask, desk, manager, orderItems, report, task, type ItemRef } from '@oddboro/ledger';
import { addToChat } from './chat-turns.ts';
import { emit } from './events.ts';

/** Whose item it was: the Odd that raised it, or null for the office's own. */
async function ownerOf(r: ItemRef): Promise<string | null | undefined> {
  if (r.kind === 'ask') return (await ask(r.id))?.staffId;
  if (r.kind === 'task') return (await task(r.id))?.staffId;
  return (await report(r.id))?.staffId;
}

/** After the owner closed `done`: one line in the manager's chat on what comes next. */
export async function narrateNext(done: ItemRef): Promise<void> {
  const m = await manager();
  if (!m) return;
  const from = await ownerOf(done);
  if (from !== m.id && from !== null) return;
  const d = await desk();
  const items = orderItems([
    ...d.asks.map((a) => ({
      kind: 'ask' as const,
      id: a.id,
      createdAt: a.createdAt,
      needs: a.needs,
      title: a.title,
      staffId: a.staffId
    })),
    ...d.tasks.map((t) => ({
      kind: 'task' as const,
      id: t.id,
      createdAt: t.createdAt,
      needs: t.needs,
      title: t.title,
      staffId: t.staffId
    })),
    ...d.reports.map((p) => ({
      kind: 'report' as const,
      id: p.id,
      createdAt: p.createdAt,
      title: p.title,
      staffId: p.staffId
    }))
  ]);
  const next = items.find((i) => !i.blockedBy.length);
  const line = next
    ? `Done. Next: ${next.title}.${next.unblocks.length ? ` That unblocks ${next.unblocks.length}.` : ''}`
    : "Done. That's everything waiting on you.";
  addToChat(m.id, {
    at: new Date().toISOString(),
    from: 'staff',
    text: line,
    told: true,
    ...(next && { re: { kind: next.kind, id: next.id, title: next.title } })
  });
  emit({ type: 'change', table: 'chat' });
}
