// Odds working on one piece of work at once meet in a meeting room. While a
// colleague runs on a thread its lead handed it, the two sit together at a
// meeting table, and both go back to their own seats when it ends. Odds still
// never talk to each other: the meeting is where the floor shows the hand-off
// at work, nothing more.
import type { PlacedSpot } from '@oddboro/world';
import type { HeldThread } from './thread-tags.ts';

/**
 * Which meeting room each Odd in a meeting sits in, by Odd id. A thread meets
 * while its colleague is running and neither of the two waits on the owner
 * (the owner's door comes first) or sits in another meeting. Each takes the
 * first meeting room with a seat for everyone, so two meetings never share a
 * table. With no such room, its Odds work at their own seats as before.
 */
export function meetingRooms(
  threads: HeldThread[],
  o: {
    spots: PlacedSpot[];
    /** True while the Odd runs something. */
    working: (id: string) => boolean;
    /** True while the Odd has something on the owner's desk. */
    waits: (id: string) => boolean;
  }
): Record<string, string> {
  const free = new Map<string, number>();
  for (const s of o.spots) if (s.activity === 'meet') free.set(s.room, (free.get(s.room) ?? 0) + 1);
  const out: Record<string, string> = {};
  for (const t of threads) {
    if (!o.working(t.holderId)) continue;
    const who = [t.hubId, t.holderId];
    if (who.some((id) => o.waits(id) || out[id])) continue;
    const room = [...free].find(([, n]) => n >= who.length)?.[0];
    if (!room) continue;
    free.set(room, free.get(room)! - who.length);
    for (const id of who) out[id] = room;
  }
  return out;
}
