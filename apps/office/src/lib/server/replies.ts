// Email replies an Odd proposed (`propose_reply` in the ledger), as the owner
// sends them from the Desk. The office calls Gmail itself, with its own
// token, and only on the owner's click: no Odd ever sends. The ask closes
// only once Gmail took the email, with the owner's final version, and the Odd
// then reads any change they made for a lesson (`learnFromReply`). Each goes
// through the Gmail account its ask names (`mailboxOf`), so a reply leaves
// from the account the email came to. Filters (filters.ts) reach Gmail
// through the same token and refusals.
import {
  approveReply,
  ask,
  mailboxOf,
  reconnectTask,
  staffer,
  type AskRow,
  type ConnectorRow,
  type ReplyDraft
} from '@oddboro/ledger';
import { learnFromReply } from './files.ts';
import {
  answered,
  filesOf,
  saveDraft,
  sendMail,
  type Outgoing,
  type OutgoingFile,
  type Received
} from './google/gmail.ts';
import { GoogleError, lacksScope, type Token } from './google/http.ts';
import { bearer } from './oauth.ts';

/** A refusal the owner reads, with the HTTP status the route answers with. */
export class GmailRefusal extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Gmail's sign-in is gone: the token could not be had or renewed. */
class SignedOut extends Error {}

/**
 * What the owner changes before it goes. `attachments` names, by path, the
 * Odd's files that still go: the owner may take any off, never add one.
 * Left out, every file the Odd attached goes.
 */
export type ReplyFields = Pick<ReplyDraft, 'to' | 'cc' | 'subject' | 'body'> & {
  attachments?: string[];
};
export type ReplyAction = 'send' | 'draft';

/** Replies on their way to Gmail, so a second click cannot send one twice. */
const sending = new Set<number>();

/** A reply ask, or a 404. */
async function replyAsk(id: number): Promise<AskRow & { reply: ReplyDraft }> {
  const a = await ask(id);
  if (!a || a.kind !== 'reply' || !a.reply) throw new GmailRefusal(404, 'No such reply');
  return { ...a, reply: a.reply };
}

/** What the office needs Gmail for, from the item on the desk: the reconnect task's why. */
export type GmailUse = 'reply' | 'filter';
const NEEDS: Record<GmailUse, string> = {
  reply: 'The office needs Gmail signed in to send or save the replies on your desk.',
  filter:
    'The office needs Gmail signed in again, this time with its filter settings, to create the filters on your desk.'
};

/**
 * The ask's Gmail account is not signed in, or its sign-in lacks a scope
 * (`lacksScope`): the office puts its own steps to sign that account in
 * again on the desk (`reconnectTask`, one open at a time), and the refusal
 * names them.
 */
async function notSignedIn(
  a: AskRow,
  nothing: string,
  use: GmailUse = 'reply',
  scope = false
): Promise<GmailRefusal> {
  const c = await mailboxOf(a);
  const gmail = c?.name ?? 'Gmail';
  const r = c ? await reconnectTask(a.staffId, c.id, NEEDS[use], []) : undefined;
  if (!r || 'problem' in r) {
    const name = (await staffer(a.staffId))?.name ?? 'this Odd';
    return new GmailRefusal(
      409,
      `${gmail} is not connected. ${nothing}. Give ${name} ${gmail} again in its Settings tab, under Services.`
    );
  }
  const state = scope
    ? `${gmail}'s sign-in is from before filters, so ${gmail} needs signing in again`
    : `${gmail} is not signed in`;
  return new GmailRefusal(
    409,
    `${state}. ${nothing}. Sign in from "${r.task.title}" on your desk, then try again.`
  );
}

/** A token for the ask's Gmail account, or the refusal that says how to sign in again. */
export async function gmailToken(
  a: AskRow,
  nothing: string,
  use: GmailUse = 'reply'
): Promise<Token> {
  const c: ConnectorRow | undefined = await mailboxOf(a);
  if (!c?.readyAt || !(await bearer(c.id))) throw await notSignedIn(a, nothing, use);
  return async () => {
    const t = await bearer(c.id);
    if (!t) throw new SignedOut();
    return t;
  };
}

