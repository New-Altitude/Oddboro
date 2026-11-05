// The office's .env, read and written a key at a time so nothing else in it is
// lost. Setup writes it, and so does the office when the owner changes a
// setting in the browser. ODDBORO_ENV names another file, to try an office
// out beside the real one. In the app it lives in the office's home, since
// the app's own folder is signed and every update replaces it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { home, IN_APP } from './home.ts';

// The app's shell finds this file the same way, in apps/desktop/src-tauri/src/diagnostics.rs.
export const ENV_FILE =
  process.env.ODDBORO_ENV ??
  (IN_APP ? home('.env') : fileURLToPath(new URL('../../../.env', import.meta.url)));

export function readEnv(file = ENV_FILE): Record<string, string> {
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(l.trim()))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => [m[1], m[2]])
  );
}

/** Set keys in .env. An empty value removes the key. */
export function writeEnv(updates: Record<string, string>, file = ENV_FILE): void {
  const lines = existsSync(file)
    ? readFileSync(file, 'utf8').replace(/\n$/, '').split('\n')
    : ['# Written by the office. Keep it out of git.'];
  for (const [k, v] of Object.entries(updates)) {
    const at = lines.findIndex((l) => l.startsWith(`${k}=`));
    if (!v) {
      if (at >= 0) lines.splice(at, 1);
    } else if (at >= 0) lines[at] = `${k}=${v}`;
    else lines.push(`${k}=${v}`);
  }
  writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o600 });
}
