// The office's own Gmail tools, as an MCP server inside the office process.
// The gateway reaches it in memory, so the owner's Google token never leaves
// the office. Gmail's scopes here are gmail.modify, so nothing can be deleted
// for good, only moved to the trash, and gmail.settings.basic for filters,
// which only the office creates, on the owner's click (filters.ts).
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  linkFooter,
  mailAttachmentPath,
  mailAttachments,
  withFooter,
  type MailAttachment
} from '@oddboro/ledger';
import { z } from 'zod';
import {
  doesWords,
  listed,
  matchWords,
  type FilterAction,
  type FilterCriteria
} from '@oddboro/ledger/filters';
import { zone } from '@oddboro/ledger/time';
import {
  accountServer,
  base64url,
  DATA_NOTE,
  decodeEntities,
  google,
  htmlToText,
  id,
  inTurn,
  run,
  send,
  untrusted,
  type Token
} from './http.ts';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
/** Gmail's upload address, which takes a whole email with its files as MIME. */
const GMAIL_UPLOAD = 'https://gmail.googleapis.com/upload/gmail/v1/users/me';

type Header = { name: string; value: string };
type Part = {
  mimeType?: string;
  filename?: string;
  headers?: Header[];
  body?: { data?: string; size?: number };
  parts?: Part[];
};
type Message = {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  payload?: Part;
};
type Thread = { id: string; snippet?: string; messages?: Message[] };
type Label = { id: string; name: string; type?: string };

const header = (m: Message | undefined, name: string) =>
  m?.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

/** A part's text, in the charset it says it is in. */
function decode(p: Part): string {
  const bytes = Buffer.from(p.body!.data!, 'base64url');
  const charset = /charset="?([\w-]+)/i.exec(
    p.headers?.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? ''
  )?.[1];
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

/** A message's body as plain text, and its attachments by name and size. */
function contents(m: Message): { body: string; files: string[] } {
  const found: { plain?: string; html?: string; files: string[] } = { files: [] };
  const walk = (p: Part) => {
    if (p.filename) found.files.push(`${p.filename} (${p.body?.size ?? 0} bytes)`);
    else if (p.body?.data && p.mimeType === 'text/plain') found.plain ??= decode(p);
    else if (p.body?.data && p.mimeType === 'text/html') found.html ??= decode(p);
    p.parts?.forEach(walk);
  };
  if (m.payload) walk(m.payload);
  return { body: found.plain ?? htmlToText(found.html ?? ''), files: found.files };
}

