// Draws Oddboro's mark, the glowing pixel O, and writes every file that shows it:
//
//   apps/site/static/logo.png             the site's favicon, header and footer
//   apps/office/static/logo.png           the office's favicon
//   apps/desktop/branding/google-oauth-logo.png   the logo on Google's sign-in screen
//   apps/desktop/src-tauri/icons/         the app's icons, and the menu bar's template
//
// Every size draws the grid below with whole pixels, so no edge blurs. Run it on
// a Mac (iconutil makes the .icns): npm run mark -w @oddboro/sprites
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createImage, encodePng, type Image } from '../src/png.ts';
import { hexToRgba } from '../src/px.ts';

const ROOT = new URL('../../../', import.meta.url).pathname;
const palette: Record<string, { hex: string }> = JSON.parse(
  readFileSync(new URL('../src/palette.json', import.meta.url), 'utf8')
).colors;

// The letter in screen aqua with a glow aqua edge, one ring of teal deep glow
// around it. `.` is the black it sits on, the middle of the O too.
const MARK = [
  '..dddddd..',
  '.ddhhhhdd.',
  'ddhllllhdd',
  'dhlddddhhd',
  'dhld..dhld',
  'dhld..dhld',
  'dhld..dhld',
  'dhld..dhld',
  'dhld..dhld',
  'dhld..dhld',
  'dhlddddhld',
  'ddhhhhhldd',
  '.ddhllldd.',
  '..dddddd..'
];
const W = MARK[0].length;
const H = MARK.length;
const BLACK = [0, 0, 0, 255];
const COLOUR: Record<string, number[]> = {
  d: hexToRgba(palette['6'].hex),
  l: hexToRgba(palette['G'].hex),
  h: hexToRgba(palette['g'].hex),
  '.': BLACK
};

function put(img: Image, x: number, y: number, rgba: readonly number[]): void {
  if (x >= 0 && y >= 0 && x < img.width && y < img.height)
    img.data.set(rgba, (y * img.width + x) * 4);
}

/** The mark at `cell` pixels per grid square, centred. `colour` gives each role its colour, or null to leave it out. */
function drawMark(
  img: Image,
  cell: number,
  colour: (role: string) => readonly number[] | null
): void {
  const ox = Math.floor((img.width - W * cell) / 2);
  const oy = Math.floor((img.height - H * cell) / 2);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const rgba = colour(MARK[y][x]);
      if (!rgba) continue;
      for (let j = 0; j < cell; j++)
        for (let i = 0; i < cell; i++) put(img, ox + x * cell + i, oy + y * cell + j, rgba);
    }
}

/** The mark on black to the edges, sized so it stays inside a circle crop. */
function square(size: number, cell: number): Image {
  const img = createImage(size, size);
  for (let i = 0; i < size * size; i++) img.data.set(BLACK, i * 4);
  drawMark(img, cell, (r) => COLOUR[r]);
  return img;
}

/**
 * The app icon: a black rounded square on Apple's grid (824 of 1024, inset 100),
 * the mark as large as fits three quarters of its height. Below 24 px the square
 * fills the canvas, or the mark would not fit at one pixel per square.
 */
function appIcon(size: number): Image {
  let inset = (size * 100) / 1024;
  let tile = size - 2 * inset;
  let cell = Math.floor((tile * 0.75) / H);
  if (cell < 1) {
    inset = 0;
    tile = size;
    cell = 1;
  }
  const radius = tile * 0.2237;
  const img = createImage(size, size);
  const inside = (px: number, py: number): boolean => {
    const x = Math.min(Math.max(px, inset + radius), inset + tile - radius);
    const y = Math.min(Math.max(py, inset + radius), inset + tile - radius);
    return (px - x) ** 2 + (py - y) ** 2 <= radius ** 2;
  };
  // Four by four samples per pixel give the square's corners a smooth edge.
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let j = 0; j < 4; j++)
        for (let i = 0; i < 4; i++) if (inside(x + (i + 0.5) / 4, y + (j + 0.5) / 4)) hits++;
      if (hits) put(img, x, y, [0, 0, 0, Math.round((hits / 16) * 255)]);
    }
  drawMark(img, cell, (r) => COLOUR[r]);
  return img;
}

/** The menu bar's template image: the letter alone in black, which macOS tints. */
function tray(): Image {
  const img = createImage(44, 44);
  drawMark(img, 3, (r) => (r === 'h' || r === 'l' ? BLACK : null));
  return img;
}

/** A Windows .ico holding one PNG per size. */
function ico(images: Image[]): Uint8Array {
  const pngs = images.map((img) => encodePng(img));
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach((png, i) => {
    const e = 6 + 16 * i;
    const side = images[i].width >= 256 ? 0 : images[i].width;
    head.writeUInt8(side, e);
    head.writeUInt8(side, e + 1);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...pngs]);
}

/** A Mac .icns, through Apple's iconutil. */
function icns(out: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'oddboro-mark-'));
  const set = join(dir, 'icon.iconset');
  mkdirSync(set);
  for (const pt of [16, 32, 128, 256, 512]) {
    writeFileSync(join(set, `icon_${pt}x${pt}.png`), encodePng(appIcon(pt)));
    writeFileSync(join(set, `icon_${pt}x${pt}@2x.png`), encodePng(appIcon(pt * 2)));
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', out]);
  rmSync(dir, { recursive: true });
}

function write(path: string, bytes: Uint8Array): void {
  mkdirSync(join(ROOT, path, '..'), { recursive: true });
  writeFileSync(join(ROOT, path), bytes);
  console.log(path);
}

if (process.platform !== 'darwin')
  throw new Error('Run this on a Mac: it needs iconutil for the .icns.');

const logo = encodePng(square(256, 14));
write('apps/site/static/logo.png', logo);
write('apps/office/static/logo.png', logo);
// Google asks for a square 120 by 120 logo, under 1 MB.
write('apps/desktop/branding/google-oauth-logo.png', encodePng(square(120, 6)));

const icons = 'apps/desktop/src-tauri/icons';
write(`${icons}/32x32.png`, encodePng(appIcon(32)));
write(`${icons}/128x128.png`, encodePng(appIcon(128)));
write(`${icons}/128x128@2x.png`, encodePng(appIcon(256)));
write(`${icons}/icon.png`, encodePng(appIcon(512)));
write(`${icons}/tray.png`, encodePng(tray()));
write(`${icons}/icon.ico`, ico([16, 24, 32, 48, 64, 256].map(appIcon)));
icns(join(ROOT, icons, 'icon.icns'));
console.log(`${icons}/icon.icns`);
