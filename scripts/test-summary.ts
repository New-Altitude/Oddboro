// Turns the lines test-times.ts wrote into a table of where the test time went:
// each suite's total, the slowest tests, the slowest files, and any file that
// started but never ended (a hang). Prints it to the log and, in CI, to the
// run's summary page. Usage: node scripts/test-summary.ts <folder of .jsonl files>
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

type Suite = {
  name: string;
  started: string[];
  ended: Map<string, number>;
  tests: { test: string; file: string; seconds: number }[];
  done?: number;
};

function readSuite(path: string): Suite {
  const suite: Suite = { name: basename(path, '.jsonl'), started: [], ended: new Map(), tests: [] };
  for (const text of readFileSync(path, 'utf8').split('\n')) {
    if (!text) continue;
    let line: unknown;
    try {
      line = JSON.parse(text);
    } catch {
      // A step killed mid-write leaves its last line cut short. Skip it.
      continue;
    }
    if (typeof line !== 'object' || line === null) continue;
    // Each field is checked for its type below before it is used.
    const { start, end, test, file, seconds, done } = line as Record<string, unknown>;
    if (typeof start === 'string') suite.started.push(start);
    if (typeof end === 'string' && typeof seconds === 'number') suite.ended.set(end, seconds);
    if (typeof test === 'string' && typeof file === 'string' && typeof seconds === 'number')
      suite.tests.push({ test, file, seconds });
    if (typeof done === 'number') suite.done = done;
  }
  return suite;
}

const cell = (text: string) => text.replace(/\s+/g, ' ').replaceAll('|', '\\|');
const fixed = (s: number) => s.toFixed(1);
const count = (n: number) => n.toLocaleString('en');

const folder = process.argv[2] ?? '';
const files =
  folder && existsSync(folder)
    ? readdirSync(folder)
        .filter((f) => f.endsWith('.jsonl'))
        .sort()
    : [];
const suites = files.map((f) => readSuite(join(folder, f)));

const out: string[] = ['## Test times', ''];
if (!suites.length) out.push(`No test times found in ${folder || '(no folder given)'}.`);
else {
  out.push('| Suite | Time | Files | Top-level tests |', '| --- | --: | --: | --: |');
  for (const s of suites) {
    const time = s.done === undefined ? 'did not finish' : `${Math.round(s.done)} s`;
    out.push(`| ${s.name} | ${time} | ${count(s.started.length)} | ${count(s.tests.length)} |`);
  }

  const unfinished = suites.flatMap((s) =>
    s.started.filter((f) => !s.ended.has(f)).map((f) => `- ${s.name}: \`${f}\``)
  );
  if (unfinished.length) out.push('', '### Files that started but never ended', '', ...unfinished);

  const tests = suites.flatMap((s) => s.tests).sort((a, b) => b.seconds - a.seconds);
  out.push('', '### The 20 slowest tests', '', '| Seconds | Test | File |', '| --: | --- | --- |');
  for (const t of tests.slice(0, 20))
    out.push(`| ${fixed(t.seconds)} | ${cell(t.test)} | \`${t.file}\` |`);

  const testFiles = suites.flatMap((s) => [...s.ended]).sort((a, b) => b[1] - a[1]);
  out.push('', '### The 10 slowest test files', '', '| Seconds | File |', '| --: | --- |');
  for (const [file, seconds] of testFiles.slice(0, 10))
    out.push(`| ${fixed(seconds)} | \`${file}\` |`);
}

const text = out.join('\n') + '\n';
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
