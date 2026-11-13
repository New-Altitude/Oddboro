// Draws the window the Mac .dmg opens to: Oddboro's grass lot, with the app
// on the start side, Applications on the end side, and an arrow between. It
// writes two files that release.ts copies into every .dmg:
//
//   installer/background.tiff   the picture, at 1x and 2x
//   installer/DS_Store          Finder's layout: window size, icon places, the picture
//
// Only Finder writes a layout Finder trusts, so this script mounts a scratch
// disk named Oddboro, has Finder arrange it, and keeps the .DS_Store it
// writes. The layout finds the picture by its path on a disk of that name, so
// it works in every .dmg the release builds. Run it on a Mac after changing
// installer/lot.json or installer/arrow.px, and commit both files:
//
//   npm run installer -w @oddboro/desktop
//   npm run installer -w @oddboro/desktop -- --look   the picture only, icons marked, in out/
//
// The first run asks to let the terminal control Finder.
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSprites } from '@oddboro/sprites/load';
import { createImage, drawImage, encodePng, scaleImage, type Image } from '@oddboro/sprites/png';
import { parsePx, renderFrame, spriteMeta } from '@oddboro/sprites/px';
import {
  composeWorld,
  type FloorPlan,
  type RoomTemplate,
  type SpriteCatalog
} from '@oddboro/world';
import { cropImage, paintWorld } from '@oddboro/world/render';

const DESKTOP = fileURLToPath(new URL('..', import.meta.url));
const HERE = join(DESKTOP, 'installer');
const LOOK = process.argv.includes('--look');

// The window, in points. The art draws 2 points to a pixel, and 4 device
// pixels to a pixel on a Retina screen, so every edge stays sharp.
const WIDTH = 640;
const HEIGHT = 400;
const SCALE = 2;
// The picture runs a little past the window's foot, so a taller title bar
// never shows Finder's white below it.
const PICTURE_HEIGHT = 416;
const ICON = 128;
const APP = { name: 'Oddboro.app', at: [160, 176] };
const APPLICATIONS = { name: 'Applications', at: [480, 176] };
// The lot's top tile row sits above the window, so tree crowns run off its edge.
const TOP = 16;
const VOLUME = 'Oddboro';
// How far the window's foot sits above the bottom of the screen, in points.
const FOOT = 360;

/** The lot with the arrow on it, at one pixel per art pixel. */
function drawPicture(): Image {
  const { palette, sprites, errors } = loadSprites();
  if (errors.length) throw new Error(errors.join('\n'));
  const lot = JSON.parse(readFileSync(join(HERE, 'lot.json'), 'utf8')) as RoomTemplate;
  const catalog: SpriteCatalog = Object.fromEntries(
    [...sprites.values()].map((d) => [d.name, spriteMeta(d, palette)])
  );
  const plan: FloorPlan = {
    id: 'installer',
    name: lot.name,
    rooms: [{ room: lot.id, at: [0, 0] }]
  };
  const world = composeWorld(plan, { [lot.id]: lot }, catalog);
  const w = WIDTH / SCALE;
  const h = PICTURE_HEIGHT / SCALE;
  const picture = cropImage(paintWorld(world, sprites, palette), 0, TOP, w, h);
  if (picture.width !== w || picture.height !== h)
    throw new Error(`lot.json draws ${picture.width}x${picture.height}, not ${w}x${h}`);

  const file = join(HERE, 'arrow.px');
  const arrow = parsePx(readFileSync(file, 'utf8'), file, palette);
  const cx = (APP.at[0] + APPLICATIONS.at[0]) / 2 / SCALE;
  const cy = APP.at[1] / SCALE;
  drawImage(
    picture,
    renderFrame(arrow, arrow.frames[0], palette),
    Math.round(cx - arrow.width / 2),
    Math.round(cy - arrow.height / 2)
  );
  return picture;
}

/** Outlines where Finder puts each icon and its name, to check the art clears them. */
function markIcons(img: Image): void {
  const box = (x0: number, y0: number, x1: number, y1: number) => {
    for (let x = x0; x <= x1; x++)
      for (const y of [y0, y1]) img.data.set([255, 40, 220, 255], (y * img.width + x) * 4);
    for (let y = y0; y <= y1; y++)
      for (const x of [x0, x1]) img.data.set([255, 40, 220, 255], (y * img.width + x) * 4);
  };
  for (const { at } of [APP, APPLICATIONS]) {
    const [x, y] = at.map((v) => v / SCALE);
    const half = ICON / SCALE / 2;
    box(x - half, y - half, x + half, y + half);
    box(x - half, y + half + 2, x + half, y + half + 12);
  }
}

