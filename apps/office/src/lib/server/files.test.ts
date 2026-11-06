// Which file a name an Odd wrote opens in the viewer, and what a run may not write. Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { deniedEdits, denyRules, fileInFolder, instructionPaths } from './files.ts';

// An Odd's folder, with a sibling folder beside it that it must never reach.
const top = realpathSync(mkdtempSync(join(tmpdir(), 'oddboro-files-')));
const root = join(top, 'jamal');
const outside = join(top, 'elsewhere');
const put = (path: string): void => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, 'text');
};
put(join(root, 'notes', 'team-note.md'));
put(join(root, 'notes', 'drafts', 'twice.md'));
put(join(root, 'reports', 'twice.md'));
put(join(root, 'top.md'));
put(join(root, 'notes', 'top.md'));
put(join(root, '.claude', 'hidden.md'));
put(join(outside, 'secret.md'));
symlinkSync(outside, join(root, 'linked'));
symlinkSync(join(outside, 'secret.md'), join(root, 'notes', 'pointer.md'));
after(() => rmSync(top, { recursive: true, force: true }));

test('a path inside the folder opens that file, even when a deeper file shares its name', () => {
  assert.equal(fileInFolder(root, 'notes/team-note.md'), join('notes', 'team-note.md'));
  assert.equal(fileInFolder(root, 'top.md'), 'top.md');
  assert.equal(fileInFolder(root, './top.md'), 'top.md');
});

test('a bare name opens the one file with that name, by its real path', () => {
  assert.equal(fileInFolder(root, 'team-note.md'), join('notes', 'team-note.md'));
});

test('a bare name two files share opens nothing', () => {
  assert.equal(fileInFolder(root, 'twice.md'), undefined);
});

test('a path with a folder the Odd does not have opens nothing, even if its name is there', () => {
  assert.equal(fileInFolder(root, 'packages/persona/CLAUDE.md'), undefined);
  assert.equal(fileInFolder(root, 'drafts/team-note.md'), undefined);
});

test('a folder opens nothing', () => {
  assert.equal(fileInFolder(root, 'notes'), undefined);
});

test('a file in a hidden folder is never found by its bare name', () => {
  assert.equal(fileInFolder(root, 'hidden.md'), undefined);
});

test('a file outside the folder never opens, by path, through a link, or by bare name', () => {
  assert.equal(fileInFolder(root, '../elsewhere/secret.md'), undefined);
  assert.equal(fileInFolder(root, 'linked/secret.md'), undefined);
  assert.equal(fileInFolder(root, 'notes/pointer.md'), undefined);
  assert.equal(fileInFolder(root, 'pointer.md'), undefined);
  assert.equal(fileInFolder(root, 'secret.md'), undefined);
});

test('a run reading the owner edit may not write that file, and no run writes its instructions', () => {
  const home = '/h/ziva';
  const reading = deniedEdits(home, [home], 'notes/plan.md');
  assert.ok(reading.includes('/h/ziva/notes/plan.md'));
  assert.ok(reading.includes('/h/ziva/CLAUDE.md'));
  assert.ok(reading.includes('/h/ziva/**/.claude'));
  const other = deniedEdits(home, [home]);
  assert.ok(!other.some((path) => path.includes('plan.md')));
  assert.ok(other.includes('/h/ziva/CLAUDE.md'));
});

test("no run writes Grok's, Codex's or Gemini's instructions, settings, skills or MCP servers either, in any folder it writes", () => {
  const paths = instructionPaths(['/h/ziva', '/t/7/ziva']);
  for (const w of ['/h/ziva', '/t/7/ziva'])
    for (const name of [
      '.grok',
      'AGENTS.md',
      '.mcp.json',
      'AGENTS.override.md',
      '.codex',
      '.agents',
      'GEMINI.md',
      '.gemini'
    ]) {
      assert.ok(paths.includes(`${w}/${name}`), `${w}/${name}`);
      assert.ok(paths.includes(`${w}/**/${name}`), `${w}/**/${name}`);
    }
  // Cursor's setup is switched off in Grok and Cursor is not a tool an Odd runs on.
  assert.ok(!paths.some((path) => path.includes('.cursor')));
});

test('a deny rule holds a path itself and everything under it, for each tool it names', () => {
  assert.deepEqual(denyRules(['Read'], '/g'), ['Read(/g)', 'Read(/g/**)']);
  assert.deepEqual(denyRules(['Edit', 'Write'], '//h/ziva/CLAUDE.md'), [
    'Edit(//h/ziva/CLAUDE.md)',
    'Edit(//h/ziva/CLAUDE.md/**)',
    'Write(//h/ziva/CLAUDE.md)',
    'Write(//h/ziva/CLAUDE.md/**)'
  ]);
});
