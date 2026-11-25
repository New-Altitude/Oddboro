// Moving into a drawn office. The server checks the art and builds the spec
// again rather than trusting a copy from the page, keeps the layout and the art
// it drew, makes it the office, and moves any staffer whose room is gone. It
// saves over the layout the owner is in, so a change never adds a twin; only
// `'new'` adds another layout, and the sample is never written over. Every open
// page hears the change. The move-in route and the design job share this.
import { activeOffice, moveIn, roster, saveArt, saveOffice } from '@oddboro/ledger';
import { ART_LIMITS, artCatalog, type DrawnArt } from '@oddboro/sprites/art';
import { LIMITS, type OfficeSpec } from '@oddboro/world';
import { build, destination } from './office-design.ts';
import { artSprites, currentOffice, housePalette, officeLibrary } from './space.ts';

/** Where a move-in saves: a layout's id, `'new'` for another layout, or, left out, the layout the owner is in. */
export type Into = number | 'new';

export async function moveInto(
  spec: OfficeSpec,
  sent: DrawnArt[],
  description: string,
  into?: Into
) {
  const lib = await officeLibrary();
  const palette = housePalette();
  const sprites = artSprites(sent.slice(0, ART_LIMITS.office), (n) => n in lib.catalog, palette);
  const art = sent.filter((a) => sprites.some((d) => d.file === a.name));
  const catalog = { ...lib.catalog, ...artCatalog(sprites, palette) };
  const { office, problems } = build(spec, (await roster()).length, catalog);
  if (!office) throw new Error(problems.join('; '));
  const layout = into === 'new' ? undefined : (into ?? (await activeOffice())?.id);
  const row = await saveOffice(
    {
      description: description.slice(0, LIMITS.description),
      spec: office.spec,
      plan: office.plan,
      templates: office.templates,
      kinds: office.kinds
    },
    layout
  );
  await saveArt(art, row.id);
  const from = (await currentOffice()).id;
  const changed = layout !== undefined && row.id === layout;
  return moveIn(
    from,
    destination(row.id, row.name, office.world, office.kinds),
    changed ? `Changed ${row.name}` : undefined
  );
}
