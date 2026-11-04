// Every CLAUDE.md is named in its nearest ancestor CLAUDE.md, and every
// CLAUDE.md a context file names exists. An unindexed context file is one no
// session is told about.
import { existsSync } from 'node:fs';
import { join as joinOnDisk, posix } from 'node:path';
import { read, repoFiles, report, ROOT } from './lib/files.ts';

// Repo paths use forward slashes, as git prints them, on every system.
const { dirname, join, normalize } = posix;

const files = repoFiles().filter((f) => f === 'CLAUDE.md' || f.endsWith('/CLAUDE.md'));
const set = new Set(files);
const failures: string[] = [];

/** Paths a context file mentions, as backticked text or markdown links, resolved to repo paths. */
function mentions(file: string): Set<string> {
  const dir = dirname(file);
  const out = new Set<string>();
  const text = read(file);
  for (const m of text.matchAll(/`([^`\s]*CLAUDE\.md)`|\]\(([^)\s]*CLAUDE\.md)\)/g)) {
    const ref = m[1] ?? m[2];
    if (ref.startsWith('../') && dir === '.') continue;
    for (const base of [dir, '.']) out.add(normalize(join(base, ref)));
  }
  return out;
}

for (const file of files) {
  if (file === 'CLAUDE.md') continue;
  let parent = '';
  for (let d = dirname(file); d !== '.';) {
    d = dirname(d);
    const candidate = d === '.' ? 'CLAUDE.md' : `${d}/CLAUDE.md`;
    if (set.has(candidate)) {
      parent = candidate;
      break;
    }
  }
  if (!parent) failures.push(`${file}: no ancestor CLAUDE.md`);
  else if (!mentions(parent).has(file)) failures.push(`${file}: not named in ${parent}`);
}

for (const file of files) {
  const dir = dirname(file);
  for (const m of read(file).matchAll(/`([^`\s]*CLAUDE\.md)`|\]\(([^)\s]*CLAUDE\.md)\)/g)) {
    const ref = m[1] ?? m[2];
    if (ref.startsWith('/') || ref.startsWith('~')) continue;
    const local = normalize(join(dir, ref));
    const fromRoot = normalize(ref);
    if (!existsSync(joinOnDisk(ROOT, local)) && !existsSync(joinOnDisk(ROOT, fromRoot)))
      failures.push(`${file}: names ${ref}, which does not exist`);
  }
}
report('context-index', failures);
