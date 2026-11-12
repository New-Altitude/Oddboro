// Writing a ledger row and searching the ledger.
import { and, cosineDistance, desc, eq, sql } from 'drizzle-orm';
import { db } from './db.ts';
import { embed } from './embed.ts';
import { type Db } from './threads.ts';
import { ledger, type LedgerKind } from './schema.ts';
import type { LedgerRow } from './office.ts';

// The ledger

/** Write one ledger row, embedded on the way in. */
export async function record(
  e: {
    kind: LedgerKind;
    actor: string;
    title: string;
    body?: string;
    reason?: string | null;
    askId?: number;
    taskId?: number;
    runId?: number;
  },
  q: Db = db
): Promise<void> {
  const text = [e.title, e.body, e.reason].filter(Boolean).join('\n');
  await q.insert(ledger).values({ ...e, embedding: await embed(text, 'document') });
}

const ledgerColumns = {
  id: ledger.id,
  kind: ledger.kind,
  actor: ledger.actor,
  title: ledger.title,
  body: ledger.body,
  reason: ledger.reason,
  askId: ledger.askId,
  taskId: ledger.taskId,
  runId: ledger.runId,
  createdAt: ledger.createdAt
};

/** Search by meaning when Ollama is up, by words when it is not. Newest first with no query. */
export async function searchLedger(
  query: string,
  opts: { kind?: LedgerKind; actor?: string; limit?: number } = {}
): Promise<LedgerRow[]> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const filters = [
    opts.kind ? eq(ledger.kind, opts.kind) : undefined,
    opts.actor ? eq(ledger.actor, opts.actor) : undefined
  ];
  if (!query.trim())
    return db
      .select(ledgerColumns)
      .from(ledger)
      .where(and(...filters))
      .orderBy(desc(ledger.createdAt))
      .limit(limit);
  const v = await embed(query, 'query');
  if (v)
    return db
      .select(ledgerColumns)
      .from(ledger)
      .where(and(...filters, sql`${ledger.embedding} is not null`))
      .orderBy(cosineDistance(ledger.embedding, v))
      .limit(limit);
  return db
    .select(ledgerColumns)
    .from(ledger)
    .where(
      and(
        ...filters,
        sql`to_tsvector('english', ${ledger.title} || ' ' || ${ledger.body} || ' ' || coalesce(${ledger.reason}, '')) @@ websearch_to_tsquery('english', ${query})`
      )
    )
    .orderBy(desc(ledger.createdAt))
    .limit(limit);
}

/** The owner's past decisions closest to this text. */
export async function precedent(text: string, limit = 3): Promise<LedgerRow[]> {
  const v = await embed(text, 'query');
  if (!v) return searchLedger(text, { kind: 'decision', limit });
  return db
    .select(ledgerColumns)
    .from(ledger)
    .where(
      and(
        eq(ledger.kind, 'decision'),
        sql`${ledger.embedding} is not null`,
        sql`${cosineDistance(ledger.embedding, v)} < 0.35`
      )
    )
    .orderBy(cosineDistance(ledger.embedding, v))
    .limit(limit);
}
