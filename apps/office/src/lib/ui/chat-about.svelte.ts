// Starting a chat about something on screen, e.g. a passage in a report. The
// page opens the staffer's chat; the chat takes the draft and puts it in its
// message box for the owner to finish and send.
//
// Something a staffer put on the desk also shows in its chat. Opening one on
// the desk selects it there (`showInChat`), and Reply starts a message about
// it (`replyAbout`).

import type { ChatRef } from '../staff/chat.ts';

/** Something a staffer put on the owner's desk. */
export type Delivered = ChatRef;

export const chatRequest = $state<{
  staff?: string;
  drafts: Record<string, string>;
  /** The delivery selected in a staffer's chat. */
  focus?: { staff: string; item: Delivered };
  /** A reply waiting for a staffer's chat to take it. */
  reply?: { staff: string; item: Delivered };
}>({
  drafts: {}
});

/** Open a chat with `staff`, with `draft` waiting in the message box. */
export function chatAbout(staff: string, draft: string): void {
  chatRequest.drafts[staff] = draft;
  chatRequest.staff = staff;
}

/** The draft waiting for this staffer's chat, taken once. */
export function takeDraft(staff: string): string | undefined {
  const d = chatRequest.drafts[staff];
  delete chatRequest.drafts[staff];
  return d;
}

/** Open `staff`'s chat with `item` selected in it. */
export function showInChat(staff: string, item: Delivered): void {
  chatRequest.focus = { staff, item };
  chatRequest.staff = staff;
}

/** Open `staff`'s chat to reply about `item`, with the cursor in the box. */
export function replyAbout(staff: string, item: Delivered): void {
  chatRequest.reply = { staff, item };
  showInChat(staff, item);
}
