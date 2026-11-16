// 0.0.1's animation: the screen answers the Odd's typing, HELLO, WORLD!
import { drawImage } from '@oddboro/sprites/png';
import { type GifFrame } from './gif.ts';
import type { DeskLayers } from './release-art.ts';
import { SCREEN, HELLO, bubble, frame, DELAY } from './release-art-kit.ts';

function helloWorld(layers: DeskLayers): GifFrame[] {
  const tip = bubble(0);
  const at = { x: SCREEN.x - 2, y: SCREEN.y - tip.height - 1 };
  const frames: GifFrame[] = [];
  // Typing, then a letter a frame, a long hold, and a pause before it loops.
  const shown = [
    ...Array(8).fill(-1),
    ...[...HELLO].map((_, i) => i + 1),
    ...Array(26).fill(HELLO.length),
    ...Array(6).fill(-1)
  ];
  shown.forEach((n, t) =>
    frames.push({
      image: frame(layers, t, (img) => {
        if (n >= 0) drawImage(img, bubble(n), at.x, at.y);
      }),
      delay: DELAY
    })
  );
  // The still: the whole hello.
  frames.push({
    image: frame(layers, 0, (img) => drawImage(img, bubble(HELLO.length), at.x, at.y)),
    delay: 0
  });
  return frames;
}

export { helloWorld };
