// What the phone's Messages shows that the office state does not carry: the
// last line of each Odd's chat. Read only, from the chat each Odd keeps, for
// `GET /api/phone/messages`.
import { roster } from '@oddboro/ledger';
import { history } from '#lib/server/staff.ts';
import { lastLine, type LastLine } from '#lib/ui/phone/phone-messages.ts';

/** Each Odd's last chat line, by its id, for an Odd whose chat has one. */
export async function lastLines(): Promise<Record<string, LastLine>> {
  const out: Record<string, LastLine> = {};
  for (const s of await roster()) {
    const last = lastLine(history(s.id));
    if (last) out[s.id] = last;
  }
  return out;
}