/** A header value with no line breaks, so nothing typed can add a header of its own. */
const oneLine = (v: string) => v.replace(/[\r\n]+/g, ' ').trim();
/** A subject in RFC 2047's form when it is not plain ASCII. */
const encoded = (v: string) =>
  /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v).toString('base64')}?=`;

/** One plain text email, a reply when it names a Gmail thread. */
export type Outgoing = {
  /** Addresses, separated by commas. */
  to: string;
  cc?: string;
  bcc?: string;
  /** The thread's own, as "Re: ...", when a reply gives none. */
  subject?: string;
  body: string;
  /** The Gmail thread it replies in. */
  threadId?: string;
  /** The Gmail message id it answers, else the thread's latest. */
  inReplyTo?: string;
  /** Files that go with it, read from the Odd's folder (`filesOf`). */
  attachments?: OutgoingFile[];
};
export type OutgoingFile = { name: string; mediaType: string; data: Buffer };

/**
 * The files an Odd named, from its own folder, checked (`mailAttachments`
 * in the ledger) and read now. Throws the words that turn them down.
 */
export function filesOf(staffId: string, named: (string | MailAttachment)[]): OutgoingFile[] {
  const checked = mailAttachments(
    staffId,
    named.map((n) => (typeof n === 'string' ? n : n.path))
  );
  if ('problem' in checked) throw new Error(checked.problem);
  return checked.map((a) => ({
    name: a.name,
    mediaType: a.mediaType,
    data: readFileSync(mailAttachmentPath(staffId, a))
  }));
}

/** A Markdown link to an https address, the only kind an email's HTML part makes a link. */
const LINK = /\[([^\]\n]+)\]\((https:\/\/[^\s()<>"]+)\)/g;

const escape = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The body as plain text, each https Markdown link as "text (address)". */
const plainText = (body: string) => body.replace(LINK, '$1 ($2)');

/** The body as HTML: every character escaped, line breaks kept, each https Markdown link a link. */
function html(body: string): string {
  let out = '';
  let at = 0;
  for (const m of body.matchAll(LINK)) {
    out += escape(body.slice(at, m.index));
    out += `<a href="${escape(m[2])}">${escape(m[1])}</a>`;
    at = m.index + m[0].length;
  }
  out += escape(body.slice(at));
  return `<div>${out.replace(/\r?\n/g, '<br>\n')}</div>`;
}

/** One MIME part's header and its text in base64, CRLF lines of 76. */
function part(type: string, text: string): string[] {
  const b64 = Buffer.from(text.replace(/\r?\n/g, '\r\n')).toString('base64');
  return [
    `Content-Type: ${type}; charset="UTF-8"`,
    'Content-Transfer-Encoding: base64',
    '',
    ...(b64.match(/.{1,76}/g) ?? [])
  ];
}

/**
 * The body as MIME: plain text alone, or, when it holds an https Markdown
 * link (such as the footer), plain text and HTML side by side, so the link
 * is a link in mail programs that show HTML.
 */
function bodyParts(written: string): string[] {
  // The footer goes as plain words in the editor and links only here.
  const body = linkFooter(written);
  if (!body.match(LINK)) return part('text/plain', body);
  const boundary = `oddboro-${randomUUID()}`;
  return [
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    ...part('text/plain', plainText(body)),
    `--${boundary}`,
    ...part('text/html', html(body)),
    `--${boundary}--`
  ];
}

const metadata = (names: string[]) =>
  `format=metadata${names.map((n) => `&metadataHeaders=${n}`).join('')}`;

/**
 * The message as Gmail takes it: `raw`, and the thread it goes in. A reply
 * carries In-Reply-To and References from the message it answers, so mail
 * programs keep it in the conversation.
 */
export async function message(
  token: Token,
  m: Outgoing
): Promise<{ raw: string; threadId?: string }> {
  const { text, threadId } = await mime(token, m);
  return { raw: base64url(text), ...(threadId ? { threadId } : {}) };
}

/** One file as a MIME part: its name in plain letters, and in full when it has others (RFC 2231). */
function filePart(f: OutgoingFile): string[] {
  const plain = f.name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const full = plain === f.name ? '' : `; filename*=UTF-8''${encodeURIComponent(f.name)}`;
  return [
    `Content-Type: ${f.mediaType}; name="${plain}"`,
    `Content-Disposition: attachment; filename="${plain}"${full}`,
    'Content-Transfer-Encoding: base64',
    '',
    ...(f.data.toString('base64').match(/.{1,76}/g) ?? [])
  ];
}

/** The body, and with files, the body then each file in one multipart/mixed. */
function contentParts(m: Outgoing): string[] {
  if (!m.attachments?.length) return bodyParts(m.body);
  const boundary = `oddboro-${randomUUID()}`;
  return [
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    ...bodyParts(m.body),
    ...m.attachments.flatMap((f) => [`--${boundary}`, ...filePart(f)]),
    `--${boundary}--`
  ];
}

/** The email as MIME text, and the thread it goes in. */
async function mime(token: Token, m: Outgoing): Promise<{ text: string; threadId?: string }> {
  const headers: Record<string, string> = { To: m.to };
  if (m.cc) headers.Cc = m.cc;
  if (m.bcc) headers.Bcc = m.bcc;
  let subject = m.subject;
  if (m.threadId) {
    const names = metadata(['Subject', 'Message-ID', 'References']);
    const answers = m.inReplyTo
      ? await google<Message>(token, `${GMAIL}/messages/${m.inReplyTo}?${names}`)
      : (await google<Thread>(token, `${GMAIL}/threads/${m.threadId}?${names}`)).messages?.at(-1);
    const was = header(answers, 'Subject');
    subject ??= /^re:/i.test(was) ? was : `Re: ${was}`;
    const parent = header(answers, 'Message-ID');
    if (parent) {
      headers['In-Reply-To'] = parent;
      headers.References = `${header(answers, 'References')} ${parent}`.trim();
    }
  }
  headers.Subject = encoded(oneLine(subject ?? ''));
  const text = [
    ...Object.entries(headers).map(([k, v]) => `${k}: ${oneLine(v)}`),
    'MIME-Version: 1.0',
    ...contentParts(m)
  ].join('\r\n');
  return { text, ...(m.threadId ? { threadId: m.threadId } : {}) };
}

/**
 * An email with files goes to Gmail's upload address as MIME, beside its
 * thread in JSON (`uploadType=multipart`), which takes up to 35 MB where the
 * plain address takes far less. `meta` places the thread as the call wants it.
 */
async function upload<T>(token: Token, path: string, mail: string, meta: object): Promise<T> {
  const boundary = `oddboro-${randomUUID()}`;
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(meta),
    `--${boundary}`,
    'Content-Type: message/rfc822',
    '',
    mail,
    `--${boundary}--`
  ].join('\r\n');
  return google<T>(token, `${GMAIL_UPLOAD}/${path}?uploadType=multipart`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body
  });
}

/** What adding or taking off one of Gmail's own labels does, in the owner's words. */
const LABEL_WORDS: Record<string, { add: string; remove: string }> = {
  INBOX: { add: 'Move back to the inbox', remove: 'Archive' },
  UNREAD: { add: 'Mark unread', remove: 'Mark read' },
  STARRED: { add: 'Star', remove: 'Unstar' },
  IMPORTANT: { add: 'Mark important', remove: 'Mark not important' },
  SPAM: { add: 'Report as spam', remove: 'Take out of spam' },
  TRASH: { add: 'Move to Trash', remove: 'Take out of Trash' }
};
/** What each tool that acts on one thread does. */
const THREAD_WORDS: Record<string, string> = {
  trash_thread: 'Move to Trash',
  untrash_thread: 'Take out of Trash',
  mark_thread_spam: 'Report as spam',
  unmark_thread_spam: 'Take out of spam'
};

/**
 * A held Gmail call in the owner's words. `title` says what it does and to
 * how many emails, from the call alone, since it reaches the Odd's prompt.
 * `items` names each email by subject, sender and date, read from Gmail now;
 * those come from strangers, so they show on the page and nowhere else.
 */
export type HeldWords = { title: string; items: string[] };

export async function heldWords(
  token: Token,
  tool: string,
  args: Record<string, unknown>
): Promise<HeldWords | undefined> {
  const list = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const said = (label: string, way: 'add' | 'remove') =>
    LABEL_WORDS[label.toUpperCase()]?.[way] ??
    (way === 'add' ? `Label as "${label}"` : `Take the label "${label}" off`);
  const verbs =
    tool === 'update_labels'
      ? [
          ...list(args.remove).map((l) => said(l, 'remove')),
          ...list(args.add).map((l) => said(l, 'add'))
        ]
      : THREAD_WORDS[tool]
        ? [THREAD_WORDS[tool]]
        : [];
  const threads = [
    ...new Set([
      ...list(args.thread_ids),
      ...(typeof args.thread_id === 'string' ? [args.thread_id] : [])
    ])
  ];
  if (!verbs.length || !threads.length) return undefined;
  const lower = verbs.map((v, i) => (i ? v[0].toLowerCase() + v.slice(1) : v));
  const action =
    lower.length === 1 ? lower[0] : `${lower.slice(0, -1).join(', ')} and ${lower.at(-1)}`;
  const day = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: zone()
  });
  const items = await Promise.all(
    threads.map(async (t) => {
      try {
        const th = await google<Thread>(
          token,
          `${GMAIL}/threads/${t}?${metadata(['Subject', 'From', 'Date'])}`
        );
        const first = th.messages?.[0];
        const subject = oneLine(header(first, 'Subject')) || '(no subject)';
        const from = header(th.messages?.at(-1), 'From');
        const who = oneLine(/^\s*"?([^"<]+?)"?\s*</.exec(from)?.[1] ?? from) || 'an unknown sender';
        const date = Date.parse(header(th.messages?.at(-1), 'Date'));
        return `"${subject}" from ${who}${Number.isNaN(date) ? '' : `, ${day.format(date)}`}`;
      } catch {
        return `An email Gmail would not show (thread ${t})`;
      }
    })
  );
  return {
    title: `${action}: ${threads.length === 1 ? '1 email' : `${threads.length} emails`}`,
    items
  };
}

/** Save an email as a Gmail draft. Nothing is sent. Gives the draft's id. */
export async function saveDraft(token: Token, m: Outgoing): Promise<string> {
  if (m.attachments?.length) {
    const { text, threadId } = await mime(token, m);
    const thread = threadId ? { threadId } : {};
    return (await upload<{ id: string }>(token, 'drafts', text, { message: thread })).id;
  }
  const draft = await google<{ id: string }>(
    token,
    `${GMAIL}/drafts`,
    send('POST', { message: await message(token, m) })
  );
  return draft.id;
}

/** Send an email. Only the office calls this, on the owner's click. Gives the sent message's id. */
export async function sendMail(token: Token, m: Outgoing): Promise<string> {
  if (m.attachments?.length) {
    const { text, threadId } = await mime(token, m);
    return (await upload<Message>(token, 'messages/send', text, threadId ? { threadId } : {})).id;
  }
  const sent = await google<Message>(
    token,
    `${GMAIL}/messages/send`,
    send('POST', await message(token, m))
  );
  return sent.id;
}

/** One email as the owner reads it: who sent it, when, its subject and its body as plain text. */
export type Received = { from: string; date: string; subject: string; body: string };

/**
 * The email a reply answers: the message `inReplyTo` names in the thread,
 * else its latest that is not a draft. Undefined when the thread has none.
 */
export async function answered(
  token: Token,
  threadId: string,
  inReplyTo?: string
): Promise<Received | undefined> {
  const t = await google<Thread>(token, `${GMAIL}/threads/${threadId}?format=full`);
  const all = (t.messages ?? []).filter((m) => !m.labelIds?.includes('DRAFT'));
  const m = all.find((x) => x.id === inReplyTo) ?? all.at(-1);
  if (!m) return undefined;
  return {
    from: header(m, 'From'),
    date: header(m, 'Date'),
    subject: header(m, 'Subject'),
    body: contents(m).body
  };
}

/** One filter as Gmail keeps it. */
type Filter = {
  id: string;
  criteria?: FilterCriteria & { excludeChats?: boolean; size?: number; sizeComparison?: string };
  action?: { addLabelIds?: string[]; removeLabelIds?: string[]; forward?: string };
};

/** Gmail's own labels a filter adds or takes off, in the words after "will". */
const SYSTEM_ADDS: Record<string, string> = {
  STARRED: 'be starred',
  TRASH: 'go to the trash',
  IMPORTANT: 'be marked important',
  SPAM: 'go to spam'
};
const SYSTEM_REMOVES: Record<string, string> = {
  INBOX: 'skip the inbox',
  UNREAD: 'be marked read',
  IMPORTANT: 'never be marked important',
  SPAM: 'never go to spam'
};

/** A Gmail filter in plain words, its label ids turned into names. */
function filterLine(f: Filter, labelName: (id: string) => string): string {
  const c = f.criteria ?? {};
  const extra = [
    c.size && `${c.sizeComparison === 'smaller' ? 'smaller' : 'larger'} than ${c.size} bytes`,
    c.excludeChats && 'not chats'
  ].filter((p): p is string => !!p);
  const what = matchWords(c);
  const matches = extra.length ? `${what}, ${extra.join(', ')}` : what;
  const a = f.action ?? {};
  const does = [
    ...(a.removeLabelIds ?? []).map((l) => SYSTEM_REMOVES[l] ?? `lose the label "${labelName(l)}"`),
    ...(a.addLabelIds ?? []).map((l) =>
      l.startsWith('CATEGORY_')
        ? `go under ${l.slice(9).toLowerCase()}`
        : (SYSTEM_ADDS[l] ?? `get the label "${labelName(l)}"`)
    ),
    ...(a.forward ? [`be forwarded to ${a.forward}`] : [])
  ];
  return `Filter ${f.id}: ${matches} will ${does.length ? listed(does) : 'stay as it is'}.`;
}

/**
 * The Gmail search that finds what a filter matches, as Gmail itself reads
 * the filter: every field must match.
 */
export function filterQuery(c: FilterCriteria): string {
  const t = (v: string | undefined) => v?.replace(/[()]/g, ' ').trim();
  return [
    t(c.from) && `from:(${t(c.from)})`,
    t(c.to) && `to:(${t(c.to)})`,
    t(c.subject) && `subject:(${t(c.subject)})`,
    t(c.query) && `(${t(c.query)})`,
    t(c.negatedQuery) && `-(${t(c.negatedQuery)})`,
    c.hasAttachment && 'has:attachment'
  ]
    .filter(Boolean)
    .join(' ');
}

/** About how many emails a Gmail search finds today: Gmail's own estimate. */
/** Where counting stops: past it the card says "or more". Ten pages of ids at most. */
export const COUNT_CAP = 5000;

/**
 * How many messages a search matches, counted page by page up to
 * `COUNT_CAP`. Gmail's own `resultSizeEstimate` is a rough guess that came
 * back as 201 for nearly every search, so it is not used.
 */
export async function countMatching(token: Token, query: string): Promise<number> {
  let count = 0;
  let page: string | undefined;
  do {
    const r = await google<{ messages?: { id: string }[]; nextPageToken?: string }>(
      token,
      `${GMAIL}/messages?q=${encodeURIComponent(query)}&maxResults=500${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`
    );
    count += r.messages?.length ?? 0;
    page = r.nextPageToken;
  } while (page && count < COUNT_CAP);
  return Math.min(count, COUNT_CAP);
}

/** A label name that is one of Gmail's own (Inbox, Trash, Spam and the rest), which a filter may not add. */
export class GmailOwnLabel extends Error {}

/**
 * The id of the owner's label with this name, matched without regard to
 * case, made first when there is none. Never one of Gmail's own labels, so
 * a label named "Trash" cannot send mail to the trash.
 */
export async function labelFor(token: Token, name: string): Promise<string> {
  const { labels = [] } = await google<{ labels?: Label[] }>(token, `${GMAIL}/labels`);
  const same = labels.filter((l) => l.name.toLowerCase() === name.toLowerCase());
  if (same.some((l) => l.type === 'system'))
    throw new GmailOwnLabel(`"${name}" is one of Gmail's own labels. Pick another name.`);
  if (same[0]) return same[0].id;
  const made = await google<Label>(
    token,
    `${GMAIL}/labels`,
    send('POST', { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' })
  );
  return made.id;
}

/** The label changes a filter's action makes, as Gmail takes them. */
export function labelChanges(
  a: FilterAction,
  labelId?: string
): { addLabelIds: string[]; removeLabelIds: string[] } {
  return {
    addLabelIds: [...(labelId ? [labelId] : []), ...(a.star ? ['STARRED'] : [])],
    removeLabelIds: [...(a.skipInbox ? ['INBOX'] : []), ...(a.markRead ? ['UNREAD'] : [])]
  };
}

/** Make a Gmail filter. Only the office calls this, on the owner's click. Gives the filter's id. */
export async function makeFilter(
  token: Token,
  criteria: FilterCriteria,
  changes: { addLabelIds: string[]; removeLabelIds: string[] }
): Promise<string> {
  const made = await google<{ id: string }>(
    token,
    `${GMAIL}/settings/filters`,
    send('POST', { criteria, action: changes })
  );
  return made.id;
}

/**
 * Make the same label changes to every email a search finds now: Gmail's
 * list a page at a time, then its batch change 1,000 at a time. Gives how
 * many emails it changed. Mail in the trash and spam is left alone.
 */
export async function tidyMatching(
  token: Token,
  query: string,
  changes: { addLabelIds: string[]; removeLabelIds: string[] }
): Promise<number> {
  const ids: string[] = [];
  let page: string | undefined;
  do {
    const r = await google<{ messages?: { id: string }[]; nextPageToken?: string }>(
      token,
      `${GMAIL}/messages?q=${encodeURIComponent(query)}&maxResults=500${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`
    );
    ids.push(...(r.messages ?? []).map((m) => m.id));
    page = r.nextPageToken;
  } while (page);
  for (let i = 0; i < ids.length; i += 1000)
    await google(
      token,
      `${GMAIL}/messages/batchModify`,
      send('POST', { ids: ids.slice(i, i + 1000), ...changes })
    );
  return ids.length;
}

export function gmailServer(token: Token, account?: string): McpServer {
  const server = accountServer('gmail', account, 'the Gmail account');
  const get = <T>(path: string) => google<T>(token, `${GMAIL}${path}`);
  const post = <T>(path: string, body: unknown = {}) =>
    google<T>(token, `${GMAIL}${path}`, send('POST', body));

  /** Label ids for ids or names, matched without regard to case. */
  async function labelIds(given: string[]): Promise<string[]> {
    if (!given.length) return [];
    const { labels = [] } = await get<{ labels?: Label[] }>('/labels');
    return given.map((g) => {
      const l =
        labels.find((l) => l.id === g) ??
        labels.find((l) => l.name.toLowerCase() === g.toLowerCase());
      if (!l) throw new Error(`no label is called "${g}". list_labels gives every label.`);
      return l.id;
    });
  }
  const modify = (thread: string, add: string[], remove: string[]) =>
    post(`/threads/${thread}/modify`, { addLabelIds: add, removeLabelIds: remove });

  const READ = { readOnlyHint: true };
  const WRITE = { readOnlyHint: false };
  const DESTROY = { readOnlyHint: false, destructiveHint: true };
  const thread = { thread_id: id.describe('The thread id, from search_threads.') };
  const max = z
    .number()
    .int()
    .positive()
    .optional()
    .describe('How many to return: 10 unless given, 50 at most.');

  server.registerTool(
    'search_threads',
    {
      description: `Search the owner's Gmail with Gmail's own query words (from:, is:unread, after:2026/01/01, label:, and plain words). Gives each thread's id, subject, sender, date of its latest message, snippet and labels. ${DATA_NOTE}`,
      inputSchema: {
        query: z.string().describe('A Gmail search, as typed in Gmail.'),
        max_results: max
      },
      annotations: READ
    },
    run(async ({ query, max_results = 10 }) => {
      const n = Math.min(max_results, 50);
      const { threads = [] } = await get<{ threads?: Thread[] }>(
        `/threads?q=${encodeURIComponent(query)}&maxResults=${n}`
      );
      if (!threads.length) return 'No thread matches that search.';
      const found = await inTurn(threads, async (t) => {
        const full = await get<Thread>(`/threads/${t.id}?${metadata(['Subject', 'From', 'Date'])}`);
        const first = full.messages?.[0];
        const last = full.messages?.at(-1);
        return {
          id: t.id,
          subject: header(first, 'Subject'),
          from: header(first, 'From'),
          date: header(last, 'Date'),
          snippet: decodeEntities(t.snippet ?? ''),
          labels: [...new Set(full.messages?.flatMap((m) => m.labelIds ?? []))]
        };
      });
      return untrusted('gmail', JSON.stringify(found, null, 2), 'search results');
    })
  );

  server.registerTool(
    'get_thread',
    {
      description: `Read a whole Gmail thread: each message's sender, recipients, date, subject, label ids and body as plain text, and the names and sizes of its attachments (never their content). ${DATA_NOTE}`,
      inputSchema: thread,
      annotations: READ
    },
    run(async ({ thread_id }) => {
      const t = await get<Thread>(`/threads/${thread_id}?format=full`);
      const messages = (t.messages ?? []).map((m) => {
        const { body, files } = contents(m);
        const lines = [
          ...['From', 'To', 'Cc', 'Date', 'Subject'].flatMap((h) =>
            header(m, h) ? [`${h}: ${header(m, h)}`] : []
          ),
          `Labels: ${(m.labelIds ?? []).join(', ')}`,
          ...(files.length ? [`Attachments: ${files.join('; ')}`] : []),
          '',
          body
        ];
        return untrusted('gmail', lines.join('\n'), m.id);
      });
      return [`Thread ${t.id}, ${messages.length} messages, oldest first.`, ...messages].join(
        '\n\n'
      );
    })
  );

  server.registerTool(
    'list_labels',
    {
      description: `List the owner's Gmail labels with their ids, Gmail's own (INBOX, UNREAD, STARRED) and the owner's. ${DATA_NOTE}`,
      annotations: READ
    },
    run(async () => {
      const { labels = [] } = await get<{ labels?: Label[] }>('/labels');
      const lines = labels.map((l) => `${l.id}: ${l.name}${l.type === 'system' ? ' (Gmail)' : ''}`);
      return untrusted('gmail', lines.join('\n'), 'labels');
    })
  );

  server.registerTool(
    'list_filters',
    {
      description: `List the owner's Gmail filters in plain words: what mail each one matches and what it does to it, with label names. Read it before propose_filter, so you never propose a filter the owner already has. ${DATA_NOTE}`,
      annotations: READ
    },
    run(async () => {
      const [{ filter = [] }, { labels = [] }] = await Promise.all([
        get<{ filter?: Filter[] }>('/settings/filters'),
        get<{ labels?: Label[] }>('/labels')
      ]);
      if (!filter.length) return 'There are no filters.';
      const name = (id: string) => labels.find((l) => l.id === id)?.name ?? id;
      return untrusted('gmail', filter.map((f) => filterLine(f, name)).join('\n'), 'filters');
    })
  );

  server.registerTool(
    'list_drafts',
    {
      description: `List the owner's Gmail drafts, newest first: draft id, thread id, recipients and subject. ${DATA_NOTE}`,
      inputSchema: { max_results: max },
      annotations: READ
    },
    run(async ({ max_results = 10 }) => {
      const n = Math.min(max_results, 50);
      const { drafts = [] } = await get<{ drafts?: { id: string }[] }>(`/drafts?maxResults=${n}`);
      if (!drafts.length) return 'There are no drafts.';
      const found = await inTurn(drafts, async (d) => {
        const { message } = await get<{ message: Message }>(
          `/drafts/${d.id}?${metadata(['To', 'Subject'])}`
        );
        return {
          id: d.id,
          thread_id: message.threadId,
          to: header(message, 'To'),
          subject: header(message, 'Subject')
        };
      });
      return untrusted('gmail', JSON.stringify(found, null, 2), 'drafts');
    })
  );

  server.registerTool(
    'update_labels',
    {
      description:
        'Add and remove labels on every message in one or more threads, by label id or name. This is how mail is marked read (remove UNREAD), marked unread (add UNREAD), archived (remove INBOX), moved back to the inbox (add INBOX) and starred (add STARRED). Change every thread that gets the same labels in one call, with thread_ids: never one call per thread. Mail a filter you propose already matches is tidied by that filter, so leave it to the filter.',
      inputSchema: {
        thread_ids: z
          .array(id)
          .min(1)
          .max(100)
          .optional()
          .describe('Every thread to change, from search_threads.'),
        thread_id: id.optional().describe('One thread, when there is only one.'),
        add: z.array(z.string()).optional().describe('Label ids or names to add.'),
        remove: z.array(z.string()).optional().describe('Label ids or names to take off.')
      },
      annotations: WRITE
    },
    run(async ({ thread_ids = [], thread_id, add = [], remove = [] }) => {
      const threads = [...new Set([...thread_ids, ...(thread_id ? [thread_id] : [])])];
      if (!threads.length) throw new Error('name the threads to change, in thread_ids.');
      const [adds, removes] = [await labelIds(add), await labelIds(remove)];
      for (const t of threads) await modify(t, adds, removes);
      const did = `added ${add.join(', ') || 'nothing'}, removed ${remove.join(', ') || 'nothing'}`;
      return threads.length === 1
        ? `Thread ${threads[0]}: ${did}.`
        : `${threads.length} threads: ${did}.`;
    })
  );

  server.registerTool(
    'create_draft',
    {
      description:
        'Write a draft in the owner\'s Gmail. Nothing is sent: the draft waits in Drafts. Give thread_id to draft a reply in that thread; the subject then defaults to the thread\'s. The office ends the body with a line "Sent from Oddboro", which the owner may delete: never write it yourself.',
      inputSchema: {
        to: z.string().describe('Addresses, separated by commas.'),
        cc: z.string().optional(),
        bcc: z.string().optional(),
        subject: z.string().optional(),
        body: z.string().describe('The message, as plain text.'),
        thread_id: id.optional().describe('The thread this replies to.'),
        attachments: z
          .array(z.string())
          .max(10)
          .optional()
          .describe(
            'Files from your own folder to attach, by their path inside it or their full path, like "attachments/20261110-081108-35bc-image.png". Files the owner attached in chat are in attachments/. Up to 10, 18 MB together.'
          )
      },
      annotations: WRITE
    },
    run(async ({ to, cc, bcc, subject, body, thread_id, attachments = [] }, odd) => {
      // Only the office says whose call this is (`ODD_META`), so only that Odd's files go.
      if (attachments.length && !odd) throw new Error('Files can be attached only from a run.');
      const files = attachments.length ? filesOf(odd!, attachments) : undefined;
      // The footer goes in now, where the owner sees it in Drafts and may delete it.
      const draft = await saveDraft(token, {
        to,
        cc,
        bcc,
        subject,
        body: withFooter(body),
        threadId: thread_id,
        attachments: files
      });
      const said = files ? ` with ${files.map((f) => f.name).join(', ')} attached` : '';
      return `Draft ${draft} is saved in Drafts${said}. Nothing was sent.`;
    })
  );

  server.registerTool(
    'send_draft',
    {
      description:
        'Send a draft that already exists, by its draft id. It cannot write or change a message.',
      inputSchema: { draft_id: id.describe('The draft id, from create_draft or list_drafts.') },
      annotations: WRITE
    },
    run(async ({ draft_id }) => {
      const sent = await post<Message>('/drafts/send', { id: draft_id });
      return `Sent. Message ${sent.id} in thread ${sent.threadId}.`;
    })
  );

  /** A tool that does one thing to one thread. */
  const threadTool = (
    name: string,
    description: string,
    annotations: { readOnlyHint: boolean; destructiveHint?: boolean },
    act: (thread: string) => Promise<unknown>,
    done: string
  ) =>
    server.registerTool(
      name,
      { description, inputSchema: thread, annotations },
      run(async ({ thread_id }) => {
        await act(thread_id);
        return `Thread ${thread_id} ${done}.`;
      })
    );
  threadTool(
    'trash_thread',
    'Move a thread to the trash, where Gmail keeps it 30 days.',
    DESTROY,
    (t) => post(`/threads/${t}/trash`),
    'is in the trash'
  );
  threadTool(
    'untrash_thread',
    'Take a thread back out of the trash.',
    WRITE,
    (t) => post(`/threads/${t}/untrash`),
    'is out of the trash'
  );
  threadTool(
    'mark_thread_spam',
    'Report a thread as spam: it leaves the inbox for Spam.',
    DESTROY,
    (t) => modify(t, ['SPAM'], ['INBOX']),
    'is in Spam'
  );
  threadTool(
    'unmark_thread_spam',
    'Take a thread out of Spam and back to the inbox.',
    WRITE,
    (t) => modify(t, ['INBOX'], ['SPAM']),
    'is back in the inbox'
  );

  return server;
}
