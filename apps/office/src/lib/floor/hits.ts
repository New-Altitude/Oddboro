// What a tap on the floor lands on: the boxes of switchable props and library
// shelves, and the one drawn on top at a point. Plain data, so a test can drive it.
import type { Sprite, Texture } from 'pixi.js';

/** A sprite the ambient clock animates, with its box in world pixels. */
export type Anim = { s: Sprite; frames: Texture[]; fps: number; start: number; box: Box };
export type Box = [number, number, number, number];
/** Something a tap can land on: its box, and its place in draw order, so the one drawn on top wins. */
export type Hit = { box: Box; rank: number };
/**
 * A prop that gives off light, which the owner can switch off: its sprites, the
 * glowing pixels over them, and its lights. Off, a sprite shows its off frame
 * (drawn, like a cold fireplace, or compiled with its glow colours unlit).
 */
export type Switch = Hit & {
  obj: string;
  on: boolean;
  parts: { s: Sprite; lit: Texture; off?: Texture; anim?: Anim }[];
  glows: { s: Sprite; anim?: Anim }[];
  lights: Sprite[];
};

/** Of the hits whose box holds a world point, the one drawn on top. */
function topAt<T extends Hit>(hits: Iterable<T>, [x, y]: [number, number]): T | undefined {
  let best: T | undefined;
  for (const h of hits) {
    const [bx, by, bw, bh] = h.box;
    if (x >= bx && x < bx + bw && y >= by && y < by + bh && (!best || h.rank > best.rank)) best = h;
  }
  return best;
}

/**
 * What a tap at a world point does: switch the prop drawn on top there, else
 * open the Lessons from a library shelf there. Switches come first, so the
 * library's own lamps and fire still switch.
 */
export function tapAt(
  switches: Iterable<Hit & { obj: string }>,
  shelves: Iterable<Hit>,
  at: [number, number]
): { switch: string } | 'shelf' | undefined {
  const sw = topAt(switches, at);
  if (sw) return { switch: sw.obj };
  return topAt(shelves, at) ? 'shelf' : undefined;
}
