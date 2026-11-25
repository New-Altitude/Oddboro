// Each Odd's chat as rows the office can search (`chat_history`): one per
// exchange, the owner's words with the Odd's reply, embedded like the ledger.
// The chat's file stays what the page shows. A chat that rolled into a fresh
// session finds what was said before through `search_chats`, which reads the
// Odd's own chats and the chat turns that started work it was handed.
import { existsSync, readFileSync } from 'node:fs';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { and, asc, cosineDistance, desc, eq, gt, isNull, ne, or, sql } from 'drizzle-orm';
import { db } from './db.ts';
import { embed, EMBED_MODEL } from './embed.ts';
import { home, OFFICE_FILES } from './home.ts';
import { chatHistory, staff } from './schema.ts';
import { modelOnDisk } from './search-model.ts';

/** What a row reads from one line of a chat's file. */
export type ChatLine = {
  at: string;
  from: 'owner' | 'staff';
  text: string;
  turnId?: string;
  runId?: string;
  failed?: true;
  interrupted?: true;
  /** A line the office wrote in the chat, or a reminder the Odd set: never a reply. */
  told?: true;
  poke?: true;
};

type Exchange = { key: string; at: Date; owner: string; reply: string; runId: string | null };

/**
 * The row a line belongs to: its owner turn, or the line itself when it has
 * none, by its time and who said it. An older office wrote a told line at the
 * very time of the owner's line it answered.
 */
const keyOf = (l: ChatLine): string => l.turnId ?? `at:${l.at}:${l.from}`;
/** A line the search keeps: words, and no failed or stopped reply. */
const kept = (l: ChatLine): boolean => !!l.text.trim() && !l.failed && !l.interrupted;

/**
 * A chat's lines as exchanges, in the order they began: each owner turn's
 * words (more than one with Send now) and its last reply, and each line the
 * Odd said alone. A chat from before the office kept turn ids has none on
 * its lines, so there an owner's line opens an exchange, more owner lines join
 * it, and the Odd's next reply closes it. A told line or a reminder in
 * between stands alone.
 */
export function exchangesOf(lines: ChatLine[]): Exchange[] {
  const rows = new Map<string, Exchange>();
  /** An exchange from before turn ids, still waiting for its reply. */
  let open: Exchange | undefined;
  const fresh = (key: string, l: ChatLine): Exchange => ({
    key,
    at: new Date(l.at),
    owner: '',
    reply: '',
    runId: null
  });
  /** Whether the row already holds this line's words where the line puts them. */
  const holds = (r: Exchange, l: ChatLine) => (l.from === 'owner' ? r.owner : r.reply) === l.text;
  for (const l of lines.filter(kept)) {
    const alone = !l.turnId && l.from === 'staff' && (l.told || l.poke);
    let row: Exchange;
    if (l.turnId) row = rows.get(l.turnId) ?? fresh(l.turnId, l);
    else if (!alone && open) row = open;
    else {
      // The same line twice is one row. Another line at the same time, from
      // the same side, gets a row of its own, so no line's words are lost.
      let key = keyOf(l);
      for (let n = 2; rows.has(key) && !holds(rows.get(key)!, l); n++) key = `${keyOf(l)}#${n}`;
      const same = rows.get(key);
      if (same) {
        if (!alone) open = l.from === 'owner' ? same : undefined;
        continue;
      }
      row = fresh(key, l);
    }
    if (l.from === 'owner') row.owner = row.owner ? `${row.owner}\n\n${l.text}` : l.text;
    else {
      row.reply = l.text;
      row.runId = l.runId ?? row.runId;
    }
    rows.set(row.key, row);
    if (alone) continue;
    open = !l.turnId && l.from === 'owner' ? row : undefined;
  }
  return [...rows.values()];
}

/** The text a row's vector is made from. */
const rowText = (r: { owner: string; reply: string }): string =>
  [r.owner, r.reply].filter(Boolean).join('\n\n');

/** Each Odd's latest write, so its lines land in the order they were said. */
const writing = new Map<string, Promise<void>>();

/**
 * Keep one line of an Odd's chat as it is written. An owner's line opens or
 * adds to its turn's row; the reply fills it in and makes its vector. A
 * failed or stopped reply, or a line with no words, is not kept.
 */
export function keepChatLine(staffId: string, line: ChatLine): Promise<void> {
  if (!kept(line)) return Promise.resolve();
  const next = (writing.get(staffId) ?? Promise.resolve())
    .catch(() => {})
    .then(() => keepLine(staffId, line));
  writing.set(staffId, next);
  const done = () => {
    if (writing.get(staffId) === next) writing.delete(staffId);
  };
  next.then(done, done);
  return next;
}

async function keepLine(staffId: string, line: ChatLine): Promise<void> {
  const key = keyOf(line);
  const at = new Date(line.at);
  if (line.from === 'owner') {
    await db
      .insert(chatHistory)
      .values({ staffId, key, at, owner: line.text })
      .onConflictDoUpdate({
        target: [chatHistory.staffId, chatHistory.key],
        set: {
          owner: sql`case when ${chatHistory.owner} = '' then excluded.owner else ${chatHistory.owner} || E'\n\n' || excluded.owner end`
        }
      });
    return;
  }
  const [row] = await db
    .insert(chatHistory)
    .values({ staffId, key, at, reply: line.text, runId: line.runId ?? null })
    .onConflictDoUpdate({
      target: [chatHistory.staffId, chatHistory.key],
      set: { reply: line.text, runId: line.runId ?? null }
    })
    .returning({ id: chatHistory.id, owner: chatHistory.owner, reply: chatHistory.reply });
  // With no search model, the row waits for the re-index (`reindexChats`).
  const embedding = await embed(rowText(row), 'document');
  if (!embedding) return;
  await db
    .update(chatHistory)
    .set({ embedding, embeddingModel: EMBED_MODEL })
    .where(eq(chatHistory.id, row.id));
}

