// What an ask's or task's chat card says, as plain words. Safe to import in the browser.
import type { Step, TaskRow } from '@oddboro/ledger';

/** A card's words: its kind and title, and what the desk knows of it. */
export type CardWords = {
  kind: string;
  title: string;
  why?: string;
  steps?: Pick<Step, 'text' | 'action'>[];
  /** The response the owner sees: a draft, or the saved words. */
  response?: string | null;
};

/**
 * The text Copy on a card puts on the clipboard: kind and title, then why,
 * then the numbered steps with any choices, then the response. A part with no
 * words is left out.
 */
export function cardText(c: CardWords): string {
  const steps = (c.steps ?? []).map(
    (s, n) =>
      `${n + 1}. ${s.text}` +
      (s.action?.kind === 'choice' ? s.action.options.map((o) => `\n   - ${o}`).join('') : '')
  );
  return [
    `${c.kind}: ${c.title}`,
    c.why?.trim(),
    steps.join('\n'),
    c.response?.trim() ? `Response:\n${c.response.trim()}` : ''
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Whether a task's response editor opens on its Odd's starting text: words
 * the Odd gave, no save of the owner's since (a save or a start from a file
 * makes version 1), and no draft of the owner's.
 */
export function startsFromOdd(
  row: Pick<TaskRow, 'response' | 'responseVersion'>,
  drafted: boolean
): boolean {
  return !drafted && row.responseVersion === 0 && !!row.response?.trim();
}
