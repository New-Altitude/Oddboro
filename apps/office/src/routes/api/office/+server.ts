// Everything the page shows that can change: the staff with the guesses each
// has waiting, the owner's desk, who is
// working and on what, the names the owner gave the rooms, what the owner switched off,
// the pokes that landed and wait unread, and the threads a colleague holds for its lead.
// The page fetches it once, then
// again on each change event.
import { json } from '@sveltejs/kit';
import {
  desk,
  goalThreads,
  guessesWaiting,
  roomNamesFor,
  roster,
  switchedOffIn,
  unreadPokes
} from '@oddboro/ledger';
import { currentOffice } from '#lib/server/space.ts';
import { inProgress, working } from '#lib/server/staff.ts';
import { toProfile } from '#lib/staff/roster.ts';
import { heldThreads } from '#lib/staff/thread-tags.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  const office = (await currentOffice()).id;
  const staff = await roster();
  const guesses = await guessesWaiting(staff.map((s) => s.id));
  return json({
    staff: staff.map((s) => toProfile(s, guesses[s.id])),
    desk: await desk(),
    working: { ...working },
    inProgress: structuredClone(inProgress),
    roomNames: await roomNamesFor(office),
    switchedOff: await switchedOffIn(office),
    messages: await unreadPokes(),
    threads: heldThreads(await goalThreads())
  });
};
