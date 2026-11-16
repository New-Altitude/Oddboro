// Produces the site's art from the office's own packages, so the hero shows
// a real office and the site build never touches the renderer. The office is
// the one in scripts/hero-office.json, built the way a new owner's is, by
// generateOffice from a spec.
//
//   node scripts/art.ts        writes static/art/*.png (night), static/art/day/*.png,
//                              static/art/releases/ (release-art.ts),
//                              src/lib/hero/scene.json and src/lib/vignettes.json
//
// The hero stacks the output: the lot, then the building's floors, walls and
// props unlit, then the whole scene lit, with the bus and the Odds on top.
// scene.json carries where everything is, in pixels of the crop. Every image
// that depends on the hour is rendered twice, at night (lamps on) and at
// midday (lamps off), and the page picks a set by theme. Portraits and walks
// are rendered once.
//
// The work is in five stage files that each import the one before: art-office.ts,
// art-layers.ts, art-vignettes.ts, art-render.ts and art-scene.ts. This file
// runs them.
import { readFileSync, writeFileSync } from 'node:fs';
import * as prettier from 'prettier';
import { join } from 'node:path';
import { renderFrame } from '@oddboro/sprites/px';
import { createImage, drawImage, encodePng, type Image } from '@oddboro/sprites/png';
import { shareCard } from './share.ts';
import { frameImage, palette, sprites } from './paint.ts';
import {
  loadLibrary,
  lookFrame,
  LOOKS_ROOT,
  portraitImage,
  type LookSpec
} from '@oddboro/sprites/look';
import { ROOT, write } from './art-office.ts';
import { V, vignettes } from './art-vignettes.ts';
import { config } from './art-scene.ts';

// The four Office Managers for the cards: a portrait each, and four frames of
// their walk, in daylight. Marshall's portrait is hand drawn in the main
// palette; the other three are drawn looks, painted the way the office paints
// them. Their looks are copied from packages/ledger/src/managers.ts, which the
// site build never loads, so keep scripts/manager-looks.json in step with it.
const lib = loadLibrary();
const looks = JSON.parse(
  readFileSync(join(ROOT, 'scripts', 'manager-looks.json'), 'utf8')
) as Record<string, LookSpec>;
const WALK = ['walk-down-0', 'walk-down-1', 'walk-down-2', 'walk-down-3'];

// Each manager's portrait also gets a blink frame, for the card's hover. No
// portrait is drawn with its eyes shut, so the frame is derived from the open
// one: every portrait draws each eye from the same six by three template, a
// lid line of ink over two rows of paper white (=) around the iris. The eyes
// are found as the two clusters of = that are four wide and two tall (a white
// collar is bigger), and each eye box is repainted as a closed lid: skin (f)
// where the white and the lid line were, with a lash line of ink (k) curving
// down, at the box's two ends on the middle row and across the four inner
// cells of the bottom row. The Odd portraits paint skin in their own
// letter, so they name it (Ada d, Theo b; Juno shares Marshall's f).
function blinkRows(rows: string[], who: string, skin = 'f'): string[] {
  const cells: [number, number][] = [];
  rows.forEach((r, y) => [...r].forEach((c, x) => c === '=' && cells.push([x, y])));
  const clusters: [number, number][][] = [];
  for (const cell of cells) {
    const near = clusters.find((cl) =>
      cl.some(([x, y]) => Math.abs(x - cell[0]) <= 2 && Math.abs(y - cell[1]) <= 2)
    );
    if (near) near.push(cell);
    else clusters.push([cell]);
  }
  const eyes = clusters
    .map((cl) => {
      const xs = cl.map(([x]) => x);
      const ys = cl.map(([, y]) => y);
      return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    })
    .filter((b) => b.x1 - b.x0 === 3 && b.y1 - b.y0 === 1);
  if (eyes.length !== 2) throw new Error(`portrait-${who}: found ${eyes.length} eyes, not 2`);
  const grid = rows.map((r) => [...r]);
  for (const { x0, x1, y0, y1 } of eyes) {
    for (let x = x0; x <= x1; x++) {
      grid[y0 - 1][x] = skin;
      grid[y0][x] = skin;
      grid[y1][x] = 'k';
    }
    for (const x of [x0 - 1, x1 + 1]) {
      grid[y0 - 1][x] = skin;
      grid[y0][x] = 'k';
    }
  }
  return grid.map((r) => r.join(''));
}
/** The same portrait .px with its default frame's eyes shut. */
function blinkPx(px: string, who: string): string {
  const lines = px.split('\n');
  const at = lines.findIndex((l) => l.trim() === 'frame default') + 1;
  lines.splice(at, 48, ...blinkRows(lines.slice(at, at + 48), who));
  return lines.join('\n');
}

