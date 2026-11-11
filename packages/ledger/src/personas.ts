// An Odd installed from a New Altitude persona. Its package (name, look,
// portrait, parts, role, remit, hello) comes from New Altitude and is the same
// in every office, so nothing is drawn for it. Its own coding tool does the
// work, as its hands, and the persona answers in its own voice. The office
// app checks a package before it reaches here (persona-package.ts).
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DrawnPart, LookSpec } from '@oddboro/sprites/look';
import { db } from './db.ts';
import { fixedError } from './errors.ts';
import { HIRE_DEFAULTS } from './grantable.ts';
import { hire, ownerName, record, roster, staffer, type StaffRow } from './office.ts';
import {
  followUps,
  grants,
  jobs,
  parts,
  personaRequests,
  personaRevisions,
  projectRequests,
  projectSessions,
  runs,
  staff
} from './schema.ts';

/**
 * Why a persona Odd stays quiet: New Altitude stopped offering it (`access`),
 * its own sign-in ended (`grant`), or the owner signed out (`signed-out`).
 */
export type Quiet = 'access' | 'grant' | 'signed-out';

/** What the office keeps about where a persona Odd came from, in `staff.package`. */
export type PersonaLink = {
  slug: string;
  version: number;
  /** New Altitude's one sentence saying this is an AI persona, shown verbatim. */
  disclosure: string;
  quiet?: Quiet;
};

/** Oddboro's own declaration of New Altitude's package format 1. */
export type OddPackage = {
  format: 1;
  version: number;
  name: string;
  role: string;
  remit: string;
  /** The first chat message. `{owner}` becomes the owner's name. */
  hello: string;
  look: LookSpec;
  portraitPx: string;
  /** Parts the look draws with, each named `<slug>-<name>`. */
  parts: DrawnPart[];
};

/**
 * The job description of every persona Odd's hands. The persona's own words
 * stay on New Altitude, so this holds nothing from the package but the name.
 */
export const personaDesk = (name: string, displayName: string, owner: string) => `# ${name}'s hands

You do the office work for ${name}, an Odd in ${owner}'s office. ${name} is
${displayName}'s persona on New Altitude: after you finish, your report goes to
${name}, who answers in their own voice. You are an Odd's hands, not its voice.

1. Start your report with one line saying what was asked.
2. Look things up, read files, and use your office tools as the request needs,
   at your level, like any Odd.
3. Give no opinion, advice or recommendation of your own: ${name} gives those.
4. If the request only wants ${name}'s view and needs nothing looked up or done,
   reply "Nothing to look up." and the line that says what was asked.
5. Keep the report under 2,500 characters: facts, what you did, file paths.
`;

/** The current Odd installed from `slug`, if any. */
export async function personaOdd(slug: string): Promise<StaffRow | undefined> {
  return (await roster()).find((s) => s.package?.slug === slug);
}

/**
 * The `kind:name` of each part drawn for an Odd of the persona `slug`, in the
 * office now or let go: the only stored parts its package may replace.
 */
export async function personaParts(slug: string): Promise<Set<string>> {
  const rows = await db
    .select({ kind: parts.kind, name: parts.name })
    .from(parts)
    .innerJoin(staff, eq(parts.drawnFor, staff.id))
    .where(sql`${staff.package}->>'slug' = ${slug}`);
  return new Set(rows.map((r) => `${r.kind}:${r.name}`));
}

/**
 * Hire a persona from its checked package, with no drawing: the package's look,
 * portrait and parts, at its level and tools in `HIRE_DEFAULTS`, on the
 * office's own tool. Refuses a persona already in the office.
 */
export async function hirePersona(p: {
  slug: string;
  pkg: OddPackage;
  disclosure: string;
  displayName: string;
}): Promise<StaffRow> {
  const { slug, pkg, disclosure } = p;
  if (await personaOdd(slug)) throw new Error(`${pkg.name} already works in your office.`);
  return hire({
    name: pkg.name,
    role: pkg.role,
    remit: pkg.remit,
    desk: personaDesk(pkg.name, p.displayName, await ownerName()),
    room: 'workspace',
    ...HIRE_DEFAULTS.persona,
    variant: 'look',
    portrait: 'look',
    look: pkg.look,
    portraitPx: pkg.portraitPx,
    newParts: pkg.parts,
    package: { slug, version: pkg.version, disclosure }
  });
}

/**
 * Bring a persona Odd to a newer package: its parts, name, role, remit, look
 * and portrait become the package's. The hello is not said again.
 */
export async function updatePersona(
  id: string,
  pkg: OddPackage,
  disclosure: string
): Promise<void> {
  const who = await staffer(id);
  if (!who?.package) throw fixedError('No such persona Odd');
  const link: PersonaLink = { ...who.package, version: pkg.version, disclosure };
  await db.transaction(async (tx) => {
    for (const part of pkg.parts)
      await tx
        .insert(parts)
        .values({ ...part, drawnFor: id })
        .onConflictDoUpdate({ target: [parts.kind, parts.name], set: { px: part.px } });
    await tx
      .update(staff)
      .set({
        name: pkg.name,
        role: pkg.role,
        remit: pkg.remit,
        look: pkg.look,
        portraitPx: pkg.portraitPx,
        package: link
      })
      .where(eq(staff.id, id));
    await record(
      { kind: 'work', actor: 'office', title: `Updated ${pkg.name} from New Altitude` },
      tx
    );
  });
}

