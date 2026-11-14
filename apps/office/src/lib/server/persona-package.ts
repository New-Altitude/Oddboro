// A persona's Odd package as New Altitude serves it, checked before the office
// trusts it: its shape here, then the same look checks a drawn look passes.
import {
  checkPart,
  checkSpec,
  parsePortrait,
  PART_KINDS,
  type DrawnPart
} from '@oddboro/sprites/look';
import { lookTaken, personaParts, type OddPackage } from '@oddboro/ledger';
import { LIMITS } from '#lib/staff/roster.ts';
import { library } from './looks.ts';

/** A slug becomes a secret id and a URL path, so it is kept to these characters. */
export const isSlug = (slug: string) => /^[a-z0-9-]{1,64}$/.test(slug);
/** The hire route's limits (`LIMITS`), so a package Odd fits where any Odd does, and the hello's. */
const MAX = { ...LIMITS, hello: 2_000 } as const;
/** The persona's own name, as New Altitude lists it. */
const DISPLAY_NAME_MAX = 60;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown, max: number, empty = false): v is string =>
  typeof v === 'string' && v.length <= max && (empty || v.trim().length > 0);
/**
 * One line of plain text within `max`. The Odd's name and the persona's go
 * into its hands' job description (`personaDesk`), so neither may carry a
 * line break or a control character that would start text of its own there.
 */
const isLine = (v: unknown, max: number): v is string =>
  isText(v, max) && !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(v);

/** `raw` as a package for `slug`, or the reason it is not one. */
export function readPackage(slug: string, raw: unknown): OddPackage | string {
  if (!isSlug(slug)) return 'its name is not a slug';
  if (!isObject(raw)) return 'it is not an object';
  if (raw.format !== 1) return `it is format ${String(raw.format)}, and this office reads format 1`;
  if (!Number.isInteger(raw.version) || (raw.version as number) < 1)
    return 'its version is not a positive whole number';
  if (!isLine(raw.name, MAX.name))
    return `its name is empty, over ${MAX.name} characters or more than one line`;
  if (!isText(raw.role, MAX.role, true)) return `its role is over ${MAX.role} characters`;
  if (!isText(raw.remit, MAX.remit, true)) return `its remit is over ${MAX.remit} characters`;
  if (!isText(raw.hello, MAX.hello, true)) return `its hello is over ${MAX.hello} characters`;
  if (typeof raw.portraitPx !== 'string') return 'its portrait is not text';
  if (!isObject(raw.look)) return 'its look is not an object';
  if (!Array.isArray(raw.parts)) return 'its parts are not a list';
  const parts: DrawnPart[] = [];
  for (const p of raw.parts as unknown[]) {
    if (!isObject(p) || typeof p.name !== 'string' || typeof p.px !== 'string')
      return 'a part is not a kind, a name and its drawing';
    const kind = PART_KINDS.find((k) => k === p.kind);
    if (!kind) return `the part ${p.name} is not a hair, top or bottom`;
    if (!p.name.startsWith(`${slug}-`)) return `the part ${p.name} is not named after ${slug}`;
    parts.push({ kind, name: p.name, px: p.px });
  }
  return {
    format: 1,
    version: raw.version as number,
    name: raw.name,
    role: raw.role,
    remit: raw.remit,
    hello: raw.hello,
    // checkSpec in packageProblems checks every key of the look before it is used.
    look: raw.look as OddPackage['look'],
    portraitPx: raw.portraitPx,
    parts
  };
}

/** One persona New Altitude lists with an Odd, as `/api/personas/odds` sends it, checked. */
export type Listed = {
  publications?: true;
  slug: string;
  displayName: string;
  jobTitle: string | null;
  /** New Altitude's one sentence saying this is an AI persona, shown verbatim. */
  disclosure: string;
  pkg: OddPackage;
};

/** One entry of `/api/personas/odds`, or the reason it is not one. */
export function readListed(raw: unknown): Listed | string {
  if (!isObject(raw) || typeof raw.slug !== 'string') return 'it has no slug';
  const { slug, displayName, jobTitle, disclosure } = raw;
  if (typeof disclosure !== 'string' || !disclosure.trim()) return `${slug} has no disclosure`;
  if (!isLine(displayName, DISPLAY_NAME_MAX))
    return `${slug}'s name is empty, over ${DISPLAY_NAME_MAX} characters or more than one line`;
  if (jobTitle !== null && typeof jobTitle !== 'string') return `${slug}'s job title is not text`;
  const pkg = readPackage(slug, raw.odd);
  if (typeof pkg === 'string') return `${slug}'s package: ${pkg}`;
  return {
    slug,
    displayName,
    jobTitle,
    disclosure,
    pkg,
    ...(raw.publications === 1 ? { publications: true as const } : {})
  };
}

/**
 * Everything wrong with a listed package's look, in words; empty when it is
 * good. The checks of `problemsWith` in looks.ts, with one rule different: a
 * part already in the library is allowed when it was drawn for an Odd of this
 * persona, since it is this package's older version. Any other stored or
 * built-in part keeps its drawing, as `problemsWith` keeps every one, so a
 * package never redraws a part another Odd wears. `checkPart` makes each
 * drawing carry its part's own name, so the name is the part it replaces.
 * `staffId` is the persona's Odd on an update, so its own look is no twin.
 */
export async function packageProblems(
  listed: Pick<Listed, 'slug' | 'pkg'>,
  staffId?: string
): Promise<string[]> {
  const { pkg } = listed;
  const problems: string[] = [];
  const base = await library();
  const own = await personaParts(listed.slug);
  for (const p of pkg.parts) {
    if (base.parts.has(`${p.kind}:${p.name}`) && !own.has(`${p.kind}:${p.name}`)) {
      problems.push(`a ${p.kind} named "${p.name}" is already in the library`);
      continue;
    }
    try {
      checkPart(base, p);
    } catch (e) {
      problems.push(`the ${p.kind} "${p.name}": ${e instanceof Error ? e.message : e}`);
    }
  }
  const lib = await library(pkg.parts);
  problems.push(...checkSpec(lib, pkg.look));
  try {
    parsePortrait(lib, pkg.portraitPx);
  } catch (e) {
    problems.push(`the portrait: ${e instanceof Error ? e.message : e}`);
  }
  if (!problems.length) {
    const twin = await lookTaken(pkg.look, staffId);
    if (twin) problems.push(`${twin.name} already looks exactly like that`);
  }
  return problems;
}