/** A Gmail failure in plain words, or the sign-in refusal when Google turned the token down. */
export async function gmailFailed(
  e: unknown,
  a: AskRow,
  nothing: string,
  use: GmailUse = 'reply'
): Promise<GmailRefusal> {
  if (e instanceof SignedOut || (e instanceof GoogleError && e.status === 401))
    return notSignedIn(a, nothing, use);
  if (lacksScope(e)) return notSignedIn(a, nothing, use, true);
  const said = e instanceof GoogleError ? `Gmail said: ${e.message}` : (e as Error).message;
  return new GmailRefusal(502, `${nothing}. ${said}`);
}

/**
 * Send the reply, or save it to Gmail drafts, as the owner left it. Only
 * after Gmail took it is the ask approved with their version (`approveReply`,
 * which writes the one ledger line and sends the answer back where the ask
 * came from). If Gmail fails, the ask stays open.
 */
export async function sendReply(
  id: number,
  action: ReplyAction,
  fields: ReplyFields
): Promise<ReplyDraft> {
  const a = await replyAsk(id);
  if (a.status !== 'open') throw new GmailRefusal(409, 'You already answered this reply.');
  if (sending.has(id)) throw new GmailRefusal(409, 'This reply is already on its way.');
  sending.add(id);
  try {
    const nothing = action === 'send' ? 'Nothing was sent' : 'Nothing was saved';
    const { attachments: keep, ...edits } = fields;
    const kept = (a.reply.attachments ?? []).filter((f) => !keep || keep.includes(f.path));
    // Checked again and read now: a file may have changed or gone since the Odd attached it.
    let files: OutgoingFile[];
    try {
      files = filesOf(a.staffId, kept);
    } catch (e) {
      throw new GmailRefusal(
        409,
        `${nothing}. ${(e as Error).message} Take it off, or ask for changes.`
      );
    }
    const token = await gmailToken(a, nothing);
    const out: Outgoing = {
      to: fields.to.join(', '),
      cc: fields.cc.join(', ') || undefined,
      subject: fields.subject,
      body: fields.body,
      threadId: a.reply.gmailThreadId,
      inReplyTo: a.reply.inReplyTo,
      ...(files.length ? { attachments: files } : {})
    };
    let gmailId: string;
    try {
      gmailId = action === 'send' ? await sendMail(token, out) : await saveDraft(token, out);
    } catch (e) {
      throw await gmailFailed(e, a, nothing);
    }
    const final: ReplyDraft = {
      ...a.reply,
      ...edits,
      attachments: kept.length ? kept : undefined,
      sent: { action, at: new Date().toISOString(), gmailId }
    };
    if (!(await approveReply(id, final)))
      console.error(`Reply ${id} went to Gmail, but the ask was no longer open.`);
    // The owner's changes, read for a lesson as a save in the viewer is. The
    // email went either way, so a failure here is logged, never the owner's.
    else
      await learnFromReply(a.staffId, id, a.reply, final).catch((e: unknown) =>
        console.error(`No lesson run for reply ${id}:`, e)
      );
    return final;
  } finally {
    sending.delete(id);
  }
}

/** The email a reply answers, read from Gmail with the office's token. */
export async function original(id: number): Promise<Received> {
  const a = await replyAsk(id);
  if (!a.reply.gmailThreadId) throw new GmailRefusal(404, 'This is a new email. It answers none.');
  const nothing = 'The email it answers could not be read';
  const token = await gmailToken(a, nothing);
  const found = await answered(token, a.reply.gmailThreadId, a.reply.inReplyTo).catch(
    async (e: unknown) => {
      throw await gmailFailed(e, a, nothing);
    }
  );
  if (!found) throw new GmailRefusal(404, 'That Gmail thread has no email in it now.');
  return found;
}
