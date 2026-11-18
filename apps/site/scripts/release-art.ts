// The art on /releases/: one looping GIF per release that has one, built on
// the desk vignette (an Odd typing at its desk), the office's front door, a
// hallway or the gym, and a still of its last frame for visitors who ask for reduced motion. art.ts calls this once per
// theme, with the vignette's layers lit for night or for day, so every
// animation added here comes in both. Every colour added here is the house
// palette's, and `shade` lights it the way the room is lit. Each animation is
// its own module, release-art-<name>.ts, drawing with release-art-kit.ts; this
// file lists them, with the layers they draw on, and writes each one. They are:
//
//   hello-world   the screen answers the Odd's typing: "HELLO, WORLD!" fills
//                 a speech bubble one letter at a time (0.0.1)
//   stuck-sign-in Ada walks into the shut front door, three times, backs off
//                 and wonders why (0.0.2, the stuck sign-in fix)
//   linux         the screen flashes and a penguin jumps out of it, arcs over
//                 the desk and lands on the floor (0.0.3)
//   locked-door   the open front door's two leaves slide shut together in
//                 front of Ada, she locks it, CLICK, steps back with a
//                 padlock on it and faces the street (0.0.4, the office
//                 takes actions only from its own page)
//   windows       Ada walks an endless hallway, a window in every other
//                 tile: windows, on Windows, on Windows (0.0.5, the Windows
//                 app). The loop has no start: its last frame leads into its
//                 first.
//   hand-off      a relay in the same hall, one pun a hand-off: HAND-OFF!,
//                 HANDS ON!, FOLDER AND WISER, CODEX MARKS THE SPOT, GROK ON!,
//                 LESSON? IT STUCK., NO BRAINER!, BACKSIES! (0.0.6: hand-offs,
//                 folders, Codex and Grok, lessons, keys for hosted tools, and
//                 the Revoke fix)
//   loop          Ada walks the hall, off the end and in again at the start:
//                 UPDATING!, AGAIN?, AND AGAIN?. The fourth time she stops
//                 and turns to you: OUT OF THE LOOP! (0.0.7, the Windows
//                 update that installed itself over and over)
//   gym           Theo jogs round the office's gym: the treadmill, the bike,
//                 curls at the dumbbells, the bar off the rack, and presses
//                 on the bench (0.0.8)
//   personas      inside the lobby, the front doors slide open, smoke pours
//                 in, and Nate, Michele and Sam Frank walk out of it in gold
//                 shades and strike a pose. The camera pushes in on their
//                 faces, the shades come off together, and they walk off,
//                 Michele one way and the other two the other (0.0.9, New
//                 Altitude personas)
//   bug-hunters   a white van marked BUG HUNTERS pulls up in front of the
//                 office, its back doors swing open, and two bug hunters in
//                 yellow suits, hoods, masks and spray tanks hop out and walk
//                 in through the front door (0.0.10, a release of bug fixes)
//   advanced      at the desk, a wall switch marked ADVANCED flips on by
//                 itself (the owner, off screen), the monitor flashes and
//                 grows into a wide terminal titled PROJECTS, and lines of
//                 code type out and scroll while the Odd works (0.0.11,
//                 Claude Code and Codex projects behind Advanced mode)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createImage, drawImage, encodePng, scaleImage, type Image } from '@oddboro/sprites/png';
import { hexToRgba } from '@oddboro/sprites/px';
import { encodeGif, type GifFrame } from './gif.ts';
import { PALETTE, type Point } from './release-art-kit.ts';
import { linux } from './release-art-linux.ts';
import { helloWorld } from './release-art-hello-world.ts';
import { stuckSignIn } from './release-art-stuck-sign-in.ts';
import { lockedDoor } from './release-art-locked-door.ts';
import { windows } from './release-art-windows.ts';
import { handOff } from './release-art-hand-off.ts';
import { loop } from './release-art-loop.ts';
import { gym } from './release-art-gym.ts';
import { personas } from './release-art-personas.ts';
import { STILL_AT, bugHunters } from './release-art-bug-hunters.ts';
import { advanced } from './release-art-advanced.ts';

