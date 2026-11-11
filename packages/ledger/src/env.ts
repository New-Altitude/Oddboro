// The office's .env, read and written a key at a time so nothing else in it is
// lost. Setup writes it, and so does the office when the owner changes a
// setting in the browser. ODDBORO_ENV names another file, to try an office
// out beside the real one. In the app it lives in the office's home, since
// the app's own folder is signed and every update replaces it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { home, IN_APP } from './home.ts';

// The app's shell finds this file the same way, in apps/desktop/src-tauri/src/diagnostics.rs.
export const ENV_FILE =
  process.env.ODDBORO_ENV ??
  (IN_APP ? home('.env') : fileURLToPath(new URL('../../../.env', import.meta.url)));

/**
 * The file's keys as Node's own parser reads them, the one db.ts loads with
 * (`process.loadEnvFile`), so quotes, `export` and a trailing comment come off
 * the same way in both.
 */
export function readEnv(file = ENV_FILE): NodeJS.Dict<string> {
  try {
    return existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
  } catch {
    // Unreadable here (a sandbox that shows the file but will not open it): nothing from it.
    return {};
  }
}

/**
 * Set keys in .env. An empty value removes the key. A key's lines are found
 * the way readEnv reads them, an `export` line and spaces included. readEnv
 * takes a key's last line, so a set rewrites the first and drops the rest, and
 * a clear drops them all: a reset leaves no line readEnv would still read.
 */
export function writeEnv(updates: Record<string, string>, file = ENV_FILE): void {
  let lines = existsSync(file)
    ? readFileSync(file, 'utf8').replace(/\n$/, '').split('\n')
    : ['# Written by the office. Keep it out of git.'];
  for (const [k, v] of Object.entries(updates)) {
    const line = new RegExp(`^\\s*(?:export +)?${k}\\s*=`);
    const at = lines.findIndex((l) => line.test(l));
    lines = lines.flatMap((l, i) => (i === at && v ? [`${k}=${v}`] : line.test(l) ? [] : [l]));
    if (at < 0 && v) lines.push(`${k}=${v}`);
  }
  writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o600 });
}
