// 0.0.9's animation: the New Altitude personas walk out of the smoke in gold shades.
import { createImage, drawImage, type Image } from '@oddboro/sprites/png';
import { hexToRgba } from '@oddboro/sprites/px';
import { type GifFrame } from './gif.ts';
import type { Persona, EntranceLayers } from './release-art.ts';
import { PALETTE, type Point, sprite, DELAY } from './release-art-kit.ts';

// Big square shades in thick gold frames, wider than the face, worn over each
// persona's own eyes: black lenses with a grey glint, which flashes white when
// they strike their pose. Facing you they sit on rows 9 to 12 of the sprite,
// clear of the mouth; side on, on the near side of the face.
const SHADES: Record<'down' | 'side', { top: number; rows: string[] }> = {
  down: {
    top: 9,
    rows: [
      '..YYYYY..YYYYY..', //
      '..YkkMYYYYkkMY..',
      '..YkkkY..YkkkY..',
      '...YYY....YYY...'
    ]
  },
  side: {
    top: 9,
    rows: [
      '........YYYYY...', //
      '......YYYkkMY...',
      '........YkkkY...',
      '.........YYY....'
    ]
  }
};
const shadesFor = (dir: 'down' | 'side', glint: boolean) =>
  sprite(SHADES[dir].rows.map((r) => (glint ? r.replaceAll('M', '=') : r)));

/** One puff of smoke: where its middle is, how big it is and will get, and where it drifts. */
type Puff = { x: number; y: number; r: number; max: number; vx: number; vy: number };

