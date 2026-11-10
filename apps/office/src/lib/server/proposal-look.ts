// A proposed local Odd can start with someone's artwork without installing
// their New Altitude persona, signing in as them, or changing the proposed job.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { drawnParts, lookTaken } from '@oddboro/ledger';
import {
  LOOKS_ROOT,
  loadLibrary,
  partsPortrait,
  type DrawnPart,
  type LookSpec
} from '@oddboro/sprites/look';
import { matchPersona, type PersonaHint } from '#lib/proposal-persona.ts';
import { preview, problemsWith, type Drawn } from './looks.ts';
import { readListing } from './persona.ts';
import { localArtwork } from './persona-package.ts';

const read = (file: string) => readFileSync(join(LOOKS_ROOT, 'personas', file), 'utf8');
const bundled = [
  { slug: 'nate', names: ['Nate B. Jones', 'Nate Jones'] },
  { slug: 'michele', names: ['Michele Harrison'] },
  { slug: 'sam', names: ['Sam Frank'] }
];
type Artwork = { look: LookSpec; parts: DrawnPart[]; portraitPx?: string };

async function artworkFor(p: PersonaHint): Promise<Artwork | undefined> {
  const local = matchPersona(p, bundled);
  const listing = await readListing();
  if (listing.state === 'ok') {
    const found = matchPersona(
      p,
      listing.listed.map((l) => ({
        slug: l.slug,
        names: [l.displayName, l.pkg.name],
        pkg: l.pkg
      }))
    );
    if (found) return found.pkg;
  }
  if (!local) return;
  if (local?.slug === 'nate') {
    return { look: JSON.parse(read('nate.json')), parts: [], portraitPx: read('nate.px') };
  }
  // The site's release art carries these two looks even when signed out.
  const archive: Record<string, Artwork> = JSON.parse(read('release-looks.json'));
  return archive[local.slug];
}

/** Keep package part names free for a later New Altitude install or update. */
export async function proposalLook(p: PersonaHint) {
  const art = await artworkFor(p);
  if (!art) return null;
  const { look, parts } = localArtwork(art);
  const stored = parts.length ? await drawnParts() : [];
  const newParts = parts.filter(
    (p) => !stored.some((s) => s.kind === p.kind && s.name === p.name && s.px === p.px)
  );
  const d: Drawn = {
    look,
    newParts,
    portraitPx: art.portraitPx ?? partsPortrait(loadLibrary(art.parts), art.look)
  };
  const problems = await problemsWith(d);
  if (!problems.length && art.parts.length && (await lookTaken(art.look))) {
    problems.push('Someone in the office already has this look.');
  }
  if (problems.length) return { problem: problems.join('; ') };
  return { look: await preview(d) };
}
