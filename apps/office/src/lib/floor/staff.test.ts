// An Odd visiting a colleague: out, a short stay, and back to the spot it
// held; and an icon playing once over its head. A floor with no renderer,
// ticked by hand. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Sprite, Texture } from 'pixi.js';
import { TILE, type PlacedSpot } from '@oddboro/world';
import type { StaffProfile } from '../staff/roster.ts';
import type { Floor } from './engine.ts';
import { StaffActor } from './staff.ts';

const WIDTH = 10;
const HEIGHT = 4;
/** A desk along the back wall: the seat is no floor to walk on, and its approach is the tile in front. */
const desk = (id: string, x: number): PlacedSpot =>
  ({
    id,
    prop: 'desk',
    obj: `${id}#0`,
    name: id,
    room: `${id}#0`,
    activity: 'work',
    facing: 'up',
    pose: 'sit',
    tile: [x, 1],
    approach: [x, 2]
  }) as PlacedSpot;
const ada = desk('ada', 1);
const paige = desk('paige', 8);
const third = desk('third', 5);

/** Each icon's frames, told apart by identity: twelve, at 8 a second. */
const POPS = {
  notebook: Array.from({ length: 12 }, () => new Texture()),
  note: Array.from({ length: 12 }, () => new Texture())
};
const ICON = { width: 16, height: 16, fps: 8 };

/** One room, open but for the seats, and an optional wall down column `wallAt`. */
function floorOf(wallAt?: number): Floor & { added: Sprite[] } {
  const walkable = Array.from({ length: WIDTH * HEIGHT }, (_, i) => {
    const [x, y] = [i % WIDTH, Math.floor(i / WIDTH)];
    return x !== wallAt && !(y === 1 && [ada, paige, third].some((d) => d.tile[0] === x));
  });
  const added: Sprite[] = [];
  return {
    added,
    atlas: {
      sheet: {
        animations: new Proxy(
          {},
          {
            get: (_, key: string) => POPS[key.split('/')[1] as keyof typeof POPS] ?? [Texture.EMPTY]
          }
        )
      },
      catalog: { odd: { width: 16, height: 24 }, 'fx-pop': ICON }
    },
    objects: { addChild: (s: Sprite) => added.push(s) },
    shadows: { addChild() {} },
    invalidate() {},
    nightTint: 0xffffff,
    world: { walkable, width: WIDTH }
  } as unknown as Floor & { added: Sprite[] };
}

/** An Odd already sat at its desk. */
function seated(floor: Floor, id: string, at: PlacedSpot): StaffActor {
  const profile = { id, name: id, sprite: 'odd', variant: 'a', room: id } as StaffProfile;
  const a = new StaffActor(floor, profile, at.approach!);
  assert.ok(a.sendTo(at));
  a.arrive();
  return a;
}

const tileOf = (a: StaffActor) => [Math.floor(a.x / TILE), a.y / TILE - 1];
/** Ticks every actor until `done` holds, and returns the seconds it took. */
function until(done: () => boolean, actors: StaffActor[], most = 20): number {
  let t = 0;
  while (!done()) {
    assert.ok(t < most, `still waiting after ${most} s`);
    for (const a of actors) a.update(0.05);
    t += 0.05;
  }
  return t;
}

/** Ticks until the trip and the visits queued behind it are over, and returns how many visits started. */
function visitsUntilBack(a: StaffActor, actors: StaffActor[], most: number): number {
  let visits = 0;
  let was: StaffActor | undefined;
  until(
    () => {
      if (a.visiting && !was) visits++;
      was = a.visiting;
      return !a.onTrip;
    },
    actors,
    most
  );
  return visits;
}

test('a visit walks to beside the colleague, stays about 2 s, and comes back to the spot it held', () => {
  const floor = floorOf();
  const a = seated(floor, 'ada', ada);
  const p = seated(floor, 'paige', paige);
  assert.equal(a.visit(p), true);
  assert.equal(a.onTrip, true);
  assert.equal(a.visiting, p);

  until(() => !a.moving && tileOf(a).join() === '8,2', [a, p]);
  assert.equal(a.spotId, 'ada', 'its own spot stays held on the way out');
  assert.equal(a.visiting, p, 'standing with the colleague');
  const stay = until(() => a.moving, [a, p]);
  assert.ok(stay > 1.9 && stay < 2.2, `stayed ${stay} s`);
  assert.equal(a.visiting, undefined, 'on the way back it heads for its room');

  until(() => !a.onTrip, [a, p]);
  assert.deepEqual(tileOf(a), [1, 1], 'back on its own seat');
  assert.equal(a.spotId, 'ada');
});

test('a colleague who moved on while it walked is met where it went', () => {
  const floor = floorOf();
  const a = seated(floor, 'ada', ada);
  const p = seated(floor, 'paige', paige);
  assert.ok(a.visit(p));
  until(() => tileOf(a)[0] >= 3, [a, p]);
  assert.ok(p.sendTo(third));
  until(() => tileOf(a).join() === '5,2' && !a.moving, [a, p]);
  assert.equal(a.visiting, p);
});

