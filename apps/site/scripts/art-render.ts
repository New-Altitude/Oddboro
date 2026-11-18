// A stage of art.ts, not an entry point: each set of renders, drawn and written.
import { join } from 'node:path';
import { hexToRgba } from '@oddboro/sprites/px';
import { createImage, drawImage } from '@oddboro/sprites/png';
import {
  writeReleaseArt,
  type DeskLayers,
  type EntranceLayers,
  type GymLayers,
  type CurbLayers,
  type HallLayers,
  type Persona
} from './release-art.ts';
import { catalog, cropTo, DAY, frameImage, lighting, NIGHT, sprites, type Rect } from './paint.ts';
import { lookFrame } from '@oddboro/sprites/look';
import { TILE } from '@oddboro/world';
import { ART, world, lotWorld, W, H, rectOf, parts, crop, write } from './art-office.ts';
import {
  STAFF,
  ROWS,
  FRAMES,
  bus,
  openDraws,
  doorRect,
  lane,
  HALL,
  hallDraws,
  hallLights,
  GYM_ROOM,
  gymWorld,
  GYM_VIEW,
  BENCH_SEAT,
  ENTRANCE_DOOR,
  ENTRANCE_STEPS,
  entranceWorld,
  ENTRANCE_VIEW,
  personaLooks,
  personaLib,
  hunterFrame,
  RACK,
  RACK_BAR
} from './art-layers.ts';
import { vWorld, VW, VH, V, vignettes } from './art-vignettes.ts';

