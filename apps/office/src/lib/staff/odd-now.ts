// An Odd's live state, derived once from what the page holds, and the words
// each screen shows for it. Every screen that says what an Odd is doing reads
// it from here, so the floor tag, the card, the info page, the rail and the
// Jobs tab cannot disagree. Pure, and safe in the browser.
import type { Desk } from '@oddboro/ledger';
import { ACTIVITY_LABEL, type Activity } from '#lib/staff/roster.ts';
import { threadTag, type HeldThread } from '#lib/staff/thread-tags.ts';
import type { Work } from '#lib/staff/work.ts';

/** What the page holds about the office, as the server sends it. */
export type Snapshot = {
  ids: string[];
  /** Each Odd's runs going and queued, in the order they joined: run-state.ts `inProgress()`. */
  inProgress: Record<string, Work[]>;
  /** Each Odd's follow-ups yet to start, as `/api/office` sends them. */
  toStart: Record<string, Work[]>;
  /** The Odds with a chat reply to the owner going. A new hire's hello is a run, not a reply. */
  chatting: string[];
  /** oddNow reads only each ask's and task's Odd. */
  desk: Desk;
  /** Each Odd's unread messages for the owner. */
  messages: Record<string, unknown>;
  threads: HeldThread[];
  /** Where the floor put each Odd. */
  activity: Record<string, Activity>;
  nameOf: (id: string) => string;
};

/**
 * What an Odd shows: one state, the first that holds in this order. A reply
 * the owner waits for comes before the Odd's background runs.
 */
export type Show =
  | { is: 'message' }
  | { is: 'waitingOnYou' }
  | { is: 'holding'; text: string }
  | { is: 'leading'; text: string; waitsOn?: string }
  | { is: 'chatting' }
  | { is: 'running' }
  | { is: 'queued'; activity: Activity }
  | { is: 'free'; activity: Activity };

/**
 * An Odd's live state. `runs` and `queued` hold its work whatever it shows,
 * so the work list, the rail count and the Jobs tab keep a run that goes
 * while the Odd holds a thread or waits on the owner.
 */
export type OddNow = {
  show: Show;
  /** Its runs going. */
  runs: Work[];
  /** Its runs waiting for a slot, then its follow-ups yet to start. */
  queued: Work[];
};

/** A free Odd at its desk. "Working" would claim work it is not doing. */
export const FREE_AT_WORK = 'At their desk';
/** An Odd replying to the owner in chat. */
export const CHATTING = 'Replying to you';

/** The states in which an Odd waits on the owner: it goes to the door, and the rail rings it. */
const WAITS_ON_OWNER: Record<Show['is'], boolean> = {
  message: true,
  waitingOnYou: true,
  holding: false,
  leading: false,
  chatting: false,
  running: false,
  queued: false,
  free: false
};

export function oddNow(s: Snapshot): Record<string, OddNow> {
  const asked = new Set<string | null>([
    ...s.desk.asks.map((a) => a.staffId),
    ...s.desk.tasks.map((t) => t.staffId),
    ...Object.keys(s.messages)
  ]);
  const chatting = new Set(s.chatting);
  return Object.fromEntries(
    s.ids.map((id) => {
      const work = s.inProgress[id] ?? [];
      const runs = work.filter((w) => !w.queued);
      const queued = [...work.filter((w) => w.queued), ...(s.toStart[id] ?? [])];
      const show = ((): Show => {
        if (s.messages[id]) return { is: 'message' };
        if (asked.has(id)) return { is: 'waitingOnYou' };
        const tag = threadTag({
          id,
          threads: s.threads,
          working: runs.length > 0,
          nameOf: s.nameOf
        });
        // threadTag words a thread the Odd holds before one it leads.
        if (tag && s.threads.some((t) => t.holderId === id))
          return { is: 'holding', text: tag.text };
        if (tag) return { is: 'leading', ...tag };
        if (chatting.has(id)) return { is: 'chatting' };
        if (runs.length > 0) return { is: 'running' };
        const activity = s.activity[id];
        return queued.length > 0 ? { is: 'queued', activity } : { is: 'free', activity };
      })();
      return [id, { show, runs, queued }];
    })
  );
}

/** The first run going, with " +N more" for the rest; undefined with none going. Queued work is not counted. */
export function runWords(n: OddNow): string | undefined {
  const [first, ...more] = n.runs;
  if (!first) return undefined;
  return more.length > 0 ? `${first.label} +${more.length} more` : first.label;
}

/**
 * Whether the card's tabs reload: only when a run starts or ends. A tool
 * step, a queued run or a chat reply leaves every Odd's run words as they
 * were, so it reloads nothing.
 */
export function runsChanged(
  before: Record<string, OddNow>,
  after: Record<string, OddNow>
): boolean {
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...ids].some((id) => wordsOf(before[id]) !== wordsOf(after[id]));
}

const wordsOf = (n: OddNow | undefined): string | undefined => n && runWords(n);

/** The card line and the info page's line: what the Odd is doing, in words. */
export function lineWords(n: OddNow): string {
  const show = n.show;
  switch (show.is) {
    case 'message':
      return 'Has a message for you';
    case 'waitingOnYou':
      return ACTIVITY_LABEL.wait;
    case 'holding':
    case 'leading':
      return show.text;
    case 'chatting':
      return CHATTING;
    case 'running':
      // A running Odd has a run going, so it has words.
      return runWords(n) ?? '';
    case 'queued':
      // Queued work is not under way, so the Odd reads as where it stands, "Working" included.
      return ACTIVITY_LABEL[show.activity];
    case 'free':
      return show.activity === 'work' ? FREE_AT_WORK : ACTIVITY_LABEL[show.activity];
    default:
      return show satisfies never;
  }
}

/** The floor tag and the rail's status: where the Odd is headed while it walks, else its line. */
export function tagWords(n: OddNow, heading?: string): string {
  return heading ? `→ ${heading}` : lineWords(n);
}

/**
 * Where the floor sends the Odd: to the door while it waits on the owner,
 * to its job's place while a run goes or while it waits on a colleague, and
 * nowhere new otherwise. A run going counts in every state below the door.
 */
export function floorMode(n: OddNow, jobActivity: Activity): Activity | undefined {
  if (WAITS_ON_OWNER[n.show.is]) return 'wait';
  if (n.runs.length > 0) return jobActivity;
  return n.show.is === 'leading' && n.show.waitsOn ? jobActivity : undefined;
}

/**
 * Whether the Jobs tab shows the job as Running: a run going has the job's
 * name as its label. A catch-up run's label names its periods too, so it
 * does not.
 */
export function jobRunning(n: OddNow, job: string): boolean {
  return n.runs.some((w) => w.label === job);
}

/** The run going for a follow-up. Undefined for an Odd the page does not hold, such as one who has left. */
export function runFor(n: OddNow | undefined, followUp: number): Work | undefined {
  return n?.runs.find((w) => w.followUp === followUp);
}

/** The work list: runs going, then queued runs, then follow-ups yet to start. */
export function workItems(n: OddNow): Work[] {
  return [...n.runs, ...n.queued];
}

/** The rail's count: every run going or queued, and every follow-up yet to start. */
export function railCount(n: OddNow): number {
  return n.runs.length + n.queued.length;
}

/** Whether the rail rings the Odd: it waits on the owner. */
export function railRing(n: OddNow): boolean {
  return WAITS_ON_OWNER[n.show.is];
}