const apart = (a: StaffActor, b: StaffActor) => {
  const [ax, ay] = tileOf(a);
  const [bx, by] = tileOf(b);
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
};

test('a colleague on the move is stopped within a tile, both talk a moment, then each goes on', () => {
  const floor = floorOf();
  const a = seated(floor, 'ada', ada);
  const p = seated(floor, 'paige', paige);
  assert.ok(a.visit(p));
  until(() => tileOf(a)[0] >= 2, [a, p]);
  // The colleague walks the other way along the same row, toward the desk at 5.
  assert.ok(p.sendTo(third));
  until(() => !a.moving, [a, p]);
  assert.equal(a.visiting, p, 'stopped to talk');
  assert.ok(apart(a, p) <= 1, 'within a tile');
  const where = tileOf(p).join();
  const x = p.x;
  let still = true;
  const stay = until(() => {
    if (!a.moving) still &&= p.x === x && tileOf(p).join() === where;
    return a.moving;
  }, [a, p]);
  assert.ok(stay > 1.9 && stay < 2.2, `talked ${stay} s`);
  assert.ok(still, 'the colleague stood still for it');
  assert.equal(a.visiting, undefined, 'on its way back');
  until(() => !a.onTrip && !p.moving, [a, p]);
  assert.deepEqual(tileOf(a), [1, 1], 'back on its own seat');
  assert.equal(p.spotId, 'third', 'the colleague went on to where it was going');
  assert.deepEqual(tileOf(p), [5, 1]);
});

test('a seated colleague is met beside its seat, and stays sat', () => {
  const floor = floorOf();
  const a = seated(floor, 'ada', ada);
  const p = seated(floor, 'paige', paige);
  assert.ok(a.visit(p));
  until(() => !a.moving, [a, p]);
  assert.deepEqual(tileOf(a), [8, 2], 'at the approach, not a corner early');
  assert.equal(p.moving, false);
  assert.deepEqual(tileOf(p), [8, 1]);
});

test('visits wait their turn behind the trip under way, up to three', () => {
  const floor = floorOf();
  const a = seated(floor, 'ada', ada);
  const p = seated(floor, 'paige', paige);
  assert.ok(a.visit(p));
  for (let i = 0; i < 3; i++) assert.equal(a.visit(p), true);
  assert.equal(a.visit(p), false, 'a fourth waiting visit is dropped');
  assert.equal(visitsUntilBack(a, [a, p], 60), 4);
  assert.deepEqual(tileOf(a), [1, 1]);
});

for (const [how, move] of [
  ['sent', (a: StaffActor) => a.sendTo(third)],
  ['assigned', (a: StaffActor) => a.assign('work', [third], new Set())]
] as const)
  test(`being ${how} somewhere ends the trip and the visits behind it`, () => {
    const floor = floorOf();
    const a = seated(floor, 'ada', ada);
    const p = seated(floor, 'paige', paige);
    assert.ok(a.visit(p));
    assert.ok(a.visit(p));
    assert.ok(move(a));
    assert.equal(a.onTrip, false);
    until(() => !a.moving, [a, p]);
    for (let i = 0; i < 100; i++) a.update(0.05);
    assert.equal(a.onTrip, false, 'no queued visit starts after');
    assert.equal(a.spotId, 'third');
  });

/** A seat its approach does not touch, so no path steps into it. */
const sealed = { ...desk('sealed', 3), approach: [3, 3] } as PlacedSpot;

for (const [how, move] of [
  ['sent where no path leads', (a: StaffActor) => a.sendTo(sealed)],
  [
    'assigned with every spot held',
    (a: StaffActor) => a.assign('work', [ada, paige], new Set(['ada', 'paige']))
  ]
] as const)
  test(`being ${how} mid-trip keeps the trip and its queue, and it gets back to its seat`, () => {
    const floor = floorOf();
    const a = seated(floor, 'ada', ada);
    const p = seated(floor, 'paige', paige);
    assert.ok(a.visit(p));
    assert.ok(a.visit(p));
    until(() => tileOf(a)[0] >= 3, [a, p]);
    assert.equal(move(a), false);
    assert.equal(a.visiting, p, 'still on its way out');
    assert.equal(visitsUntilBack(a, [a, p], 30), 2, 'the queued visit still runs');
    assert.deepEqual(tileOf(a), [1, 1], 'back on its own seat');
    assert.equal(a.spotId, 'ada');
  });

test('an Odd off the floor, or with no way to the colleague, does not set off', () => {
  const open = floorOf();
  const p = seated(open, 'paige', paige);
  const hidden = seated(open, 'ada', ada);
  hidden.sprite.visible = false;
  assert.equal(hidden.visit(p), false);
  assert.equal(hidden.onTrip, false);

  const walled = floorOf(4);
  const a = seated(walled, 'ada', ada);
  assert.equal(a.visit(seated(walled, 'paige', paige)), false);
  assert.equal(a.onTrip, false);
});

