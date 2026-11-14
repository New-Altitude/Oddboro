// An Odd installed from a New Altitude persona. Its package (name, look,
// portrait, parts, role, remit, hello) comes from New Altitude and is the same
// in every office, so nothing is drawn for it. Its own coding tool does the
// work, as its hands, and the persona answers in its own voice. The office
// app checks a package before it reaches here (persona-package.ts).
import { eq, sql } from 'drizzle-orm';
import type { DrawnPart, LookSpec } from '@oddboro/sprites/look';
import { db } from './db.ts';
import { fixedError } from './errors.ts';
import { HIRE_DEFAULTS } from './grantable.ts';
import { hire, ownerName, record, roster, staffer, type StaffRow } from './office.ts';
import { parts, staff, publicationFollows } from './schema.ts';

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
  await db.transaction(async (tx) => {
    await tx.update(staff).set({ package: link }).where(eq(staff.id, id));
    if (quiet) await tx.delete(publicationFollows).where(eq(publicationFollows.staffId, id));
  });
}
