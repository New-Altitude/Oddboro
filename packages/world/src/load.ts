// Reads room templates and floor plans from disk. Server-side only; the
// office composes the world on the server and sends the result to the page.
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { FloorPlan, RoomTemplate } from './types.ts';

export const WORLD_ROOT = fileURLToPath(new URL('..', import.meta.url));

function readDir<T extends { id: string }>(dir: string): Record<string, T> {
  return Object.fromEntries(
    readdirSync(join(WORLD_ROOT, dir))
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const data = JSON.parse(readFileSync(join(WORLD_ROOT, dir, f), 'utf8')) as T;
        return [data.id, data];
      })
  );
}

export function loadSpaces(): {
  rooms: Record<string, RoomTemplate>;
  plans: Record<string, FloorPlan>;
} {
  return { rooms: readDir<RoomTemplate>('rooms'), plans: readDir<FloorPlan>('plans') };
}
