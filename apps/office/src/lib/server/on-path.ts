// Where a command runs from, found the way a spawn of it by name finds it.
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

/**
 * The file names a spawn of `command` runs. On Windows, Node's spawn (libuv's
 * search_path) adds `.com`, then `.exe`, to a name with no extension and reads
 * no PATHEXT, so claude.exe runs and an npm shim such as claude.cmd does not.
 * Claude Code's own lookup, `claudeCommand`, runs such a shim's script instead.
 * Read per call, like the tools offered, so a test can stub the system.
 */
const runnable = (command: string): string[] =>
  process.platform === 'win32' ? [`${command}.com`, `${command}.exe`] : [command];

/** The first runnable `command` in a folder on PATH, or undefined when there is none. */
export function onPath(command: string): string | undefined {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    for (const name of runnable(command)) {
      const file = join(dir, name);
      try {
        // On Windows X_OK checks only that the file is there.
        accessSync(file, constants.X_OK);
        return file;
      } catch {
        // Not in this folder, or not runnable: look on.
      }
    }
  }
  return undefined;
}
