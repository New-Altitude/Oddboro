// The files a guard reads: everything tracked or about to be, minus ignored.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export function repoFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  // A file deleted or renamed but not yet staged is still in the index: skip it.
  return out
    .split('\n')
    .filter(Boolean)
    .filter((f) => existsSync(join(ROOT, f)));
}

export const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');

/** Print failures and exit 1, or print ok. */
export function report(name: string, failures: string[]): void {
  if (failures.length) {
    console.error(
      `${name}: ${failures.length} problem(s)\n` + failures.map((f) => `  ${f}`).join('\n')
    );
    process.exit(1);
  }
  console.log(`${name}: ok`);
}
