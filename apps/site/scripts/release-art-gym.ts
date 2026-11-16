// 0.0.8's animation: Theo jogs round the office's gym.
import { createImage, drawImage, type Image } from '@oddboro/sprites/png';
import { type GifFrame } from './gif.ts';
import type { GymLayers } from './release-art.ts';
import { type Point, DELAY } from './release-art-kit.ts';

// Theo's lift poses with his hands somewhere other than at his sides: the row
// of his sprite that a held bar's middle sits on. The seat poses are the lift
// poses sitting down, three rows lower.
const SIT = 3;
const HANDS: Record<string, number> = {
  'exercise-lift-1': 17,
  'exercise-lift-2': 2,
  'exercise-lift-3': 17,
  'seat-lift-1': 17 + SIT,
  'seat-lift-2': 2 + SIT
};

/**
 * Theo works out in the office's gym, jogging from station to station. He
 * runs on the treadmill, pedals the bike and curls at the dumbbells. He jumps
 * to pull the bar off the rack and presses it, carries it to the bench, sits
 * facing you, and presses it again and again.
 */
function gym({ room, unracked, view, at, bar, odd }: GymLayers): GifFrame[] {
  const theo = { ...at.run, pose: 'exercise-run-0', flip: false, bob: 0 };
  // The treadmill's belt frame while Theo runs on it, and whether the bar is
  // on the rack or in his hands.
  let belt = 0;
  let racked = true;
  const frames: GifFrame[] = [];

  /** A seat pose: the lift pose's top half, dropped as sitting drops him, over sit-down's legs. */
  const seats = new Map<string, Image>();
  const look = (pose: string) => {
    if (!pose.startsWith('seat-')) return odd(pose);
    if (!seats.has(pose)) {
      const top = odd(pose.replace('seat-', 'exercise-'));
      const legs = odd('sit-down-0');
      const img = createImage(top.width, top.height);
      const row = top.width * 4;
      img.data.set(top.data.subarray(0, 23 * row), SIT * row);
      img.data.set(legs.data.subarray(26 * row), 26 * row);
      seats.set(pose, img);
    }
    return seats.get(pose)!;
  };
  const shot = () => {
    const img = createImage(view.w, view.h);
    drawImage(img, racked ? room[belt % room.length] : unracked, 0, 0);
    const y = theo.y + theo.bob;
    drawImage(img, look(theo.pose), theo.x, y, theo.flip);
    if (!racked)
      drawImage(
        img,
        bar.img,
        theo.x + 8 - (bar.img.width >> 1),
        y + (HANDS[theo.pose] ?? HANDS['exercise-lift-1']) - bar.mid
      );
    return img;
  };
  const add = (n = 1) => {
    for (let i = 0; i < n; i++) frames.push({ image: shot(), delay: DELAY });
  };
  /** Jog to each point in turn, one way at a time, four pixels a frame, a new stride every frame. */
  const jog = (...to: Point[]) => {
    for (const p of to)
      while (theo.x !== p.x || theo.y !== p.y) {
        const step = frames.length % 4;
        if (theo.x !== p.x) {
          const dx = Math.sign(p.x - theo.x) * Math.min(4, Math.abs(p.x - theo.x));
          theo.x += dx;
          theo.flip = dx < 0;
          theo.pose = `exercise-run-${step}`;
        } else {
          const dy = Math.sign(p.y - theo.y) * Math.min(4, Math.abs(p.y - theo.y));
          theo.y += dy;
          theo.flip = false;
          theo.pose = `walk-${dy < 0 ? 'up' : 'down'}-${step}`;
        }
        add();
      }
  };
  /** Carry the bar to each point, chest high, two pixels a frame, bobbing with each step. */
  const carry = (...to: Point[]) => {
    theo.pose = 'exercise-lift-1';
    for (const p of to)
      while (theo.x !== p.x || theo.y !== p.y) {
        if (theo.x !== p.x) theo.x += Math.sign(p.x - theo.x) * Math.min(2, Math.abs(p.x - theo.x));
        else theo.y += Math.sign(p.y - theo.y) * Math.min(2, Math.abs(p.y - theo.y));
        theo.bob = (frames.length >> 1) % 2;
        add();
      }
    theo.bob = 0;
  };

  // The treadmill: running in place, the belt turning under him.
  for (let i = 0; i < 28; i++) {
    belt = i;
    theo.pose = `exercise-run-${i % 4}`;
    add();
  }
  belt = 0;
  // Off the back of the treadmill and onto the bike.
  jog({ x: at.run.x, y: at.cycle.y }, at.cycle);
  for (let i = 0; i < 28; i++) {
    theo.pose = `exercise-cycle-${i % 4}`;
    add();
  }
  // Up to the dumbbells, and curls.
  jog({ x: at.cycle.x, y: at.curl.y }, at.curl);
  theo.flip = false;
  for (let i = 0; i < 30; i++) {
    theo.pose = Math.floor(i / 3) % 2 ? 'exercise-lift-1' : 'exercise-lift-0';
    add();
  }
  // Along to the rack. He turns, reaches, and jumps to pull the bar off.
  jog(at.rack);
  theo.flip = false;
  theo.pose = 'idle-down-0';
  add();
  theo.pose = 'exercise-lift-2';
  add(2);
  racked = false;
  theo.y -= 3;
  add();
  theo.y += 3;
  add();
  // Down to his chest, a strain, and up.
  theo.pose = 'exercise-lift-1';
  add(3);
  theo.pose = 'exercise-lift-3';
  for (const dx of [1, -1, 1, -1]) {
    theo.x += dx;
    add();
  }
  theo.pose = 'exercise-lift-2';
  add(14);
  theo.pose = 'exercise-lift-1';
  add(3);
  theo.pose = 'exercise-lift-2';
  add(8);
  // He carries the bar to the bench and sits on its end, facing you, a beat
  // before he presses.
  theo.pose = 'exercise-lift-1';
  add(2);
  carry({ x: at.rack.x, y: at.bench.y }, at.bench);
  theo.pose = 'seat-lift-1';
  add(17);
  // Up it goes, then twice more, and he holds it there.
  theo.pose = 'seat-lift-2';
  add(6);
  for (let rep = 0; rep < 2; rep++) {
    theo.pose = 'seat-lift-1';
    add(3);
    theo.pose = 'seat-lift-2';
    add(4);
  }
  add(8);
  // The still: Theo on the bench with the bar up.
  frames.push({ image: shot(), delay: 0 });
  return frames;
}

export { gym };