function personas({ room, view, door, odd, head, shade }: EntranceLayers): GifFrame[] {
  const frames: GifFrame[] = [];
  const everyone: Persona[] = ['michele', 'nate', 'sam'];
  /** Which of the lobby's lit images shows: 0 shut to 4 open. */
  let doors = 0;
  // Where each persona's sprite stands, the frame it shows, whether it faces
  // left, and its shades: how many rows they have slipped down the nose, or
  // null once they are off. They start in the doorway, hidden by the smoke.
  const sill = door.y + door.h - 32;
  const at = (x: number, y: number) => ({
    x,
    y,
    pose: 'idle-down-0',
    flip: false,
    glint: false,
    shades: 0 as number | null
  });
  const cast: Record<Persona, ReturnType<typeof at>> = {
    michele: at(door.x + 4, sill + 4),
    nate: at(door.x + 8, sill + 6),
    sam: at(door.x + 12, sill + 4)
  };
  // Front to back as they stand: whoever is further down the view is drawn last.
  const order = () => [...everyone].sort((a, b) => cast[a].y - cast[b].y);
  let shown = false;

  // The camera: how far it has zoomed in, and the point it centres on.
  const cam = { z: 1, cx: view.w / 2, cy: view.h / 2 };
  /** The part of the view the camera shows, in the view's pixels. */
  const frameOf = () => {
    const w = view.w / cam.z;
    const h = view.h / cam.z;
    const x = Math.max(0, Math.min(view.w - w, cam.cx - w / 2));
    const y = Math.max(0, Math.min(view.h - h, cam.cy - h / 2));
    return { x, y, w, h };
  };
  /** The view through the camera, each pixel the one under it, so pixels stay hard. */
  const zoom = (img: Image) => {
    if (cam.z === 1) return img;
    const f = frameOf();
    const out = createImage(view.w, view.h);
    for (let y = 0; y < view.h; y++)
      for (let x = 0; x < view.w; x++) {
        const sx = Math.min(view.w - 1, Math.floor(f.x + x / cam.z));
        const sy = Math.min(view.h - 1, Math.floor(f.y + y / cam.z));
        const i = (sy * view.w + sx) * 4;
        out.data.set(img.data.subarray(i, i + 4), (y * view.w + x) * 4);
      }
    return out;
  };

  // The smoke: puffs born in the doorway that swell as they roll into the
  // lobby, then thin away. A fixed seed, so every build draws the same smoke.
  const puffs: Puff[] = [];
  let seed = 9;
  const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) % 10000) / 10000;
  const puff = () =>
    puffs.push({
      x: door.x + 5 + rand() * (door.w - 10),
      y: door.y + 4 + rand() * (door.h - 8),
      r: 2 + rand() * 2,
      max: 7 + rand() * 8,
      vx: (rand() - 0.5) * 3.4,
      vy: 0.3 + rand() * 0.7
    });
  /** Move the smoke a frame: puffs drift and swell, or shrink when it clears. */
  const drift = (clearing: boolean) => {
    for (const p of puffs) {
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.94;
      p.vy *= 0.95;
      p.r = clearing ? p.r - 0.45 : Math.min(p.max, p.r + 0.5);
    }
    for (let i = puffs.length - 1; i >= 0; i--) if (puffs[i].r <= 0.5) puffs.splice(i, 1);
  };
  /**
   * The smoke as one lit layer: a white core, a pale grey ring, and a
   * dithered edge, all a little see-through, so whoever walks in it shows
   * through faintly.
   */
  const SMOKE = { core: 0.85, ring: 0.8, edge: 0.6 };
  const smoke = () => {
    const img = createImage(view.w, view.h);
    const tone = (key: string, a: number) => {
      const c = hexToRgba(PALETTE[key].hex);
      c[3] = Math.round(255 * a);
      return c;
    };
    const core = tone('=', SMOKE.core);
    const ring = tone('a', SMOKE.ring);
    const edge = tone('A', SMOKE.edge);
    for (const p of [...puffs].sort((a, b) => a.y - b.y)) {
      const r = p.r;
      for (let y = Math.max(0, Math.floor(p.y - r)); y <= Math.min(view.h - 1, p.y + r); y++)
        for (let x = Math.max(0, Math.floor(p.x - r)); x <= Math.min(view.w - 1, p.x + r); x++) {
          const d = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) / r;
          if (d > 1) continue;
          const i = (y * view.w + x) * 4;
          if (d < 0.55) img.data.set(core, i);
          else if (d < 0.85) {
            if (img.data[i + 3] === 0 || img.data[i + 3] === edge[3]) img.data.set(ring, i);
          } else if ((x + y) % 2 === 0 && img.data[i + 3] === 0) img.data.set(edge, i);
        }
    }
    return shade(img);
  };

  const shot = () => {
    const img = createImage(view.w, view.h);
    drawImage(img, room[doors], 0, 0);
    if (shown)
      for (const who of order()) {
        const c = cast[who];
        drawImage(img, odd[who](c.pose), c.x, c.y, c.flip);
        const dir = c.pose.includes('-side-')
          ? 'side'
          : c.pose.includes('-up-')
            ? undefined
            : 'down';
        if (dir && c.shades !== null) {
          const [hx, hy] = head(c.pose);
          drawImage(
            img,
            shade(shadesFor(dir, c.glint)),
            c.x + (c.flip ? -hx : hx),
            c.y + hy + SHADES[dir].top + c.shades,
            c.flip
          );
        }
      }
    if (puffs.length) drawImage(img, smoke(), 0, 0);
    return zoom(img);
  };
  const add = (n = 1, step?: () => void) => {
    for (let i = 0; i < n; i++) {
      step?.();
      frames.push({ image: shot(), delay: DELAY });
    }
  };

  // A quiet lobby, then the doors slide open.
  add(8);
  for (const d of [1, 2, 3, 4]) {
    doors = d;
    add(2);
  }
  // Smoke rolls in through the open doors, and swells.
  add(18, () => {
    puff();
    puff();
    puff();
    drift(false);
  });
  // Out of it they walk: Nate down the middle, Michele and Sam a step behind
  // him, either side, close. A pixel a frame, a new stride every other frame.
  shown = true;
  const marks: Record<Persona, Point & { wait: number }> = {
    nate: { x: door.x + 8, y: view.h - 40, wait: 0 },
    michele: { x: door.x + 8 - 20, y: view.h - 43, wait: 5 },
    sam: { x: door.x + 8 + 20, y: view.h - 43, wait: 5 }
  };
  const arrived = (who: Persona) => cast[who].x === marks[who].x && cast[who].y === marks[who].y;
  let t = 0;
  while (!everyone.every(arrived)) {
    add(1, () => {
      if (t < 26) {
        puff();
        if (t < 10) puff();
      }
      drift(t > 34);
      for (const who of everyone) {
        const c = cast[who];
        const m = marks[who];
        if (t < m.wait || arrived(who)) {
          c.pose = 'idle-down-0';
          continue;
        }
        // Down a pixel each frame, and across in step, so each lands at once.
        const rows = m.y - c.y;
        if (rows > 0) c.y += 1;
        const cols = m.x - c.x;
        if (cols && (rows <= 0 || Math.abs(cols) >= rows || (t + who.length) % 2 === 0))
          c.x += Math.sign(cols);
        c.pose = `walk-down-${(t >> 1) % 4}`;
      }
      t++;
    });
  }
  // They stop, and on the beat strike a pose: Michele's hands behind her
  // head, Nate's on his hips, and Sam raises the roof. A hop, then they hold
  // it, and the light catches each pair of shades in turn.
  for (const c of Object.values(cast)) c.pose = 'idle-down-0';
  add(3, () => drift(true));
  const POSES: Record<Persona, string> = {
    michele: 'exercise-stretch-0',
    nate: 'exercise-lift-0',
    sam: 'exercise-lift-2'
  };
  for (const who of everyone) {
    cast[who].pose = POSES[who];
    cast[who].y -= 2;
  }
  add(2, () => drift(true));
  for (const c of Object.values(cast)) c.y += 2;
  for (let i = 0; i < 12; i++)
    add(1, () => {
      drift(true);
      everyone.forEach((who, k) => (cast[who].glint = i >= 2 + k * 3 && i < 4 + k * 3));
    });
  // Still posing, the camera pushes in to twice the size, on their faces.
  const close = { cx: view.w / 2, cy: marks.nate.y + 16 };
  const from = { cx: cam.cx, cy: cam.cy };
  for (const z of [1.1, 1.22, 1.36, 1.5, 1.64, 1.78, 1.9, 2])
    add(1, () => {
      drift(true);
      const k = z - 1;
      cam.z = z;
      cam.cx = from.cx + (close.cx - from.cx) * k;
      cam.cy = from.cy + (close.cy - from.cy) * k;
    });
  // Arms down, and all at once the shades come off: a quick slip down the
  // nose, then a flick up and away. Then they stand there, faces bare,
  // breathing.
  for (const c of Object.values(cast)) c.pose = 'idle-down-0';
  add(3, () => drift(true));
  for (const n of [2, -4, null])
    add(1, () => {
      drift(true);
      for (const c of Object.values(cast)) c.shades = n;
    });
  let breath = 0;
  add(16, () => {
    drift(true);
    for (const c of Object.values(cast)) c.pose = `idle-down-${(breath >> 2) % 4}`;
    breath++;
  });
  const still = frames.at(-1)!.image;
  // Then off they go, out of the camera's frame: Michele to the left, Nate
  // and Sam to the right, two pixels a frame, a new stride every frame.
  cast.michele.flip = true;
  for (const c of Object.values(cast)) c.pose = 'idle-side-0';
  add(2, () => drift(true));
  const gone = (who: Persona) => {
    const f = frameOf();
    return cast[who].x + 16 <= f.x || cast[who].x >= f.x + f.w;
  };
  t = 0;
  while (!everyone.every(gone)) {
    add(1, () => {
      drift(true);
      for (const who of everyone) {
        if (gone(who)) continue;
        cast[who].x += who === 'michele' ? -2 : 2;
        cast[who].pose = `walk-side-${t % 4}`;
      }
      t++;
    });
  }
  add(4, () => drift(true));
  // The still: the three of them close up, shades off.
  frames.push({ image: still, delay: 0 });
  return frames;
}

export { personas };
