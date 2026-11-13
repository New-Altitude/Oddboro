// What can happen to the office's work, as plain data. Each event is decided
// by one pure function (`DECIDERS` in decide.ts), which turns it into the
// rows to write. An entry function builds the event from what its caller
// passed and what it read outside the transaction.
//
// Pure: every import here is a type, so this file loads nothing.
import type { Level } from '../access-words.ts';
import type { oweCatchUp } from '../missed-runs.ts';
import type { bringBack, removeOdd } from '../leaving.ts';
import type { grantAccess } from '../office-access.ts';
import type { carryOutTogether } from '../office-asks.ts';
import type { Unparked } from '../office-follow-ups.ts';
import type { AccessRequest, FileEdit, InChat, Outcome } from '../schema.ts';
import type { FollowUpKind } from './kinds.ts';
import type { FollowUp, RetiredKind } from './state.ts';

/** A follow-up kind the office still starts. */
export type LiveKind = Exclude<FollowUpKind, RetiredKind>;

/** The run a source owes an Odd: whose it is, its kind, and what it answers or works on. */
export type OwedRun = {
  staffId: string;
  kind: LiveKind;
  note: string | null;
  askId?: number;
  taskId?: number;
  goalId?: number;
  /** The work it picks up. With none, the run works on the thread of the ask or task it answers. */
  threadId?: number;
  edit?: FileEdit;
  pickedUp?: string[];
  reportWhenDone?: boolean;
};

/**
 * How a run ended, as the run hands it over: one value, so any driver that
 * runs an Odd attaches by producing it. `joined` are the results the claim
 * picked up with this run (`Claimed.joined`): they end with it.
 */
export type RunEnded = { outcome: Outcome; result: string; joined: number[] };

export type WorkEvent =
  | {
      kind: 'runQueued';
      run: OwedRun;
      /** The owner answered on a card in a chat: the run replies there when it is that chat's Odd's. */
      chat?: InChat;
      /**
       * Put the run only while its work is open. A project's result that
       * comes back after its work ended starts nothing, as before; every other
       * source puts its run on ended work too, so only that one sets this.
       */
      onlyWhileOpen?: true;
    }
  | { kind: 'runClaimed'; id: number }
  | {
      kind: 'runFinished';
      id: number;
      /** What the work was about, for the Ledger and report title: the entry reads it outside the transaction. */
      about: string;
      ended: RunEnded;
    }
  | {
      kind: 'staleRunsClosed';
      /** One run a restart cut off: each is closed on its own, so one that fails leaves the rest to close. */
      id: number;
      about: string;
    };

/** A run as its claim hands it to the driver. */
export type Claimed = {
  run: FollowUp;
  /** The wait the claim lifted, for the run's brief: the task's title, or the time. */
  unparked?: Unparked;
  /** The lead's other results on this work still waiting, which this one run picks up and ends with. */
  joined: FollowUp[];
  /** The level the run may act at. */
  ceiling: Level;
};

/** What each event's entry function returns from a change that went through. */
export type WorkResults = {
  runQueued: null;
  runClaimed: Claimed;
  runFinished: null;
  staleRunsClosed: null;
};

/** I/O an ask's answer does after the commit. office-decide.ts supplies it where it decides an ask. */
export type AskEffects = {
  grantAccess: typeof grantAccess;
  /** Another Google account's new connector, written onto the ask and its twins. */
  pointAsksAtConnector: (askIds: number[], access: AccessRequest) => Promise<void>;
  /** The grant's carry-out when no connect task was made. */
  carryOutTogether: typeof carryOutTogether;
  oweCatchUp: typeof oweCatchUp;
  /** Last in its row, so the answer went back first. */
  removeOdd: typeof removeOdd;
  bringBack: typeof bringBack;
};

/** I/O an Odd's leaving does after the commit. leaving.ts supplies it in `removeOdd`. */
export type LeaveEffects = {
  /** Every callback `whenOddLeaves` registered, such as the office stopping the Odd's runs. */
  stopRuns: (staffId: string) => void;
};