/**
 * Load each Odd's chat file into `chat_history`, once: an Odd with rows
 * already is done, and one Odd's file goes in whole or not at all. It runs as
 * the office starts, before anything writes a chat line, and makes no
 * vectors: the ledger's re-index makes them (`reindexChats`), and until then
 * a search finds these rows by their words. Resolves to the rows it added.
 */
export async function loadChats(): Promise<number> {
  let added = 0;
  for (const { id } of await db.select({ id: staff.id }).from(staff)) {
    const file = home('staff', id, OFFICE_FILES.chat);
    if (!existsSync(file)) continue;
    const [has] = await db
      .select({ id: chatHistory.id })
      .from(chatHistory)
      .where(eq(chatHistory.staffId, id))
      .limit(1);
    if (has) continue;
    const rows = exchangesOf(linesOf(readFileSync(file, 'utf8')));
    if (!rows.length) continue;
    await db.transaction(async (tx) => {
      for (let i = 0; i < rows.length; i += 500)
        await tx
          .insert(chatHistory)
          .values(rows.slice(i, i + 500).map((r) => ({ staffId: id, ...r })))
          .onConflictDoNothing();
    });
    added += rows.length;
  }
  return added;
}

/** A chat file's lines. A line that does not parse is left out, as the page leaves it out. */
function linesOf(text: string): ChatLine[] {
  return text.split('\n').flatMap((l) => {
    if (!l.trim()) return [];
    try {
      const e = JSON.parse(l) as Partial<ChatLine>;
      return typeof e.at === 'string' && typeof e.text === 'string' && e.from
        ? [e as ChatLine]
        : [];
    } catch {
      return [];
    }
  });
}

const notMadeHere = () =>
  or(isNull(chatHistory.embeddingModel), ne(chatHistory.embeddingModel, EMBED_MODEL));
const BATCH = 32;
let indexed = false;

/**
 * Make the vector for every chat row the search model has not made, oldest
 * first, a batch at a time with a turn for everything else between batches.
 * The ledger's re-index runs it after its own rows (`reindexLedger`).
 * Resolves to the number of rows it made.
 */
export async function reindexChats(): Promise<number> {
  if (!modelOnDisk()) return 0;
  let after = 0;
  let made = 0;
  for (;;) {
    const rows = await db
      .select({ id: chatHistory.id, owner: chatHistory.owner, reply: chatHistory.reply })
      .from(chatHistory)
      .where(and(gt(chatHistory.id, after), notMadeHere()))
      .orderBy(asc(chatHistory.id))
      .limit(BATCH);
    if (!rows.length) break;
    for (const r of rows) {
      const embedding = await embed(rowText(r), 'document');
      if (!embedding) return made;
      await db
        .update(chatHistory)
        .set({ embedding, embeddingModel: EMBED_MODEL })
        .where(eq(chatHistory.id, r.id));
      made++;
    }
    after = rows.at(-1)!.id;
    await nextTurn();
  }
  indexed = true;
  return made;
}

/** Whether every row has its vector, so a search by meaning misses none. */
async function byMeaning(): Promise<boolean> {
  if (!modelOnDisk()) return false;
  if (indexed) return true;
  const [left] = await db
    .select({ id: chatHistory.id })
    .from(chatHistory)
    .where(notMadeHere())
    .limit(1);
  indexed = !left;
  return indexed;
}

export type ChatHit = {
  /** Whose chat it was. */
  staffId: string;
  at: Date;
  owner: string;
  reply: string;
};

/**
 * The rows an Odd may search: its own chats, and the chat turns that started
 * or added to a thread it leads, holds or was handed a step of (`threads.runs`).
 */
const readableBy = (staffId: string) => sql`(
  ${chatHistory.staffId} = ${staffId}
  or ${chatHistory.runId} in (
    select unnest(t.runs) from threads t
    where t.hub_id = ${staffId}
       or t.holder_id = ${staffId}
       or exists (select 1 from follow_ups f where f.thread_id = t.id and f.staff_id = ${staffId})
  )
)`;

/** Search an Odd's chats by meaning once the search model is here, by words until then. Newest first with no query. */
export async function searchChats(staffId: string, query: string, limit = 10): Promise<ChatHit[]> {
  const n = Math.min(Math.max(limit, 1), 50);
  const columns = {
    staffId: chatHistory.staffId,
    at: chatHistory.at,
    owner: chatHistory.owner,
    reply: chatHistory.reply
  };
  const mine = readableBy(staffId);
  if (!query.trim())
    return db.select(columns).from(chatHistory).where(mine).orderBy(desc(chatHistory.at)).limit(n);
  const v = (await byMeaning()) ? await embed(query, 'query') : null;
  if (v)
    return db
      .select(columns)
      .from(chatHistory)
      .where(and(mine, eq(chatHistory.embeddingModel, EMBED_MODEL)))
      .orderBy(cosineDistance(chatHistory.embedding, v))
      .limit(n);
  return db
    .select(columns)
    .from(chatHistory)
    .where(
      and(
        mine,
        sql`to_tsvector('english', ${chatHistory.owner} || ' ' || ${chatHistory.reply}) @@ websearch_to_tsquery('english', ${query})`
      )
    )
    .orderBy(desc(chatHistory.at))
    .limit(n);
}
