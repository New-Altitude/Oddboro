// The office reads which system it runs on in one place: `currentPlatform()`
// in packages/ledger/src/platform.ts. Fails on any other read of
// `process.platform` in the office's and the packages' source, so a test that
// fakes the system reaches every reader. Tests read it to fake it, so they are
// left out; so are comments, which may name it.
import { read, repoFiles, report, withoutComments } from './lib/files.ts';

const HOME = 'packages/ledger/src/platform.ts';
const SOURCE = /^(apps\/office\/src|packages\/[^/]+\/src)\//;
const READ = /\bprocess\.platform\b/;

const files = repoFiles().filter(
  (f) =>
    SOURCE.test(f) &&
    /\.(ts|svelte)$/.test(f) &&
    !f.endsWith('.test.ts') &&
    !f.split('/').includes('test')
);

const failures: string[] = [];
if (!files.includes(HOME) || !READ.test(withoutComments(read(HOME))))
  failures.push(`found no read in ${HOME}: nothing to check`);
for (const file of files) {
  if (file === HOME) continue;
  withoutComments(read(file))
    .split('\n')
    .forEach((line, i) => {
      if (READ.test(line))
        failures.push(`${file}:${i + 1}: reads process.platform. Call currentPlatform() instead.`);
    });
}
report('platform', failures);
