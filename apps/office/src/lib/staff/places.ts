// Every place on the floor a staffer can be sent to, grouped by room, with
// the animation each one plays. The Send tab lists these.
import type { PlacedSpot, World } from '@oddboro/world';
import type { Activity } from './roster.ts';

export type Place = {
  key: string;
  label: string;
  activity: Activity;
  /** The animation a staffer plays there, e.g. "exercise-run". */
  animation: string;
  spots: PlacedSpot[];
};

export type PlaceGroup = { room: string; places: Place[] };

const ROOM_PREFIX = /^(break|kitchen|library|gym|lobby|mail|meeting|owner|street)-/;

/** "library-armchair" reads as "Armchair", "mail-sort-table" as "Sort table". */
export function propLabel(sprite: string): string {
  const words = sprite.replace(ROOM_PREFIX, '').replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const dirOf = (f: PlacedSpot['facing']) => (f === 'left' || f === 'right' ? 'side' : f);

/**
 * Animations an activity asks for first. After these the staffer falls back
 * to the spot's own pose (sit or stand, in the spot's facing).
 */
const POSES: Partial<Record<Activity, string[]>> = {
  work: ['sit-up'],
  read: ['read-down'],
  play: ['play-up'],
  rest: ['sit-down'],
  eat: ['eat-down'],
  exercise: ['exercise-run', 'exercise-lift', 'exercise-stretch', 'exercise-cycle']
};

/** Poses drawn standing. A seat never plays one: on a beanbag, a gamer sits. */
const STANDING = new Set(['play-up']);

/**
 * The animations a staffer doing `activity` at `spot` tries, best first. The
 * floor plays the first one its sprite has; the Send tab shows the first.
 */
export function posesFor(activity: Activity, spot: PlacedSpot | undefined): string[] {
  const dir = dirOf(spot?.facing ?? 'down');
  const seated = spot?.pose === 'sit';
  const kind = spot && activity === 'exercise' ? [`exercise-${spot.name}`] : [];
  // A pose drawn facing one way only plays at a spot that faces that way: on
  // a couch turned to the TV, a resting staffer sits facing it, not the room.
  const faces = (p: string) => !/-(up|down|side)$/.test(p) || p.endsWith(`-${dir}`);
  const doing = (POSES[activity] ?? []).filter((p) => (!seated || !STANDING.has(p)) && faces(p));
  return [...kind, ...doing, `${seated ? 'sit' : 'idle'}-${dir}`, `idle-${dir}`];
}

/** The animation a staffer plays at a spot doing what the spot is for. */
export const animationFor = (spot: PlacedSpot): string =>
  posesFor(spot.activity as Activity, spot)[0];

export function placesFor(world: World): PlaceGroup[] {
  const roomName = (s: PlacedSpot) => {
    const room = world.rooms.find((r) => r.id === s.room);
    if (room) return room.name;
    const [x, y] = s.tile;
    const inside = (b: { x: number; y: number; w: number; h: number }) =>
      x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h;
    return world.rooms.find(inside)?.name ?? (world.halls.some(inside) ? 'Halls' : 'Elsewhere');
  };
  const groups = new Map<string, Map<string, Place>>();
  for (const s of world.spots) {
    const room = roomName(s);
    const animation = animationFor(s);
    const key = `${room}|${s.prop}|${animation}`;
    const places = groups.get(room) ?? new Map<string, Place>();
    groups.set(room, places);
    const place = places.get(key) ?? {
      key,
      label: propLabel(s.prop),
      activity: s.activity as Activity,
      animation,
      spots: []
    };
    place.spots.push(s);
    places.set(key, place);
  }
  return [...groups].map(([room, places]) => ({ room, places: [...places.values()] }));
}