/** Every image the hour changes: one set per theme. */
function renderSet(hour: number, dir: string): void {
  const { paint, shade, light } = lighting(hour, W, H);
  const lit = light(paint(world.draws, true), world, world.draws);

  write('lot.png', cropTo(light(paint(lotWorld.draws, true), lotWorld, lotWorld.draws), crop), dir);
  for (const kind of ['floor', 'wall', 'prop'] as const)
    write(
      `${kind}s.png`,
      cropTo(
        shade(
          paint(
            parts[kind].map((p) => p.d),
            false
          )
        ),
        crop
      ),
      dir
    );
  write('lit.png', cropTo(lit, crop), dir);
  // The standing props alone, lit, with each one's own alpha: an Odd behind a
  // prop shows through its glass and its gaps, and hides only behind what is
  // solid. The page stacks pieces of this layer over a walking Odd.
  const standing = paint(
    world.draws.filter((d) => d.obj && d.pass > 0),
    false
  );
  const pieces = createImage(lit.width, lit.height);
  for (let i = 0; i < lit.width * lit.height; i++) {
    const a = standing.data[i * 4 + 3];
    if (a) pieces.data.set([lit.data[i * 4], lit.data[i * 4 + 1], lit.data[i * 4 + 2], a], i * 4);
  }
  write('pieces.png', cropTo(pieces, crop), dir);
  const doorOpen = cropTo(light(paint(openDraws, true), world, openDraws), doorRect);
  write('door-open.png', doorOpen, dir);

  for (const s of STAFF) {
    const def = sprites.get(s.sprite)!;
    const sheet = createImage(FRAMES * def.width, ROWS.length * def.height);
    ROWS.forEach((row, r) => {
      for (let f = 0; f < FRAMES; f++) {
        const name = `${row}-${f}`;
        if (!def.frames.some((x) => x.name === name)) continue;
        drawImage(sheet, frameImage(def, name, s.variant), f * def.width, r * def.height);
      }
    });
    write(`${s.name}.png`, shade(sheet, 1), dir);
  }

  // The bus: closed with the wheels in two positions, then the door open.
  const busSheet = createImage(3 * bus.width, bus.height);
  ['closed-0', 'closed-1', 'open-0'].forEach((f, i) =>
    drawImage(busSheet, frameImage(bus, f), i * bus.width, 0)
  );
  write('bus.png', shade(busSheet, 1), dir);

  // The same bus in two layers, for the one by What happens next: the body
  // lifts over a bump while the wheels stay on the road. The wheels layer is
  // each wheel's 12 by 9 disc (its top two rows sit inside the arch) and the
  // shadow under the bus; the body is every other pixel. Stacked at rest they
  // are bus.png's first frame to the pixel. The sprite's closed-0 and closed-1
  // are the same pixels, so the second wheel frame is the first mirrored,
  // which moves each tread mark to the other diagonal: the wheel turns.
  const BUS_WHEELS = [12, 58];
  const isWheel = (x: number, y: number) =>
    y >= 38 || (y >= 29 && BUS_WHEELS.some((w) => x >= w && x < w + 12));
  const busBody = createImage(bus.width, bus.height);
  const busWheels = createImage(2 * bus.width, bus.height);
  for (let y = 0; y < bus.height; y++)
    for (let x = 0; x < bus.width; x++) {
      const from = (y * busSheet.width + x) * 4;
      const px = busSheet.data.subarray(from, from + 4);
      if (!isWheel(x, y)) {
        busBody.data.set(px, (y * bus.width + x) * 4);
        continue;
      }
      busWheels.data.set(px, (y * busWheels.width + x) * 4);
      const w = BUS_WHEELS.find((w) => x >= w && x < w + 12);
      const mx = w === undefined ? x : 2 * w + 11 - x;
      busWheels.data.set(px, (y * busWheels.width + bus.width + mx) * 4);
    }
  write('bus-body.png', busBody, dir);
  write('bus-wheels.png', busWheels, dir);

  const vLit = light(paint(vWorld.draws, true, VW, VH), vWorld, vWorld.draws);
  let desk: DeskLayers | undefined;
  for (const v of vignettes) {
    const [tx, ty] = v.tile;
    const def = sprites.get(v.staff.sprite)!;
    // Props drawn after the Odd's row, and over their body, go on the front layer.
    const z = ty * TILE + TILE - 1;
    const body: Rect = { x: tx * TILE, y: ty * TILE - TILE, w: TILE, h: 2 * TILE };
    const front = createImage(V.w, V.h);
    for (const d of vWorld.draws) {
      if (!d.obj || d.pass === 0 || d.z <= z) continue;
      const pr = rectOf(d);
      if (
        pr.x >= body.x + body.w ||
        pr.x + pr.w <= body.x ||
        pr.y >= body.y + body.h ||
        pr.y + pr.h <= body.y
      )
        continue;
      const cut = cropTo(vLit, pr);
      const mask = frameImage(sprites.get(d.sprite)!, d.frame, d.variant);
      for (let y = 0; y < pr.h; y++)
        for (let x = 0; x < pr.w; x++) {
          const mx = d.flip ? pr.w - 1 - x : x;
          if (mask.data[(y * pr.w + mx) * 4 + 3] === 0) continue;
          const fx = pr.x + x - v.r.x;
          const fy = pr.y + y - v.r.y;
          if (fx < 0 || fy < 0 || fx >= V.w || fy >= V.h) continue;
          front.data.set(
            cut.data.subarray((y * pr.w + x) * 4, (y * pr.w + x) * 4 + 4),
            (fy * V.w + fx) * 4
          );
        }
    }
    write(`vignette-${v.id}.png`, cropTo(vLit, v.r), dir);
    write(`vignette-${v.id}-front.png`, front, dir);
    // The Odd's pose as a strip, every frame side by side: frame 0 is the
    // still the card rests on.
    const staffAnim = createImage(V.w * v.frames.length, V.h);
    v.frames.forEach((f, i) =>
      drawImage(staffAnim, shade(frameImage(def, f, v.staff.variant), 1), i * V.w + v.at.x, v.at.y)
    );
    write(`vignette-${v.id}-staff-anim.png`, staffAnim, dir);
    // The releases page builds art on the desk.
    if (v.id === 'desk')
      desk = {
        room: cropTo(vLit, v.r),
        front,
        odd: v.frames.map((f) => {
          const img = createImage(V.w, V.h);
          drawImage(img, shade(frameImage(def, f, v.staff.variant), 1), v.at.x, v.at.y);
          return img;
        }),
        shade: (img) => shade(img, 1)
      };
    // The prop's frames, lit, as a strip of only the pixels each frame
    // changes against the room: frame 0 is empty, so the room shows through.
    if (v.animProp) {
      const { d: pd, frames } = v.animProp;
      const rest = cropTo(vLit, v.r);
      const propAnim = createImage(V.w * frames.length, V.h);
      frames.forEach((f, i) => {
        if (!i) return;
        const draws = vWorld.draws.map((d) => (d === pd ? { ...d, frame: f } : d));
        const img = cropTo(light(paint(draws, true, VW, VH), vWorld, draws), v.r);
        for (let p = 0; p < V.w * V.h; p++) {
          const a = img.data.subarray(p * 4, p * 4 + 4);
          const b = rest.data.subarray(p * 4, p * 4 + 4);
          if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) continue;
          const x = p % V.w;
          const y = Math.floor(p / V.w);
          propAnim.data.set(a, (y * propAnim.width + i * V.w + x) * 4);
        }
      });
      write(`vignette-${v.id}-prop-anim.png`, propAnim, dir);
    }
    // By day the office drifts five motes of dust in each window's sunlight:
    // one pixel each, from the window's foot up to 36 pixels into the room,
    // at 0.25 to 0.6 alpha. The page lifts the layer a few pixels as it plays.
    if (v.dust && dir === 'day') {
      const dust = createImage(V.w, V.h);
      let seed = 7;
      const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) % 10000) / 10000;
      for (const d of vWorld.draws) {
        if (!sprites.get(d.sprite)!.tags.includes('window')) continue;
        const { width: ww, height: wh } = catalog[d.sprite];
        for (let i = 0; i < 5; i++) {
          const x = Math.round(d.x + 2 + rand() * (ww + 10)) - v.r.x;
          const y = Math.round(d.y + wh + rand() * 36) - v.r.y;
          const a = Math.round(255 * (0.25 + 0.35 * rand()));
          if (x < 0 || y < 0 || x >= V.w || y >= V.h) continue;
          dust.data.set([...hexToRgba('#fff4dc').slice(0, 3), a], (y * V.w + x) * 4);
        }
      }
      write(`vignette-${v.id}-dust.png`, dust, dir);
    }
  }

  // The releases page's art, once per theme like the rest: night in
  // static/art/releases/, day in static/art/day/releases/. The desk comes from
  // the vignettes; the front door is the hero building's own, shut, with the
  // sidewalk below it, the same door open, and Ada (the desk's Odd) to walk
  // up to it. The hallway is HALL, lit here for the hour.
  if (!desk) throw new Error('the releases art needs the desk vignette');
  const doorAt: Rect = {
    x: Math.round(doorRect.x + doorRect.w / 2 - 64),
    y: doorRect.y + doorRect.h + 48 - 96,
    w: 128,
    h: 96
  };
  /** One sprite frame of an Odd from STAFF, lit for the hour. */
  const oddFrame = (who: (typeof STAFF)[number]) => (frame: string) => {
    const src = frameImage(sprites.get(who.sprite)!, frame, who.variant);
    const img = createImage(src.width, src.height);
    drawImage(img, src, 0, 0);
    return shade(img, 1);
  };
  const adaFrame = oddFrame(STAFF[1]);
  const hall: HallLayers = {
    room: light(
      paint(hallDraws, true, HALL.w, HALL.h),
      { ...vWorld, lights: hallLights },
      hallDraws
    ),
    period: HALL.period,
    view: HALL.view,
    odd: adaFrame,
    mate: oddFrame(STAFF[2]),
    shade: (img) => shade(img, 1)
  };
  // The gym, lit once per frame of the treadmill's belt, and once with the
  // bar off the rack. Theo's places are the office's own spots on its
  // equipment; the bench has none, so he sits on its pad.
  const gymLit = (frames: Record<string, string>) => {
    const draws = gymWorld.draws.map((d) =>
      frames[d.sprite] ? { ...d, frame: frames[d.sprite] } : d
    );
    const w = gymWorld.width * TILE;
    const h = gymWorld.height * TILE;
    return cropTo(light(paint(draws, true, w, h), gymWorld, draws), GYM_VIEW);
  };
  const belts = catalog['gym-treadmill'].frames;
  const place = (tx: number, ty: number) => ({
    x: tx * TILE - GYM_VIEW.x,
    y: ty * TILE - TILE - GYM_VIEW.y
  });
  const spotAt = (prop: string) => {
    const s = gymWorld.spots.find((x) => x.prop === prop);
    if (!s) throw new Error(`the gym art needs a spot on ${prop}`);
    return place(...s.tile);
  };
  const [bx, by] = GYM_ROOM.props.find((p) => p.sprite === 'gym-bench')!.at;
  const seat = place(bx, by + 1);
  const rack = gymWorld.draws.find((d) => d.sprite === 'gym-rack')!;
  const barImage = cropTo(frameImage(sprites.get('gym-rack')!, 'bar'), {
    x: 0,
    y: RACK_BAR.top,
    w: RACK.width,
    h: 8
  });
  const gym: GymLayers = {
    room: belts.map((b) => gymLit({ 'gym-treadmill': b })),
    unracked: gymLit({ 'gym-rack': 'unracked' }),
    view: { w: GYM_VIEW.w, h: GYM_VIEW.h },
    at: {
      run: spotAt('gym-treadmill'),
      cycle: spotAt('gym-bike'),
      curl: spotAt('gym-dumbbells'),
      rack: spotAt('gym-rack'),
      bench: { x: seat.x, y: seat.y - BENCH_SEAT }
    },
    bar: {
      img: shade(barImage, 1),
      x: rack.x - GYM_VIEW.x,
      y: rack.y + RACK_BAR.top - GYM_VIEW.y,
      mid: RACK_BAR.mid - RACK_BAR.top
    },
    odd: oddFrame(STAFF[2])
  };
  // The lobby, lit once for each step of the doors sliding open, with the
  // three personas to walk in through them.
  const entranceLit = (step: string) => {
    const draws = entranceWorld.draws.map((d) =>
      d.sprite === ENTRANCE_DOOR ? { ...d, frame: step } : d
    );
    const w = entranceWorld.width * TILE;
    const h = entranceWorld.height * TILE;
    return cropTo(light(paint(draws, true, w, h), entranceWorld, draws), ENTRANCE_VIEW);
  };
  const doorDraw = entranceWorld.draws.find((d) => d.sprite === ENTRANCE_DOOR)!;
  const personaFrame = (who: Persona) => (frame: string) =>
    shade(lookFrame(personaLib, personaLooks[who].look, frame), 1);
  const entrance: EntranceLayers = {
    room: ENTRANCE_STEPS.map(entranceLit),
    view: { w: ENTRANCE_VIEW.w, h: ENTRANCE_VIEW.h },
    // The doors' face, below the cap: the doorway the smoke pours from.
    door: {
      x: doorDraw.x - ENTRANCE_VIEW.x,
      y: doorDraw.y + TILE - ENTRANCE_VIEW.y,
      w: 2 * TILE,
      h: 2 * TILE
    },
    odd: {
      nate: personaFrame('nate'),
      michele: personaFrame('michele'),
      sam: personaFrame('sam')
    },
    head: (frame) => personaLib.anchors[frame]?.head ?? [0, 0],
    shade: (img) => shade(img, 1)
  };
  // The street in front of the door for 0.0.10's van: the door's view, run
  // on down across the sidewalk and the near lane.
  const curbAt: Rect = { ...doorAt, h: lane * TILE + 24 - doorAt.y };
  const curb: CurbLayers = {
    room: cropTo(lit, curbAt),
    view: { w: doorAt.w, h: doorAt.h },
    door: { ...doorRect, x: doorRect.x - curbAt.x, y: doorRect.y - curbAt.y },
    open: doorOpen,
    lane: lane * TILE - curbAt.y,
    odd: (frame) => shade(hunterFrame(frame), 1),
    head: (frame) => personaLib.anchors[frame]?.head ?? [0, 0],
    torso: (frame) => personaLib.anchors[frame]?.torso ?? [0, 0],
    shade: (img) => shade(img, 1)
  };
  writeReleaseArt(
    {
      desk,
      curb,
      hall,
      gym,
      entrance,
      door: {
        room: cropTo(lit, doorAt),
        door: { ...doorRect, x: doorRect.x - doorAt.x, y: doorRect.y - doorAt.y },
        open: doorOpen,
        odd: adaFrame
      }
    },
    join(ART, dir, 'releases'),
    dir === 'day' ? 'day' : 'night',
    join(ART, 'releases')
  );
}

renderSet(NIGHT, '');
renderSet(DAY, 'day');