export type DeskLayers = {
  /** The room, lit, without the Odd. */
  room: Image;
  /** What stands in front of the Odd. */
  front: Image;
  /** The Odd typing, one image per frame, already lit and placed. */
  odd: Image[];
  /** Lights an added sprite the way the room's lamp lights the Odd. */
  shade: (img: Image) => Image;
};

/** The office's front door, shut, and the sidewalk below it. */
export type DoorLayers = {
  /** The street and the building's front, lit, with no Odd. */
  room: Image;
  /** The door, in the room's pixels. */
  door: { x: number; y: number; w: number; h: number };
  /** The door open, lit, the size of `door`, to draw over the shut one. */
  open: Image;
  /** Ada in one sprite frame, like `walk-up-2`, lit, 16 by 32. */
  odd: (frame: string) => Image;
};

/** A hallway that repeats, to walk along forever. */
export type HallLayers = {
  /** The hall, lit, wider than the view on both sides, repeating every `period` pixels. */
  room: Image;
  period: number;
  /** The view's size. It starts one period in. */
  view: { w: number; h: number };
  /** Ada in one sprite frame, like `walk-side-2`, lit, 16 by 32. */
  odd: (frame: string) => Image;
  /** Theo, the same way, for the art that needs a colleague. */
  mate: (frame: string) => Image;
  /** Lights an added sprite the way the hall is lit. */
  shade: (img: Image) => Image;
};

/** The office's gym, packed into one view, with Theo to work out in it. */
export type GymLayers = {
  /** The gym, lit, one image per frame of the treadmill's belt. */
  room: Image[];
  /** The same gym with the bar lifted off the rack. */
  unracked: Image;
  view: { w: number; h: number };
  /** Where Theo stands at each station, as his sprite's top-left. */
  at: Record<'run' | 'cycle' | 'curl' | 'rack' | 'bench', Point>;
  /** The rack's loaded bar, lit, where it rests on the rack, and its middle row. */
  bar: { img: Image; x: number; y: number; mid: number };
  /** Theo in one sprite frame, like `exercise-run-2`, lit, 16 by 32. */
  odd: (frame: string) => Image;
};

/** The three New Altitude personas 0.0.9 brings in. */
export type Persona = 'nate' | 'michele' | 'sam';

/** The lobby seen from inside, facing the front doors, with the personas to walk in. */
export type EntranceLayers = {
  /** The lobby, lit, once for each step of the doors: shut, three sliding, open. */
  room: Image[];
  view: { w: number; h: number };
  /** The doorway's face in the view's pixels, below the wall's cap. */
  door: { x: number; y: number; w: number; h: number };
  /** Each persona in one sprite frame, like `walk-down-2`, lit, 16 by 32. */
  odd: Record<Persona, (frame: string) => Image>;
  /** How far a frame moves the head from where it sits standing, for the shades. */
  head: (frame: string) => [number, number];
  /** Lights an added sprite the way the lobby is lit. */
  shade: (img: Image) => Image;
};

/** The street in front of the office, from the front door down across the near lane. */
export type CurbLayers = {
  /** The building's front, the sidewalk and the near lane, lit, the view's width and taller. */
  room: Image;
  view: { w: number; h: number };
  /** The front door, in the room's pixels. */
  door: { x: number; y: number; w: number; h: number };
  /** The door open, lit, the size of `door`. */
  open: Image;
  /** The near lane's top row, in the room's pixels. */
  lane: number;
  /** A bug hunter in one sprite frame, like `walk-up-2`: suit, boots and gloves, lit, 16 by 32. */
  odd: (frame: string) => Image;
  /** How far a frame moves the head and the torso from where they sit standing. */
  head: (frame: string) => [number, number];
  torso: (frame: string) => [number, number];
  /** Lights an added sprite the way the street is lit. */
  shade: (img: Image) => Image;
};

export type Layers = {
  curb: CurbLayers;
  desk: DeskLayers;
  door: DoorLayers;
  hall: HallLayers;
  gym: GymLayers;
  entrance: EntranceLayers;
};

