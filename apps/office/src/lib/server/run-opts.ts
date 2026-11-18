// A run's options and the words that end one, shared by every kind of run.
import { type CheckedFiles, type StaffRow, type UsageKind } from '@oddboro/ledger';
import type { ChatEntry, ChatEvent } from '../staff/chat.ts';
import type { ChatFile } from '#lib/attachments.ts';
import { type RunImage } from './launch.ts';

/**
 * How a run ended. `saved` means its tool named a session, which went in the
 * session file, so a later run that resumes it holds this run's message.
 */
export type Run = {
  ok: boolean;
  text: string;
  saved?: true;
  interrupted?: true;
  /** A file job's check of what this run wrote (`CheckedFiles`, less the periods it started with). */
  checked?: Omit<CheckedFiles, 'periods'>;
};
const stopped = (): Run => ({ ok: false, text: 'Stopped at your request.', interrupted: true });
/** How a run ends on its stop: the owner's Stop, or the Odd leaving the office (`stopRuns`). */
const stoppedBy = (who: StaffRow, signal?: AbortSignal): Run =>
  signal?.reason === 'left'
    ? { ok: false, text: `${who.name} left the office, so this stopped.` }
    : stopped();

/**
 * A run ended, so pick-ups it held may start (follow-ups.ts).
 * The page never hears it: /api/events sends only `event`.
 */
export const RUN_ENDED = 'run-ended';

/** What a run is for, and what it may do. */
export type RunOpts = {
  runId?: string;
  signal?: AbortSignal;
  kind: UsageKind;
  /** A scheduled file exchange grants no right to lead or wake the work. */
  jobFiles?: {
    thread: number;
    input?: string;
    output: string;
    record: string;
    inputHash?: string;
    sources?: string[];
  };
  sessionFile?: string;
  extra?: string;
  /** The owner's own message, when this is a chat. */
  ownerSaid?: string;
  /** The owner's text stays literal, even when it contains {owner}. */
  literal?: string;
  /** That chat as it stood before the owner's message: `tell_lead` passes on its last exchange. */
  chatBefore?: ChatEntry[];
  /** The files the owner attached to that message, which `tell_lead` takes to the lead. */
  ownerFiles?: ChatFile[];
  /** What a follow-up was asked, in words a persona can read: its `message` is only a label. */
  asked?: string;
  /** The ask the owner approved that this run carries out: the only one its self-edits may cite. */
  approvedAsk?: number;
  /** The owner's note a follow-up carries out, which a lesson may quote. */
  ownerNote?: string;
  /** The file the owner edited, and their version of it, which a lesson read from it quotes. The run may not write that file. */
  ownerEdit?: { path: string; text: string };
  /** Draft at most: a follow-up `runsAtDraft` names (a kind `atDraft` names, or one that serves a colleague's hand-off, except an approval ask's carry-out and an Odd the owner lets act on its own there), or a file job's run. */
  draftOnly?: boolean;
  /** A run that only reads the owner's reason or edit for a lesson (`servesNoThread`): it hands nothing on. */
  lessonRun?: boolean;
  /** The hand-off a colleague's run serves: asks and tasks it raises carry it, and it cannot hand off. */
  handOffId?: number;
  /** The thread the run works on, either side: it reads the thread's folder and writes its own part. */
  threadId?: number;
  /** On a lead's pick-up of a colleague's result, that colleague: what the run puts on the desk names them. */
  via?: string;
  /**
   * A colleague's words reach this run: it serves a colleague's hand-off, or
   * is a lead's pick-up of a result. Unless the owner lets the Odd act on its
   * own on work from colleagues, no standing yes applies (`handedOver`).
   */
  fromColleague?: boolean;
  /** The hand-backs this run's brief already holds in full, so its lead's story leaves them out. */
  shown?: number[];
  /** Pictures the owner attached in a chat, for a tool that cannot open one with its own tools (Codex). */
  images?: RunImage[];
  timeoutMs: number;
  onEvent?: (e: ChatEvent) => void;
  /** Set by `run`: when the run must end, and the step it is on while it gets ready. */
  clock?: Clock;
};

/**
 * A run's time limit, counted from when the run was asked for, not from when
 * its tool starts. `step` names what the run is doing before its tool starts,
 * so a run that never got that far says where it stopped. While its tool
 * runs (`going`), the tool's own timer ends it at the same deadline.
 */
type Clock = { deadline: number; step: string; over: boolean; going: boolean };

const noReply = (ms: number): Run => ({
  ok: false,
  text: `No reply after ${ms / 60_000} minutes.`
});

export { stopped, stoppedBy, type Clock, noReply };
