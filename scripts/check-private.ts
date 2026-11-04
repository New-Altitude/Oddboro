// No private word reaches a tracked file: the owner's name, their family, their
// accounts. The words live in data/private-words.txt, one per line, which git
// ignores, so the list itself never leaves the Mac. A word matches whole, in any
// case, with no letter right before or after it, so "zibbet" catches
// zibbet-office and give_zibbet_a_task but not "zibbets".
//
// A missing list fails, because a guard with nothing to look for passes every
// file. CI cannot hold a gitignored file, so with CI set it skips and says so.
// ODDBORO_PRIVATE_WORDS points the guard at a different list.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { read, repoFiles, report, ROOT } from './lib/files.ts';

const LIST = process.env.ODDBORO_PRIVATE_WORDS
  ? resolve(process.env.ODDBORO_PRIVATE_WORDS)
  : join(ROOT, 'data', 'private-words.txt');

if (!existsSync(LIST)) {
  if (process.env.CI) {
    console.log(`private: skipped, no list at ${LIST} and CI cannot hold the gitignored one`);
    process.exit(0);
  }
  console.error(
    [
      `private: no private-word list at ${LIST}`,
      '  The guard needs it to check anything. To create it:',
      '  1. mkdir -p data',
      '  2. Open data/private-words.txt in an editor.',
      '  3. Write one word per line: your names, family names, account names.',
      '     Lines that start with # are comments.',
      '  4. Run node scripts/check-private.ts again.',
      '  Git ignores data/, so the list never leaves this Mac.'
    ].join('\n')
  );
  process.exit(1);
}

const words = readFileSync(LIST, 'utf8')
  .split('\n')
  .map((w) => w.trim())
  .filter((w) => w && !w.startsWith('#'));
if (!words.length) {
  console.error(`private: ${LIST} holds no words, so the guard would check nothing`);
  process.exit(1);
}
const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pattern = new RegExp(`(?<![A-Za-z])(${words.map(escape).join('|')})(?![A-Za-z])`, 'i');

const failures: string[] = [];
const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|mp4|m4a|mp3|zip)$/i;
for (const file of repoFiles()) {
  if (file.startsWith('data/')) continue;
  // A private word in a file or folder name counts too.
  if (pattern.test(file)) failures.push(`${file}: its name holds a private word`);
  if (BINARY.test(file)) continue;
  read(file)
    .split('\n')
    .forEach((line, i) => {
      if (pattern.test(line)) failures.push(`${file}:${i + 1} holds a private word`);
    });
}
report('private', failures);
