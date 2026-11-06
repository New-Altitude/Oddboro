// The page's view of reports: whether the office can send them, and the
// owner's answer. Set from the page data and after each answer; the page's
// trace sampler reads it.
import type { Answer } from '#lib/diagnostics.ts';
import { call } from './api.ts';

export const diagnostics = $state<{ possible: boolean; answer: Answer }>({
  possible: false,
  answer: 'unasked'
});

/**
 * What a report never carries, in the words the owner approved. The ask and
 * the Setup switch both say it, so the two cannot drift apart.
 */
export const NEVER_CARRIED =
  "Reports never carry your chats, your Odds' work, your files, your family's details or your name. An error's message is included only when it comes from Oddboro's code.";

/** Keep the owner's answer in the office, then show it here. Throws with the server's message. */
export async function answerDiagnostics(answer: 'yes' | 'no'): Promise<void> {
  const kept = await call<{ answer: Answer }>('/api/diagnostics', { answer }, 'PUT');
  diagnostics.answer = kept.answer;
}
