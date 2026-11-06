// What a run's office tool server (mcp.ts in the ledger) is told about the run,
// through its environment. The tool server trusts only these, never a tool
// argument, so each one here is a rule the run is held to.

/** What `officeEnv` needs to know about one run. */
export type RunFacts = {
  /** The run's key, which every run gets: a thread it hands off on keeps it while it goes (`runsGoing`). */
  key: string;
  /** The owner's own message, when this is a chat. */
  ownerSaid?: string;
  /** The ask the owner approved that this run carries out. */
  approvedAsk?: number;
  /** The tools whose sign-ins ran out, which only this run knows. */
  signedOut: string[];
  /** The owner's note a follow-up carries out, which a lesson may quote. */
  ownerNote?: string;
  /** The owner's version of a file they edited, which a lesson read from it quotes. */
  ownerEdit?: string;
  /** The level the run works at, when it is below the Odd's own. */
  ceiling?: string;
  /** The hand-off a colleague's run serves. */
  handOffId?: number;
  /** The thread the run works on, either side. */
  threadId?: number;
  /** A run that only reads the owner's reason or edit for a lesson: it hands nothing on. */
  lessonRun: boolean;
};

/** The most of the owner's words a run's environment carries, in UTF-16 units. */
const WORDS_MAX = 4000;

/**
 * The owner's words cut to `WORDS_MAX`, never between the two halves of a
 * character outside the BMP (an emoji): a half alone is no character, and
 * Codex's `-c`, which carries these, refuses the TOML.
 */
function words(s: string): string {
  const cut = s.slice(0, WORDS_MAX);
  return s.length > WORDS_MAX && /[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/** The environment the run's office tool server starts with, beyond what every run shares. */
export function officeEnv(r: RunFacts): Record<string, string> {
  return {
    RUN_KEY: r.key,
    ...(r.ownerSaid ? { OWNER_SAID: words(r.ownerSaid) } : {}),
    ...(r.approvedAsk ? { APPROVED_ASK: String(r.approvedAsk) } : {}),
    ...(r.signedOut.length ? { SIGNED_OUT: r.signedOut.join(',') } : {}),
    ...(r.ownerNote ? { OWNER_NOTE: words(r.ownerNote) } : {}),
    ...(r.ownerEdit ? { OWNER_EDIT: r.ownerEdit } : {}),
    // Below the Odd's own level, my_access answers for this run, as its prompt does.
    ...(r.ceiling ? { CEILING: r.ceiling } : {}),
    ...(r.handOffId ? { HAND_OFF_ID: String(r.handOffId) } : {}),
    ...(r.threadId ? { THREAD_ID: String(r.threadId) } : {}),
    ...(r.lessonRun ? { LESSON_RUN: '1' } : {})
  };
}
