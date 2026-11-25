import type { Delivered } from './chat-about.svelte.ts';
import type { Pending } from './chat-attach.ts';
import type { WorkAbout } from '../staff/work.ts';

// What the owner left unsent in each Odd's chat: the words, what they reply
// to, the work they are about and the files attached. It waits here while
// the owner looks at something else, and the chat puts it back when it opens
// again. Memory only, so a reload starts every box clean.

export type Unsent = {
  text: string;
  replyTo?: Delivered;
  intent: 'reply' | 'proposal' | 'change';
  about?: WorkAbout;
  files: Pending[];
};

const unsent = new Map<string, Unsent>();

/** Keep what `staff`'s chat holds now. An empty box keeps nothing. */
export function keepUnsent(staff: string, u: Unsent): void {
  if (u.text.trim() || u.replyTo || u.about || u.files.length) unsent.set(staff, u);
  else unsent.delete(staff);
}

/** What `staff`'s chat held when the owner last left it. */
export function unsentFor(staff: string): Unsent | undefined {
  return unsent.get(staff);
}
