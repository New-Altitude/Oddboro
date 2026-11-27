// The page writes to the office only through apps/office/src/lib/ui/api.ts,
// which sends every write as JSON or as file bytes. 0.0.5's page sent a DELETE
// with no content type, and SvelteKit's origin check, which runs only in a
// release build, refused it: Revoke did nothing (#25). smoke.ts --stage tries
// api.ts against a release build. Fails on any `fetch(` with a `method:` other
// than GET, any `navigator.sendBeacon(` and any `XMLHttpRequest` in the page's
// code anywhere else. The page's code is the office's `src` without its server
// side (`lib/server/`, `*.server.ts`, `+server.ts`) and tests. Comments are
// left out. Fails when api.ts has no write, since then there is nothing to check.
import { read, repoFiles, report, withoutComments } from './lib/files.ts';

const HOME = 'apps/office/src/lib/ui/api.ts';

const files = repoFiles().filter(
  (f) =>
    f.startsWith('apps/office/src/') &&
    /\.(ts|svelte)$/.test(f) &&
    !f.startsWith('apps/office/src/lib/server/') &&
    !/(\.server\.ts|\/\+server\.ts|\.test\.ts)$/.test(f) &&
    !f.split('/').includes('test')
);

/** Each `fetch(` call's text up to its closing parenthesis, and its line. */
function fetches(text: string): { line: number; call: string }[] {
  const out: { line: number; call: string }[] = [];
  for (const m of text.matchAll(/\bfetch\(/g)) {
    let depth = 0;
    let end = m.index + 'fetch'.length;
    for (; end < text.length; end++) {
      if (text[end] === '(') depth++;
      else if (text[end] === ')' && --depth === 0) break;
    }
    out.push({ line: text.slice(0, m.index).split('\n').length, call: text.slice(m.index, end) });
  }
  return out;
}

const writes = (call: string) =>
  /\bmethod\s*[:,]/.test(call) && !/\bmethod\s*:\s*['"]GET['"]/.test(call);

const failures: string[] = [];
const home = withoutComments(read(HOME));
if (!fetches(home).some((f) => writes(f.call)))
  failures.push(`found no write in ${HOME}: nothing to check`);
for (const file of files) {
  if (file === HOME) continue;
  const text = withoutComments(read(file));
  const found = fetches(text)
    .filter((f) => writes(f.call))
    .map((f) => f.line);
  text.split('\n').forEach((line, i) => {
    if (/navigator\.sendBeacon\(|\bXMLHttpRequest\b/.test(line)) found.push(i + 1);
  });
  for (const line of found)
    failures.push(
      `${file}:${line}: writes to the office directly. Use call, post, stream or sendFile from lib/ui/api.ts (#25).`
    );
}
report('page writes', failures);
