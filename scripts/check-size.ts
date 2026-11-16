// A code file over 1,000 lines is too long for a person or an agent to read in
// one go, so fails on any, tests and their helpers included. Fails too when it
// finds no code file, since then it has checked nothing.
import { read, repoFiles, report } from './lib/files.ts';

const LIMIT = 1000;
// `.svelte.ts` and `.test.ts` end in `.ts`. Art, data and prose are not code.
const COUNTED = /\.(ts|js|mjs|svelte|rs)$/;

/** Lines as `wc -l` counts them, so a CRLF checkout counts the same. */
const lineCount = (text: string) => text.split('\n').length - 1;

const failures: string[] = [];
const files = repoFiles().filter((file) => COUNTED.test(file));
if (!files.length) failures.push('found no code file: nothing to check');
for (const file of files) {
  const lines = lineCount(read(file));
  if (lines > LIMIT)
    failures.push(
      `${file}: ${lines} lines, over ${LIMIT.toLocaleString('en-US')}. Move a piece of it into a module of its own.`
    );
}
report('size', failures);
