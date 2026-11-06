// What a name tag on the floor says about a thread a colleague holds: on the
// colleague, the thread and whose it is; on the lead, who has it. The server
// picks the threads (`heldThreads`), the page words each tag (`threadTag`).
import type { GoalThread } from '@oddboro/ledger';

/** A thread a colleague holds for the Odd that leads it, as the floor gets it. */
export type HeldThread = Pick<GoalThread, 'title' | 'hubId' | 'holderId'>;

/**
 * The open threads a colleague holds for their lead. A stopped thread keeps
 * the holder it had when it stopped, so without the stage its lead would read
 * as waiting on that colleague forever.
 */
export function heldThreads(
  threads: Pick<GoalThread, 'title' | 'hubId' | 'holderId' | 'stage'>[]
): HeldThread[] {
  return threads
    .filter(
      (t) => (t.stage === 'under_way' || t.stage === 'waiting_on_you') && t.holderId !== t.hubId
    )
    .map(({ title, hubId, holderId }) => ({ title, hubId, holderId }));
}

/** A tag's words for a thread, and the colleague a lead waits on while it is not working. */
export type ThreadTag = { text: string; waitsOn?: string };

/**
 * The tag for Odd `id`: a thread it holds for its lead, else a thread of its
 * own a colleague holds. Undefined for an Odd in neither, which keeps its
 * working or activity label.
 */
export function threadTag(o: {
  id: string;
  threads: HeldThread[];
  /** The Odd is running something now. */
  working: boolean;
  nameOf: (id: string) => string;
}): ThreadTag | undefined {
  const held = o.threads.find((t) => t.holderId === o.id);
  if (held) return { text: `${held.title} · with ${o.nameOf(held.hubId)}` };
  const led = o.threads.find((t) => t.hubId === o.id);
  if (!led) return undefined;
  const holder = o.nameOf(led.holderId);
  return o.working
    ? { text: `${led.title} · with ${holder}` }
    : { text: `Waiting on ${holder}`, waitsOn: led.holderId };
}
