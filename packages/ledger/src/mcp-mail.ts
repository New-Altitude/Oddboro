// Gmail tools: a reply or a filter for the owner to approve.
import { z } from 'zod';
import { raiseAsk } from './office.ts';
import { withFooter } from './mail-footer.ts';
import { mailAttachments } from './mail-attachments.ts';
import {
  doesSomething,
  filterWords,
  matchesSomething,
  type FilterAction,
  type FilterCriteria
} from './filter-words.ts';
import { ME, OWNER, mailboxes, offered, VIA, revisesArg, tool, text, refused } from './mcp-run.ts';
import { raisedArgs, raisedNote, placed } from './mcp-desk.ts';

// An email reply waits on the owner's desk, one per ask: they edit it, then the
// office sends it or saves it to Gmail drafts. Only for an Odd that holds
// Gmail at any level, since it answers mail the Odd read there.
const gmailId = z.string().regex(/^[\w-]+$/, 'A Gmail id holds only letters, digits, _ and -.');
const address = z
  .string()
  .min(3)
  .max(320)
  .regex(/^[^\r\n,;]+$/, 'One address each, on one line.');
const mailboxIds = mailboxes.map((m) => m.id) as [string, ...string[]];
const mailboxArg = mailboxes.length
  ? (() => {
      const listed = mailboxes
        .map((m) => `${m.id}${m.account ? ` (${m.account})` : ''}`)
        .join(', ');
      const arg = z.enum(mailboxIds);
      return mailboxes.length > 1
        ? arg.describe(
            `The Gmail account the email came to, by id: ${listed}. Required, since you hold more than one.`
          )
        : arg
            .optional()
            .describe(`The Gmail account, by id: ${listed}. Leave out for your only one.`);
    })()
  : z.never().optional();
/** The Gmail account a reply or filter goes through: the one named, or the Odd's only one. */
function mailbox(
  named: string | undefined
): { connector: string; account?: string } | { problem: string } {
  const m = named ? mailboxes.find((x) => x.id === named) : mailboxes[0];
  if (!m) return { problem: `You do not hold a Gmail account called ${named}.` };
  if (!named && mailboxes.length > 1)
    return {
      problem: `You hold more than one Gmail account. Pass account: one of ${mailboxIds.join(', ')}.`
    };
  return { connector: m.id, account: m.account };
}

if (offered('propose_reply'))
  tool(
    'propose_reply',
    {
      description: `Put one email reply on ${OWNER}'s desk, ready to send. One reply per call: for three emails, call it three times. ${OWNER} reads your summary and the email it answers, may edit the recipients, subject and body, then sends it or saves it to Gmail drafts. Nothing is sent until ${OWNER} sends it. Never put reply drafts in a file for ${OWNER}, and never leave brackets for them to fill in: write the whole reply, and if a fact only they know is missing, say so in why. The office ends the body with a line "Sent from Oddboro", which ${OWNER} may delete: never write it yourself. To rework one ${OWNER} sent back, pass its id as revises.${raisedNote}`,
      inputSchema: {
        gmail_thread_id: gmailId
          .optional()
          .describe('The Gmail thread it answers, from search_threads. Leave out for a new email.'),
        in_reply_to: gmailId
          .optional()
          .describe(
            "The Gmail message id it answers. Leave out to answer the thread's latest message."
          ),
        to: z.array(address).min(1).max(20).describe('Each address, e.g. "Ada <ada@example.com>".'),
        cc: z.array(address).max(20).optional(),
        subject: z.string().min(1).max(200),
        body: z.string().min(1).max(20_000).describe('The reply as plain text, ready to send.'),
        summary: z
          .string()
          .max(400)
          .describe('One or two lines on the email it answers: who wrote and what they want.'),
        why: z.string().max(1000).describe('Why this reply, in one or two plain sentences.'),
        attachments: z
          .array(z.string())
          .max(10)
          .optional()
          .describe(
            `Files from your own folder that go with it, by their path inside it or their full path, like "attachments/20261110-081108-35bc-image.png". Files ${OWNER} attached in chat are in attachments/. Up to 10, 18 MB together. ${OWNER} sees each one and may take any off.`
          ),
        account: mailboxArg,
        revises: revisesArg,
        ...raisedArgs
      }
    },
    async ({
      account,
      gmail_thread_id,
      in_reply_to,
      to,
      cc = [],
      subject,
      body,
      summary,
      why,
      attachments = [],
      revises,
      ...where
    }) => {
      const box = mailbox(account);
      if ('problem' in box) return refused(box.problem);
      const files = mailAttachments(ME, attachments);
      if ('problem' in files) return refused(files.problem);
      const on = await placed(where);
      if ('problem' in on) return refused(on.problem);
      const more = to.length > 1 ? ` and ${to.length - 1} more` : '';
      const { ask } = await raiseAsk(ME, {
        ...on,
        kind: 'reply',
        title: `${gmail_thread_id ? 'Reply' : 'Email'} to ${to[0]}${more}: ${subject}`.slice(
          0,
          140
        ),
        why,
        ifApproved: `You send it, or save it to Gmail drafts, with any changes you make. Nothing goes before you click.`,
        reply: {
          gmailThreadId: gmail_thread_id,
          inReplyTo: in_reply_to,
          to,
          cc,
          subject,
          // The footer goes in now, where the owner sees it and may delete it.
          body: withFooter(body),
          summary,
          ...(files.length ? { attachments: files } : {}),
          ...box
        },
        revises,
        via: VIA
      });
      return text(
        `Reply ${ask.id} is on ${OWNER}'s desk. Nothing is sent until they send it. Check my_asks later for what they did.`
      );
    }
  );

