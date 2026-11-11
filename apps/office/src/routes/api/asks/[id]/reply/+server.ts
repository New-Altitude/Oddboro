// The owner sends a reply an Odd proposed, or saves it to Gmail drafts, as
// they left it: `{ action: 'send' | 'draft', to, cc, subject, body }`. The
// office calls Gmail itself (`sendReply` in replies.ts). A Gmail failure
// leaves the ask open and answers with what went wrong, in plain words.
import { error, json } from '@sveltejs/kit';
import { GmailRefusal, sendReply, type ReplyAction } from '#lib/server/replies.ts';
import type { RequestHandler } from './$types';

/** Each address, trimmed, with blanks dropped; undefined when it is not a list of strings. */
function addresses(v: unknown): string[] | undefined {
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) return undefined;
  return v.map((x: string) => x.trim()).filter(Boolean);
}

export const POST: RequestHandler = async ({ params, request }) => {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = (['send', 'draft'] as ReplyAction[]).find((a) => a === body.action);
  if (!action) error(400, 'Say send or draft');
  const to = addresses(body.to);
  const cc = addresses(body.cc ?? []);
  if (!to?.length) error(400, 'Give at least one address to send it to');
  if (!cc) error(400, 'Cc is a list of addresses');
  if ([...to, ...cc].some((a) => /[\r\n,;]/.test(a) || a.length > 320))
    error(400, 'Put one address in each place');
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  if (!subject || subject.length > 400) error(400, 'Give it a subject');
  const text = typeof body.body === 'string' ? body.body : '';
  if (!text.trim() || text.length > 100_000) error(400, 'Write the email first');
  // The Odd's files that still go, by path; left out, all of them.
  const attachments = body.attachments === undefined ? undefined : addresses(body.attachments);
  if (body.attachments !== undefined && !attachments) error(400, 'Attachments is a list of files');
  try {
    const reply = await sendReply(Number(params.id), action, {
      to,
      cc,
      subject,
      body: text,
      ...(attachments ? { attachments } : {})
    });
    return json({ ok: true, reply });
  } catch (e) {
    if (e instanceof GmailRefusal) error(e.status, e.message);
    throw e;
  }
};