/** Moves the colleague at once to each desk in turn, each time the lead has stepped onto its next tile. */
function keepsMoving(a: StaffActor, p: StaffActor, desks: PlacedSpot[]) {
  for (const d of desks) {
    const from = a.steps[0].join();
    until(() => a.steps[0].join() !== from, [a, p]);
    assert.ok(a.moving, 'still on its way');
    assert.ok(p.sendTo(d));
    p.arrive();
  }
  until(() => standing(a), [a, p]);
}

/** Stands for its stay: no walk left, even once it has looked for the colleague again. */
const standing = (a: StaffActor) => !a.moving && (a.update(0), !a.moving);

test('the way out follows a colleague who moved on twice, and meets it', () => {
  const floor = floorOf();
  const a = seated(floor, 'ada', ada);
  const p = seated(floor, 'paige', paige);
  assert.ok(a.visit(p));
  keepsMoving(a, p, [third, paige]);
  assert.equal(a.visiting, p);
  assert.deepEqual(tileOf(a), [8, 2], 'beside the colleague where it ended up');
});

test('after three turns the way out keeps to where it was going, stays, and goes back', () => {
  const floor = floorOf();
  const a = seated(floor, 'ada', ada);
  const p = seated(floor, 'paige', paige);
  assert.ok(a.visit(p));
  keepsMoving(a, p, [third, paige, third, paige]);
  assert.equal(a.visiting, p, 'standing for its stay');
  assert.deepEqual(tileOf(a), [5, 2], 'where the colleague was before its fourth move');
  assert.deepEqual(p.meetAt, [8, 2]);
  until(() => !a.onTrip, [a, p]);
  assert.deepEqual(tileOf(a), [1, 1], 'back on its own seat');
});

/** The textures an icon showed until it went, and the sprite it was. */
function play(floor: Floor & { added: Sprite[] }, a: StaffActor, before = 0) {
  const icon = floor.added.at(-1)!;
  const shown: Texture[] = [];
  const lifts: number[] = [];
  const gaps: number[] = [];
  let t = 0;
  while (!icon.destroyed) {
    assert.ok(t < 5, 'still playing after 5 s');
    if (shown.at(-1) !== icon.texture) shown.push(icon.texture);
    lifts.push(a.tagLift);
    gaps.push(a.head.y - (icon.y + ICON.height));
    a.update(0.05);
    t += 0.05;
    if (before && t >= before) break;
  }
  return { icon, shown, lifts, gaps, t };
}

test('an icon plays each of its frames once over the head, then goes, and the tag settles', () => {
  const floor = floorOf();
  const a = seated(floor, 'ada', ada);
  const odds = floor.added.length;
  assert.equal(a.tagLift, 0, 'no lift before');
  a.pop('notebook');
  assert.equal(floor.added.length, odds + 1, 'one sprite for the icon');
  const z = a.sprite.zIndex;
  const { icon, shown, lifts, gaps, t } = play(floor, a);
  assert.deepEqual(shown, POPS.notebook, 'every frame in order, ending on the last');
  assert.ok(t > 1.4 && t < 1.6, `played ${t} s`);
  assert.ok(icon.zIndex > z, 'drawn over the Odd');
  assert.ok(
    gaps.every((g) => g > 0),
    'above the head the whole time'
  );
  assert.ok(
    lifts.every((l) => l > ICON.height),
    'the tag rises over the icon while it plays'
  );
  assert.equal(a.tagLift, 0, 'and settles once it has gone');
});

test('an icon that arrives while one plays is dropped', () => {
  const floor = floorOf();
  const a = seated(floor, 'ada', ada);
  a.pop('notebook');
  const odds = floor.added.length;
  play(floor, a, 0.5);
  a.pop('note');
  assert.equal(floor.added.length, odds, 'no second sprite');
  const { shown } = play(floor, a);
  assert.ok(
    shown.every((tex) => POPS.notebook.includes(tex)),
    'the first plays on'
  );
  a.pop('note');
  assert.equal(floor.added.length, odds + 1, 'once it has gone, the next one plays');
});

test('an Odd that leaves the floor, or the office, takes its icon with it', () => {
  const floor = floorOf();
  const a = seated(floor, 'ada', ada);
  a.pop('note');
  const icon = floor.added.at(-1)!;
  assert.ok(a.assign('home', [], new Set()), 'no way out: it steps off the floor');
  assert.equal(icon.destroyed, true);
  assert.equal(a.tagLift, 0);

  const b = seated(floor, 'paige', paige);
  b.pop('notebook');
  const other = floor.added.at(-1)!;
  b.destroy();
  assert.equal(other.destroyed, true);
});