// A Gmail filter waits on the owner's desk, one per ask: they may change it,
// then the office creates it in Gmail. Only for an Odd that holds Gmail at any
// level, since it files mail the Odd read there.
const filterText = z.string().trim().max(500).optional();
if (offered('propose_filter'))
  tool(
    'propose_filter',
    {
      description: `Put one Gmail filter on ${OWNER}'s desk, ready to create. One filter per call: for three kinds of mail, call it three times. Call list_filters first, so you never propose a filter ${OWNER} already has. Say plainly in summary what mail it matches and what it does to it. ${OWNER} sees how many emails it matches today, may change it, then creates it, and may tidy the mail it already matches the same way. Nothing changes in Gmail until ${OWNER} clicks Create filter. A filter only files mail: it skips the inbox, marks read, adds a label or stars, never deletes or forwards. Never put filter settings in a task or steps for ${OWNER} to copy. To rework one ${OWNER} sent back, pass its id as revises.${raisedNote}`,
      inputSchema: {
        from: filterText.describe('Mail from this sender, e.g. "news@shop.example.com".'),
        to: filterText.describe('Mail to this address.'),
        subject: filterText.describe('Words in the subject.'),
        query: filterText.describe(
          'Gmail search words the mail has, as typed in Gmail, e.g. "unsubscribe".'
        ),
        negated_query: filterText.describe('Gmail search words the mail does not have.'),
        has_attachment: z.boolean().optional(),
        skip_inbox: z.boolean().optional().describe('Archive it: it skips the inbox.'),
        mark_read: z.boolean().optional(),
        add_label: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .describe(
            "A label's name. The office makes it when the filter is created, if it is missing."
          ),
        star: z.boolean().optional(),
        summary: z
          .string()
          .min(1)
          .max(400)
          .describe('One or two plain lines: what mail it matches and what it does to it.'),
        why: z.string().max(1000).describe('Why this filter, in one or two plain sentences.'),
        account: mailboxArg,
        revises: revisesArg,
        ...raisedArgs
      }
    },
    async ({
      account,
      from,
      to,
      subject,
      query,
      negated_query,
      has_attachment,
      skip_inbox,
      mark_read,
      add_label,
      star,
      summary,
      why,
      revises,
      ...where
    }) => {
      const criteria: FilterCriteria = {
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(subject ? { subject } : {}),
        ...(query ? { query } : {}),
        ...(negated_query ? { negatedQuery: negated_query } : {}),
        ...(has_attachment ? { hasAttachment: true } : {})
      };
      const action: FilterAction = {
        ...(skip_inbox ? { skipInbox: true } : {}),
        ...(mark_read ? { markRead: true } : {}),
        ...(add_label ? { addLabel: add_label } : {}),
        ...(star ? { star: true } : {})
      };
      if (!matchesSomething(criteria))
        return refused('Say which mail it matches: from, to, subject, query or has_attachment.');
      if (!doesSomething(action))
        return refused('Say what it does: skip_inbox, mark_read, add_label or star.');
      const box = mailbox(account);
      if ('problem' in box) return refused(box.problem);
      const on = await placed(where);
      if ('problem' in on) return refused(on.problem);
      const { ask } = await raiseAsk(ME, {
        ...on,
        kind: 'filter',
        title: `Gmail filter: ${filterWords({ criteria, action })}`.slice(0, 140),
        why,
        ifApproved: `The office creates it in your Gmail, with any changes you make, and tidies the mail it already matches if you tick that. Nothing changes before you click.`,
        filter: { criteria, action, summary, ...box },
        revises,
        via: VIA
      });
      return text(
        `Filter ${ask.id} is on ${OWNER}'s desk. Nothing changes in Gmail until they create it. Check my_asks later for what they did.`
      );
    }
  );
