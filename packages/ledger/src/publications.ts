import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from './db.ts';
import { publicationFollows as follows, publications as cards, staff } from './schema.ts';

export type PublicationMode = 'off' | 'chat' | 'desktop';
export type PublicationEvent = {
  sequence: number;
  slug: string;
  id: string;
  revision: number;
  action: 'published' | 'corrected' | 'withdrawn';
  kind: 'article' | 'video';
  title: string;
  url: string;
  publishedAt: string;
};
export type PublicationCard = Pick<
  typeof cards.$inferSelect,
  'id' | 'sourceId' | 'title' | 'url' | 'kind' | 'read' | 'withdrawn'
> & { publishedAt: string };
export async function followedPublications(account: string) {
  return db
    .select({
      staffId: follows.staffId,
      slug: sql<string>`${staff.package}->>'slug'`,
      mode: follows.mode,
      position: follows.position
    })
    .from(follows)
    .innerJoin(staff, eq(staff.id, follows.staffId))
    .where(
      and(
        eq(follows.account, account),
        isNull(staff.leftAt),
        sql`${staff.package}->>'quiet' IS NULL`
      )
    );
}
export async function setPublicationMode(
  staffId: string,
  account: string,
  mode: PublicationMode,
  head: number
) {
  await db.transaction(async (tx) => {
    const [who] = await tx.select().from(staff).where(eq(staff.id, staffId)).for('update');
    if (!who?.package || who.leftAt || (mode !== 'off' && who.package.quiet))
      throw new Error('This persona is not connected.');
    if (mode === 'off') {
      await tx
        .delete(follows)
        .where(and(eq(follows.staffId, staffId), eq(follows.account, account)));
      return;
    }
    await tx
      .insert(follows)
      .values({ staffId, account, position: String(head), mode })
      .onConflictDoUpdate({
        target: follows.staffId,
        set: {
          account,
          mode,
          position: sql`CASE WHEN ${follows.account}=${account} THEN ${follows.position} ELSE ${String(head)} END`
        }
      });
  });
}
export async function stopPublicationFollows(account: string) {
  await db.delete(follows).where(eq(follows.account, account));
}

/** A replay only affects a follow whose cursor is behind. An edit cannot create a card. */
export async function receivePublications(
  account: string,
  events: PublicationEvent[],
  through: number,
  slugs: readonly string[],
  eligible: () => boolean
) {
  return db.transaction(async (tx) => {
    const subs = await tx
      .select({ follow: follows, who: staff })
      .from(follows)
      .innerJoin(staff, eq(staff.id, follows.staffId))
      .where(eq(follows.account, account))
      .orderBy(asc(staff.id))
      .for('update');
    const alerts: { name: string; title: string }[] = [];
    if (!eligible()) return alerts;
    for (const { follow, who } of subs) {
      const slug = who.package?.slug;
      if (
        !slug ||
        !slugs.includes(slug) ||
        who.leftAt ||
        who.package?.quiet ||
        Number(follow.position) >= through
      )
        continue;
      for (const e of events) {
        if (e.sequence <= Number(follow.position) || e.slug !== slug) continue;
        const values = {
          title: e.title,
          url: e.url,
          kind: e.kind,
          publishedAt: new Date(e.publishedAt),
          revision: e.revision,
          withdrawn: e.action === 'withdrawn'
        };
        const key = and(eq(cards.account, account), eq(cards.slug, slug), eq(cards.sourceId, e.id));
        if (e.action === 'published') {
          const [added] = await tx
            .insert(cards)
            .values({ ...values, account, slug, sourceId: e.id, staffId: who.id })
            .onConflictDoNothing()
            .returning({ id: cards.id });
          if (added && follow.mode === 'desktop') alerts.push({ name: who.name, title: e.title });
        } else
          await tx
            .update(cards)
            .set(values)
            .where(and(key, sql`${cards.revision}<${e.revision}`));
      }
      await tx
        .update(follows)
        .set({ position: String(through) })
        .where(eq(follows.staffId, who.id));
    }
    if (!eligible()) throw new Error('The publication connection changed.');
    return alerts;
  });
}
export async function publicationLines(staffId: string) {
  const rows = await db.select().from(cards).where(eq(cards.staffId, staffId));
  return rows.map(
    ({ id, sourceId, title, url, kind, read, withdrawn, publishedAt, receivedAt }) => ({
      at: receivedAt.toISOString(),
      from: 'staff' as const,
      text: '',
      publication: {
        id,
        sourceId,
        title,
        url,
        kind,
        read,
        withdrawn,
        publishedAt: publishedAt.toISOString()
      }
    })
  );
}
export async function readPublications(staffId: string, ids: number[]) {
  if (ids.length)
    await db
      .update(cards)
      .set({ read: true })
      .where(and(eq(cards.staffId, staffId), eq(cards.read, false), inArray(cards.id, ids)));
}
export async function unreadPublications() {
  return db
    .select({ staffId: cards.staffId, count: sql<number>`count(*)::int` })
    .from(cards)
    .where(eq(cards.read, false))
    .groupBy(cards.staffId);
}