const picture = drawPicture();
if (LOOK) {
  const out = join(DESKTOP, 'out');
  mkdirSync(out, { recursive: true });
  markIcons(picture);
  writeFileSync(join(out, 'installer-look.png'), encodePng(scaleImage(picture, 4)));
  console.log(`Wrote ${join(out, 'installer-look.png')}`);
  process.exit(0);
}

const run = (cmd: string, args: string[]) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
// The layout keeps the scratch disk's path, so it lives at a fixed one that
// names no one.
const work = '/tmp/oddboro-installer';
rmSync(work, { recursive: true, force: true });
mkdirSync(work);
const mount = join('/Volumes', VOLUME);
if (existsSync(mount)) throw new Error(`Eject ${mount} first: Finder must lay out a fresh disk`);
try {
  // 1. The picture: a 1x and a 2x copy in one TIFF, which Finder picks between.
  const one = join(work, 'background.png');
  const two = join(work, 'background@2x.png');
  writeFileSync(one, encodePng(scaleImage(picture, SCALE)));
  writeFileSync(two, encodePng(scaleImage(picture, SCALE * 2)));
  run('tiffutil', ['-cathidpicheck', one, two, '-out', join(HERE, 'background.tiff')]);

  // 2. A scratch disk shaped like the release's: the app, Applications, the picture.
  const folder = join(work, 'disk');
  mkdirSync(join(folder, '.background'), { recursive: true });
  mkdirSync(join(folder, APP.name, 'Contents'), { recursive: true });
  symlinkSync('/Applications', join(folder, APPLICATIONS.name));
  copyFileSync(join(HERE, 'background.tiff'), join(folder, '.background', 'background.tiff'));
  const disk = join(work, 'layout.dmg');
  run('hdiutil', [
    'create',
    '-quiet',
    '-volname',
    VOLUME,
    '-srcfolder',
    folder,
    '-fs',
    'APFS',
    '-format',
    'UDRW',
    '-ov',
    disk
  ]);
  run('hdiutil', ['attach', '-quiet', '-noautoopen', disk]);

  // 3. Finder arranges it. The bounds are the window's frame, title bar
  //    included, from the top of the screen. Finder keeps them from the
  //    bottom of this Mac's main screen, so the window goes where it opens
  //    near the top of a laptop's: its foot 360 points up.
  const frame = HEIGHT + 28;
  const screen = Number(
    run('osascript', [
      '-l',
      'JavaScript',
      '-e',
      "ObjC.import('AppKit'); $.NSScreen.screens.objectAtIndex(0).frame.size.height"
    ])
  );
  const [x, y] = [200, screen - frame - FOOT];
  const place = ({ name, at }: { name: string; at: number[] }) =>
    `set position of item "${name}" of container window to {${at[0]}, ${at[1]}}`;
  run('osascript', [
    '-e',
    `tell application "Finder"
      tell disk "${VOLUME}"
        open
        set current view of container window to icon view
        set toolbar visible of container window to false
        set statusbar visible of container window to false
        set bounds of container window to {${x}, ${y}, ${x + WIDTH}, ${y + frame}}
        set opts to icon view options of container window
        set arrangement of opts to not arranged
        set icon size of opts to ${ICON}
        set text size of opts to 13
        set background picture of opts to file ".background:background.tiff"
        ${place(APP)}
        ${place(APPLICATIONS)}
        update without registering applications
        delay 1
        close
      end tell
    end tell`
  ]);

  // 4. Finder writes .DS_Store a moment after the window closes.
  const store = join(mount, '.DS_Store');
  const deadline = Date.now() + 20_000;
  let size = -1;
  for (;;) {
    const now = existsSync(store) ? statSync(store).size : -1;
    if (now > 0 && now === size) break;
    if (Date.now() > deadline) throw new Error('Finder never wrote the layout');
    size = now;
    execFileSync('sleep', ['1']);
  }
  const where = `{{${x}, ${FOOT}}, {${WIDTH}, ${frame}}}`;
  if (!readFileSync(store).includes(where))
    throw new Error(`Finder kept the window somewhere other than ${where}`);
  copyFileSync(store, join(HERE, 'DS_Store'));
  console.log(`Wrote ${join(HERE, 'background.tiff')} and ${join(HERE, 'DS_Store')}`);
} finally {
  if (existsSync(mount)) run('hdiutil', ['detach', '-quiet', mount]);
  rmSync(work, { recursive: true, force: true });
}
