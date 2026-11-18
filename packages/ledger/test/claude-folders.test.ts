// The owner's Claude Code folders (`claude-folders.ts`): `~/.claude` always,
// then each one named in Setup, each shut to Odds from the moment it is named.
// The office's claude-folders.test.ts holds the Setup route that names them.
// Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, parse, sep } from 'node:path';
import { after, test } from 'node:test';
import { TEMP_IN_APPDATA } from './store-states.ts';

const tmp = mkdtempSync(join(tmpdir(), 'claude-folders-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
// env.ts fixes its file as it loads, so this comes first: no test writes the real .env.
process.env.ODDBORO_ENV = join(tmp, 'test.env');
await import('./pglite.ts');
const {
  CLAUDE_FOLDERS_KEY,
  claudeConfigDir,
  claudeFolderEnv,
  claudeFolders,
  defaultClaudeFolder,
  isClaudeFolder,
  setClaudeFolders
} = await import('../src/claude-folders.ts');
const { readEnv } = await import('../src/env.ts');
const { holdsTooMuch, touchesSecretStore } = await import('../src/office-folders.ts');

/** A folder of the test's own, made now. */
function made(name: string): string {
  const p = join(tmp, name);
  mkdirSync(p, { recursive: true });
  return p;
}

test('a named Claude folder is refused to Odds at once', { skip: TEMP_IN_APPDATA }, () => {
  const named = made('claude-b');
  // Made first: a missing path keeps its own spelling, which on a Mac is not the real one.
  const inside = made(join('claude-b', 'x'));
  setClaudeFolders([]);
  assert.equal(touchesSecretStore(inside), false);
  setClaudeFolders([realpathSync.native(named)]);
  assert.equal(touchesSecretStore(inside), true);
  assert.equal(touchesSecretStore(named), true);
  assert.equal(touchesSecretStore(tmp), true, 'a folder that holds one is refused too');
  setClaudeFolders([]);
  assert.equal(touchesSecretStore(inside), false);
});

test('~/.claude comes first, then each named folder once in the order named, a missing one kept', () => {
  const b = made('claude-order-b');
  const c = made('claude-order-c');
  const missing = join(tmp, 'not-mounted', '.claude');
  setClaudeFolders([
    ` ${c} `,
    'relative/.claude',
    missing,
    defaultClaudeFolder(),
    realpathSync.native(c),
    `${c}${sep}`,
    b
  ]);
  assert.deepEqual(claudeFolders(), [defaultClaudeFolder(), c, missing, b]);
  setClaudeFolders([]);
  assert.equal(readEnv()[CLAUDE_FOLDERS_KEY], undefined, 'an empty list takes the key out');
  assert.deepEqual(claudeFolders(), [defaultClaudeFolder()]);
});

test('only a folder on the list is a Claude folder, by any spelling of it', () => {
  const b = made('claude-member-b');
  setClaudeFolders([b]);
  assert.equal(isClaudeFolder(b), true);
  assert.equal(isClaudeFolder(realpathSync.native(b)), true);
  assert.equal(isClaudeFolder(defaultClaudeFolder()), true);
  assert.equal(isClaudeFolder(made('claude-member-other')), false);
  assert.equal(isClaudeFolder('claude-member-b'), false, 'a relative path is never one');
  setClaudeFolders([]);
  assert.equal(isClaudeFolder(b), false);
});

test('~/.claude runs with no CLAUDE_CONFIG_DIR however it is spelled, and a named folder with its own', () => {
  const realDefault = join(realpathSync.native(homedir()), '.claude');
  assert.equal(claudeConfigDir(defaultClaudeFolder()), undefined);
  assert.equal(claudeConfigDir(realDefault), undefined, 'missing, by its real home');
  mkdirSync(defaultClaudeFolder(), { recursive: true });
  try {
    assert.equal(claudeConfigDir(realDefault), undefined, 'there, by its real home');
    const b = made('claude-env-b');
    assert.equal(claudeConfigDir(b), b);

    const base = { PATH: '/bin', CLAUDE_CONFIG_DIR: '/from/the/office' };
    const env = claudeFolderEnv(realDefault, base);
    assert.equal('CLAUDE_CONFIG_DIR' in env, false);
    assert.equal(env.PATH, '/bin');
    assert.equal(claudeFolderEnv(b, base).CLAUDE_CONFIG_DIR, b);
    assert.equal(base.CLAUDE_CONFIG_DIR, '/from/the/office', 'the base is left as it was');
  } finally {
    rmSync(defaultClaudeFolder(), { recursive: true, force: true });
  }
});

test('Setup refuses as a Claude folder a whole drive, and a folder holding one it must keep, never one beside or inside it', () => {
  const kept = made(join('holds', 'kept'));
  const holds = realpathSync.native(join(tmp, 'holds'));
  const keep = [realpathSync.native(kept)];
  // A Mac has one root, and it holds the home, so the root alone shows the drive rule.
  assert.equal(holdsTooMuch(parse(process.cwd()).root, []), true, 'a drive');
  assert.equal(holdsTooMuch(holds, keep), true, 'holds a kept folder');
  assert.equal(holdsTooMuch(keep[0], keep), true, 'is the kept folder');
  assert.equal(holdsTooMuch(realpathSync.native(made(join('holds', 'kept', 'in'))), keep), false);
  assert.equal(holdsTooMuch(realpathSync.native(made('beside')), keep), false);
});