/**
 * Every release's art. `share` is the GIF frame, counted from 0, that becomes
 * the link preview while that release is the newest one, and `shareLight` is
 * whether that frame is drawn by night or by day. The owner picks both when
 * the art is made; there is no default.
 */
const ART: {
  name: string;
  frames: (layers: Layers) => GifFrame[];
  share: number;
  shareLight: 'night' | 'day';
}[] = [
  // The whole hello in its bubble.
  { name: 'hello-world', frames: (l) => helloWorld(l.desk), share: 30, shareLight: 'night' },
  // Ada backed off on the sidewalk, wondering.
  { name: 'stuck-sign-in', frames: (l) => stuckSignIn(l.door), share: 55, shareLight: 'night' },
  // The penguin standing on the floor, by day, where his ink shows.
  { name: 'linux', frames: (l) => linux(l.desk), share: 30, shareLight: 'day' },
  // Ada facing the street beside the locked door, by night, where the glass glows.
  { name: 'locked-door', frames: (l) => lockedDoor(l.door), share: 60, shareLight: 'night' },
  // Ada mid-hall among the windows, by day, where the sky shows.
  { name: 'windows', frames: (l) => windows(l.hall), share: 0, shareLight: 'day' },
  // Theo's brain lit with Ada's key in it: no brainer.
  { name: 'hand-off', frames: (l) => handOff(l.hall), share: 158, shareLight: 'night' },
  // Ada facing you mid-hall, by day: out of the loop.
  { name: 'loop', frames: (l) => loop(l.hall), share: 270, shareLight: 'day' },
  // Theo on the bench with the bar up.
  { name: 'gym', frames: (l) => gym(l.gym), share: 197, shareLight: 'day' },
  // The three of them in their pose, by day, the light on Michele's shades.
  { name: 'personas', frames: (l) => personas(l.entrance), share: 97, shareLight: 'day' },
  // By day, a hunter side on in the mask beside the van, BUG HUNTERS in full.
  { name: 'bug-hunters', frames: (l) => bugHunters(l.curb), share: STILL_AT, shareLight: 'day' },
  // The terminal full of code, the switch on.
  { name: 'advanced', frames: (l) => advanced(l.desk), share: 70, shareLight: 'night' }
];

// The link preview's size, and the ink it sits on.
const CARD = { w: 1200, h: 630 };

/** One frame, scaled up by whole pixels and centred on ink, at the preview's size. */
function shareCard(img: Image): Image {
  const scale = Math.min(Math.floor(CARD.w / img.width), Math.floor(CARD.h / img.height));
  const card = createImage(CARD.w, CARD.h);
  const ink = hexToRgba(PALETTE.k.hex);
  for (let p = 0; p < CARD.w * CARD.h; p++) card.data.set(ink, p * 4);
  const big = scaleImage(img, scale);
  drawImage(card, big, (CARD.w - big.width) >> 1, (CARD.h - big.height) >> 1);
  return card;
}

/**
 * Writes <name>.gif and its still, <name>.png, into `dir`, for one theme. In
 * the light an animation picks for its link preview, it also writes
 * <name>-share.png into `shareDir`, the same folder in both themes.
 */
export function writeReleaseArt(
  layers: Layers,
  dir: string,
  theme: 'night' | 'day',
  shareDir: string
): void {
  mkdirSync(dir, { recursive: true });
  for (const art of ART) {
    const frames = art.frames(layers);
    const gif = frames.slice(0, -1);
    if (!Number.isInteger(art.share) || art.share < 0 || art.share >= gif.length)
      throw new Error(`${art.name}: share frame ${art.share} is not one of its ${gif.length}`);
    writeFileSync(join(dir, `${art.name}.gif`), encodeGif(gif));
    writeFileSync(join(dir, `${art.name}.png`), encodePng(frames.at(-1)!.image));
    if (theme === art.shareLight) {
      mkdirSync(shareDir, { recursive: true });
      writeFileSync(
        join(shareDir, `${art.name}-share.png`),
        encodePng(shareCard(gif[art.share].image))
      );
    }
    console.log(`${relative(process.cwd(), join(dir, art.name))}.gif: ${gif.length} frames`);
  }
}