/** Make a persona Odd quiet for `quiet`, or speak again with none. The whole link is written back. */
export async function setQuiet(id: string, quiet: Quiet | undefined): Promise<void> {
  const who = await staffer(id);
  if (!who?.package) return;
  const { slug, version, disclosure } = who.package;
  const link: PersonaLink = quiet
    ? { slug, version, disclosure, quiet }
    : { slug, version, disclosure };
  await db.update(staff).set({ package: link }).where(eq(staff.id, id));
}

/** Convert only the exact ordinary Odd the owner mapped. Its id and files stay. */
export async function convertPersona(
  id: string,
  p: { slug: string; pkg: OddPackage; disclosure: string; displayName: string; requestId: string }
): Promise<StaffRow> {
  const owner = await ownerName();
  return db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(personaRequests)
      .where(eq(personaRequests.id, p.requestId))
      .for('update');
    if (request?.state !== 'approved' || request.staffId !== id || request.slug !== p.slug)
      throw new Error('This conversion is no longer approved.');
    const [who] = await tx.select().from(staff).where(eq(staff.id, id)).for('update');
    if (!who || who.leftAt || who.package)
      throw new Error('Choose an ordinary Odd still in the office.');
    const [existing] = await tx
      .select()
      .from(staff)
      .where(sql`${staff.package}->>'slug' = ${p.slug} AND ${staff.leftAt} IS NULL`);
    if (existing)
      throw new Error(
        'This persona already has an Odd. Keep this Odd and use the installed persona.'
      );
    const waiting = await tx
      .select()
      .from(followUps)
      .where(and(eq(followUps.staffId, id), isNull(followUps.doneAt)));
    const working = await tx
      .select()
      .from(runs)
      .innerJoin(jobs, eq(runs.jobId, jobs.id))
      .where(and(eq(jobs.staffId, id), eq(runs.status, 'running')));
    if (waiting.length || working.length)
      throw new Error("Finish or stop this Odd's pending work before changing its instructions.");
    const activeProjects = await tx
      .select()
      .from(projectRequests)
      .where(
        and(
          eq(projectRequests.staffId, id),
          inArray(projectRequests.state, ['sending', 'working', 'uncertain'])
        )
      );
    if (activeProjects.length)
      throw new Error(
        "Resolve this Odd's active or uncertain project work before changing its instructions."
      );
    const oldGrants = await tx.select().from(grants).where(eq(grants.staffId, id));
    const oldSessions = await tx
      .select()
      .from(projectSessions)
      .where(eq(projectSessions.staffId, id));
    await tx.insert(personaRevisions).values({
      staffId: id,
      slug: p.slug,
      previous: { staff: who, grants: oldGrants, projects: oldSessions }
    });
    await tx.delete(grants).where(eq(grants.staffId, id));
    for (const session of oldSessions) {
      await tx
        .update(projectRequests)
        .set({ state: 'stopped', answer: 'Access ended when this Odd became a persona.' })
        .where(
          and(
            eq(projectRequests.sessionId, session.id),
            inArray(projectRequests.state, ['proposed', 'queued', 'authorized'])
          )
        );
    }
    await tx.update(projectSessions).set({ staffId: null }).where(eq(projectSessions.staffId, id));
    await tx
      .update(jobs)
      .set({ enabled: false, changedAt: new Date() })
      .where(eq(jobs.staffId, id));
    for (const part of p.pkg.parts)
      await tx
        .insert(parts)
        .values({ ...part, drawnFor: id })
        .onConflictDoUpdate({ target: [parts.kind, parts.name], set: { px: part.px } });
    const [updated] = await tx
      .update(staff)
      .set({
        name: p.pkg.name,
        role: p.pkg.role,
        remit: p.pkg.remit,
        desk: personaDesk(p.pkg.name, p.displayName, owner),
        ...HIRE_DEFAULTS.persona,
        commands: false,
        web: false,
        folders: [],
        account: null,
        model: null,
        effort: null,
        look: p.pkg.look,
        portraitPx: p.pkg.portraitPx,
        variant: 'look',
        portrait: 'look',
        package: { slug: p.slug, version: p.pkg.version, disclosure: p.disclosure }
      })
      .where(eq(staff.id, id))
      .returning();
    await record(
      {
        kind: 'work',
        actor: 'owner',
        title: `Connected ${p.pkg.name} to its New Altitude persona`,
        body: 'The same Odd keeps its history and files. Previous instructions and grants are retained in its revision. Jobs are paused and access must be granted again.'
      },
      tx
    );
    return updated;
  });
}

export const personaRevisionsFor = (id: string) =>
  db.select().from(personaRevisions).where(eq(personaRevisions.staffId, id));
