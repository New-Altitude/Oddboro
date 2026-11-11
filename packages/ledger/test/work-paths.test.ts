// How the office names a file in a thread's folder. A name passes only if it
// stays in that folder on every system, Windows's backslash included.
import assert from 'node:assert/strict';
import { win32 } from 'node:path';
import { test } from 'node:test';
import { givenName, givenPath, shownPath, workPath } from '../src/work-paths.ts';

const ROOT = 'C:\\h\\threads\\1';

const REFUSED = [
  ['a climb written with backslashes', 'threads/1/vera/..\\..\\x.md'],
  ['a .. step between two backslashes', 'threads/1/vera/a\\..\\b.md'],
  ['a backslash climb after a forward slash', 'threads/1/vera/m/..\\..\\x.md'],
  ['a . step written with backslashes', 'threads/1/vera/a\\.\\b.md'],
  ['two backslashes in a row, an empty step', 'threads/1/vera/a\\\\b.md'],
  ['a name that starts with a backslash, an empty step', 'threads/1/vera/\\a.md'],
  ['a name that ends with a backslash, an empty step', 'threads/1/vera/a.md\\']
] as const;
const PASSED = [
  'threads/1/vera/m/index.html',
  'threads/1/vera/a\\b.md',
  'threads/1/vera/a..b.md',
  'threads/1/vera/..a\\b.md'
];

for (const [row, path] of REFUSED)
  test(`workPath refuses ${row}`, () => assert.equal(workPath(path), undefined));

test('no name workPath passes leaves the thread folder under a Windows join', () => {
  for (const path of [...REFUSED.map(([, p]) => p), ...PASSED]) {
    const named = workPath(path);
    if (named) assert.ok(win32.join(ROOT, named.inside).startsWith(`${ROOT}\\`), path);
  }
});

test('a name with no dot or empty step passes, whether it holds a backslash or not', () => {
  for (const path of PASSED) assert.equal(workPath(path)?.thread, 1, path);
});

test('an ordinary name passes unchanged', () => {
  assert.deepEqual(workPath('threads/1/vera/m/index.html'), {
    thread: 1,
    inside: 'vera/m/index.html'
  });
});

test('a name on a Mac that holds a backslash, with no empty or dot step, still passes whole', () => {
  assert.deepEqual(workPath('threads/1/vera/a\\b.md'), { thread: 1, inside: 'vera/a\\b.md' });
});

test('forward-slash climbs and empty steps are still refused', () => {
  for (const path of [
    'threads/1/vera/../x.md',
    'threads/1/vera/./x.md',
    'threads/1/vera//x.md',
    'threads/1/x/..'
  ])
    assert.equal(workPath(path), undefined, path);
});

test('a path outside the threads folder, or a thread number past Postgres, names nothing', () => {
  assert.equal(workPath('staff/vera/x.md'), undefined);
  assert.equal(workPath(`threads/${2 ** 31}/vera/x.md`), undefined);
});

test('a name in a folder the owner gave reads as that folder and the path inside it', () => {
  assert.deepEqual(givenPath('folders/site/docs/plan.md'), {
    folder: 'site',
    inside: 'docs/plan.md'
  });
  assert.equal(givenName('site', 'docs/plan.md'), 'folders/site/docs/plan.md');
  assert.equal(shownPath('folders/site/docs/plan.md'), 'site/docs/plan.md');
  assert.equal(shownPath('threads/1/vera/a.md'), 'a.md');
  assert.equal(shownPath('notes/a.md'), 'notes/a.md');
});

for (const [row, path] of [
  ['a .. step', 'folders/site/../x.md'],
  ['a backslash climb', 'folders/site/a\\..\\..\\x.md'],
  ['a . step', 'folders/site/./x.md'],
  ['an empty step', 'folders/site//x.md'],
  ['a folder called ..', 'folders/../x.md'],
  ['a folder name with a backslash', 'folders/a\\b/x.md'],
  ['no path inside the folder', 'folders/site']
] as const)
  test(`givenPath refuses ${row}`, () => assert.equal(givenPath(path), undefined));
