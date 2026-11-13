// Test-only: every route under src/routes, for the tests that walk them all
// (the owner's actions, and the guard's refusal without the key), so a new
// route joins each of them with no edit. No office module imports it.
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROUTES = fileURLToPath(new URL('../../routes', import.meta.url));

/** Each route under src/routes with this file (`+server.ts` or `+page.server.ts`), by its route id. */
export function routeIds(file: '+server.ts' | '+page.server.ts', dir = ROUTES): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeIds(file, path);
    return name === file ? [`/${relative(ROUTES, dir).split('\\').join('/')}`] : [];
  });
}