for (const who of ['marshall', 'ada', 'theo', 'juno'])
  write(`portrait-${who}.png`, frameImage(sprites.get(`portrait-${who}`)!, 'default'));
{
  const def = sprites.get('portrait-marshall')!;
  const f = def.frames.find((x) => x.name === 'default')!;
  write(
    'portrait-marshall-blink.png',
    renderFrame(def, { ...f, rows: blinkRows(f.rows, 'marshall') }, palette)
  );
}
// Marshall pointing, for the build /releases/ picks for this computer: his
// side frame from the staff sprite, facing right, with the near arm raised
// straight out from the shoulder in place of hanging at his side.
{
  const def = sprites.get('staff')!;
  const f = def.frames.find((x) => x.name === 'idle-side-0')!;
  const arm = [
    '.....kzzzzzk....',
    '....kzzzzzzzkkk.',
    '....kzzzzzzzzzfk',
    '....kzzzzzzzkkk.',
    '....kzzzzzZzk...',
    '....kZzzzzZzk...',
    '....kZZzzZZZk...',
    '....kZZZZZZZk...',
    '....kkkkkkkkk...'
  ];
  const rows = [...f.rows.slice(0, 15), ...arm, ...f.rows.slice(15 + arm.length)];
  const marshall = def.variants.find((v) => v.name === 'marshall')!.map;
  write('point-marshall.png', renderFrame(def, { ...f, rows }, palette, marshall));
}
// The Odds blink too, in Access's mock tab (Juno) and on Hire's job card.
for (const [who, skin] of [
  ['ada', 'd'],
  ['theo', 'b'],
  ['juno', 'f']
]) {
  const def = sprites.get(`portrait-${who}`)!;
  const f = def.frames.find((x) => x.name === 'default')!;
  write(
    `portrait-${who}-blink.png`,
    renderFrame(def, { ...f, rows: blinkRows(f.rows, who, skin) }, palette)
  );
}
// Each manager's walk, kept for the link preview below.
const walks = new Map<string, Image>();
{
  const staffDef = sprites.get('staff')!;
  const strip = createImage(WALK.length * staffDef.width, staffDef.height);
  WALK.forEach((f, i) => drawImage(strip, frameImage(staffDef, f, 'marshall'), i * 16, 0));
  write('walk-marshall.png', strip);
  walks.set('marshall', strip);
}
for (const [id, look] of Object.entries(looks)) {
  const px = readFileSync(join(LOOKS_ROOT, 'managers', `${id}.px`), 'utf8');
  write(`portrait-${id}.png`, portraitImage(lib, look, px));
  write(`portrait-${id}-blink.png`, portraitImage(lib, look, blinkPx(px, id)));
  const strip = createImage(WALK.length * 16, 32);
  WALK.forEach((f, i) => drawImage(strip, lookFrame(lib, look, f), i * 16, 0));
  write(`walk-${id}.png`, strip);
  walks.set(id, strip);
}

// The link preview every page shows unless it names its own. It sits beside
// the favicon, not in art/.
writeFileSync(join(ROOT, 'static', 'share.png'), encodePng(shareCard(walks)));
console.log('static/share.png 1200x630');

const vFile = join(ROOT, 'src', 'lib', 'vignettes.json');
writeFileSync(
  vFile,
  await prettier.format(
    JSON.stringify({
      w: V.w,
      h: V.h,
      items: vignettes.map((v) => ({
        id: v.id,
        name: v.staff.name,
        staff: v.at,
        head: v.head,
        frame: v.frame,
        // The card's animation: the Odd's strip, and the prop's when there is one.
        staffAnim: { frames: v.frames.length, fps: v.fps },
        ...(v.animProp && {
          propAnim: {
            sprite: v.animProp.d.sprite,
            frames: v.animProp.frames.length,
            fps: v.animProp.fps
          }
        }),
        ...(v.dust && { dust: true })
      }))
    }),
    { ...config, parser: 'json', filepath: vFile }
  )
);
console.log(`src/lib/vignettes.json: ${vignettes.length} vignettes`);
