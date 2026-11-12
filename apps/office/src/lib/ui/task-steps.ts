// Which of a task's steps hold up Mark done. Safe to import in the browser.
import type { Step, TaskRow } from '@oddboro/ledger';

/**
 * A step the office does something for: a sign-in, a secret, a tool list or
 * a choice, and the sign-in's step that ticks itself when it lands (it shares
 * the sign-in's `oauth:` key). The task cannot be done without these. Every
 * other step is a checklist the owner may tick or not.
 */
export const mustDo = (s: Step): boolean => !!s.action || !!s.key?.startsWith('oauth:');

/** How the owner answers a task in its Odd's chat (`chatAnswer`). */
export type ChatAnswer = {
  /** The steps to show on the card: every step but the choice. */
  steps: Step[];
  /** The open choice a tap answers and finishes with. Without one, they write the answer. */
  choice?: { index: number; options: string[] };
};

/**
 * How the owner answers a task in its Odd's chat, with one response: a written
 * answer, or a tap on one of its choices. Undefined when it needs the Desk: a
 * file to fill in or read, a step the office does something for other than one
 * choice (a sign-in, a secret, a tool list), or a connect task (`askId`),
 * whose end starts work that needs the tool connected.
 */
export function chatAnswer(
  t: Pick<TaskRow, 'askId' | 'steps'>,
  attached: boolean
): ChatAnswer | undefined {
  if (t.askId || attached) return undefined;
  const held = t.steps.filter(mustDo);
  if (held.some((s) => s.action?.kind !== 'choice')) return undefined;
  const open = t.steps.flatMap((s, index) =>
    mustDo(s) && !s.done && s.action?.kind === 'choice'
      ? [{ index, options: s.action.options }]
      : []
  );
  if (open.length > 1) return undefined;
  return { steps: t.steps.filter((s) => !mustDo(s)), ...(open[0] ? { choice: open[0] } : {}) };
}

/** How many steps still hold up Mark done. */
export const stepsToGo = (steps: Step[]): number =>
  steps.filter((s) => mustDo(s) && !s.done).length;

/**
 * A step's text as the desk renders it: a bare email address becomes inline
 * code, which copies on a click, instead of a mail link. A step says to type an
 * address far more often than to write to it. Addresses already in code or
 * inside a link stay as they are.
 */
export function stepText(text: string): string {
  // Code spans and Markdown links first, so the address inside one is skipped.
  return text.replace(
    /(`[^`]*`|\[[^\]]*\]\([^)]*\)|<[^>]*>)|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g,
    (all, kept: string | undefined, email: string | undefined) => (kept ? kept : `\`${email}\``)
  );
}
