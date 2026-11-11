import type { Delivered } from './chat-about.svelte.ts';

export const approveWord = (words: string) => /^approve[.!]?$/i.test(words.trim());
export const yesWord = (words: string) => /^yes[.!]?$/i.test(words.trim());

/** A yes needs a named reply. A bare Approve needs the same single card at typing and at Send. */
export function approvalTarget(
  words: string,
  typed: string,
  reply: Delivered | undefined,
  whenTyped: Delivered | undefined,
  onlyNow: Delivered | undefined
): Delivered | undefined {
  if (!typed || typed !== words) return;
  if (reply && (approveWord(words) || yesWord(words))) return reply;
  if (approveWord(words) && whenTyped && whenTyped.id === onlyNow?.id) return onlyNow;
}
