// The news of each hand-off for the floor: an Odd handing a colleague work, and
// the result going back. The same cursor as a lesson's news (lessons.ts), read
// from `follow_ups`, so the page hears each one once.
import { and, gt, inArray, max } from 'drizzle-orm';
import { db } from './db.ts';
import { followUps } from './schema.ts';

/**
 * An Odd handed a colleague work (`given`), or a colleague's result went back
 * (`back`). `from` is the Odd that walks over, `to` the one it walks to.
 */
export type HandOffNews = { kind: 'given' | 'back'; from: string; to: string };

/** Where the news starts as the office starts, so a restart tells nothing again. */
export async function handOffMark(): Promise<number> {
  const [row] = await db.select({ id: max(followUps.id) }).from(followUps);
  return row?.id ?? 0;
}

/**
 * Each hand-off and hand-back newer than `mark`, and the mark after them. A
 * hand-back that carries the owner's answer (`answered`) is no news: no
 * colleague worked, so nobody walks over.
 */
export async function handOffNewsSince(
  mark: number
): Promise<{ news: HandOffNews[]; mark: number }> {
  const rows = await db
    .select({
      id: followUps.id,
      kind: followUps.kind,
      to: followUps.staffId,
      handOff: followUps.handOff
    })
    .from(followUps)
    .where(and(gt(followUps.id, mark), inArray(followUps.kind, ['hand_off', 'handed_back'])))
    .orderBy(followUps.id);
  return {
    news: rows.flatMap((r): HandOffNews[] =>
      r.handOff && !r.handOff.answered
        ? [{ kind: r.kind === 'hand_off' ? 'given' : 'back', from: r.handOff.from, to: r.to }]
        : []
    ),
    mark: rows.at(-1)?.id ?? mark
  };
}
