// A local Oddboro checkout can have any folder name or remote, including a fork.
// Only its tree identifies it here. Its Git configuration and worktree pointers stay closed.
import { lstatSync, opendirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

/** Called with a real folder path, either inside the run's file walls or chosen by the owner. */
export function isOddboroCheckout(root: string): boolean {
  try {
    const git = lstatSync(join(root, '.git'));
    if (!git.isFile() && !git.isDirectory()) return false;
    const manifest = join(root, 'package.json');
    const staff = join(root, 'apps', 'office', 'src', 'lib', 'server', 'staff.ts');
    if (realpathSync.native(staff) !== staff || !lstatSync(staff).isFile()) return false;
    const stat = lstatSync(manifest);
    return (
      stat.isFile() &&
      stat.nlink === 1 &&
      stat.size < 64_000 &&
      JSON.parse(readFileSync(manifest, 'utf8')).name === 'oddboro-platform'
    );
  } catch {
    return false;
  }
}

const skipped = new Set(['.git', 'node_modules', '.svelte-kit', 'target', 'dist']);

/** Search on request, nearest folders first. Report an unfinished search as such. */
export function findOddboroCheckouts(root: string): { checkouts: string[]; partial: boolean } {
  const folders = [root];
  const checkouts: string[] = [];
  let partial = false;
  for (let i = 0; i < folders.length; i++) {
    const folder = folders[i];
    if (isOddboroCheckout(folder)) {
      checkouts.push(folder);
      continue;
    }
    try {
      const dir = opendirSync(folder);
      try {
        for (let e = dir.readSync(); e; e = dir.readSync()) {
          if (!e.isDirectory() || skipped.has(e.name)) continue;
          if (folders.length >= 2000) {
            partial = true;
            break;
          }
          folders.push(join(folder, e.name));
        }
      } finally {
        dir.closeSync();
      }
    } catch {
      partial = true;
    }
  }
  return { checkouts, partial };
}
