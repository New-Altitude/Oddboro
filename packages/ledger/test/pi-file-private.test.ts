import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolveIn, wallsFromEnv, type FileWalls } from '../src/file-walls.ts';

const server = fileURLToPath(new URL('../src/files-server.ts', import.meta.url));
async function withServer(
  walls: unknown,
  run: (
    call: (name: string, args: Record<string, unknown>) => Promise<{ text: string; error: boolean }>
  ) => Promise<void>
) {
  const client = new Client({ name: 'private-fixture', version: '1' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [server],
      env: { PATH: process.env.PATH ?? '', HOME: tmpdir(), ODDBORO_FILES: JSON.stringify(walls) },
      stderr: 'ignore'
    })
  );
  try {
    await run(async (name, args) => {
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 1500 });
      return { text: JSON.stringify(result.content), error: result.isError === true };
    });
  } finally {
    await client.close();
  }
}

test('office MCP hides private files and future paths within a broad readable root', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oddboro-private-files-'));
  const work = join(root, 'work');
  const privateDir = join(work, 'private');
  const future = join(work, 'future-private');
  mkdirSync(privateDir, { recursive: true });
  writeFileSync(join(work, 'visible.txt'), 'PUBLIC-MARKER');
  writeFileSync(join(privateDir, 'hidden.txt'), 'PRIVATE-MARKER');
  let link = false;
  try {
    symlinkSync(privateDir, join(work, 'alias'), 'dir');
    link = true;
  } catch {
    /* no symlink privilege */
  }
  const walls: FileWalls = {
    cwd: work,
    reads: [work],
    writes: [work],
    noWrite: [join(work, '**', 'AGENTS.md'), join(work, 'AGENTS.md')],
    noAccess: [privateDir, future]
  };
  try {
    await withServer(walls, async (call) => {
      const allowed = await call('read_file', { path: 'visible.txt' });
      assert.equal(allowed.error, false);
      assert.match(allowed.text, /PUBLIC-MARKER/);
      for (const path of ['private/hidden.txt', ...(link ? ['alias/hidden.txt'] : [])]) {
        const result = await call('read_file', { path });
        assert.equal(result.error, true);
        assert.doesNotMatch(result.text, /PRIVATE-MARKER/);
      }
      const listing = await call('list_files', { path: '.' });
      assert.equal(listing.error, false);
      assert.doesNotMatch(listing.text, /private|alias/i);
      const find = await call('find_files', { pattern: '*' });
      assert.equal(find.error, false);
      assert.doesNotMatch(find.text, /hidden|private|alias/i);
      const search = await call('search_files', { pattern: 'MARKER' });
      assert.equal(search.error, false);
      assert.match(search.text, /PUBLIC-MARKER/);
      assert.doesNotMatch(search.text, /PRIVATE-MARKER|hidden|private|alias/i);
      assert.equal(
        (await call('write_file', { path: 'private/hidden.txt', content: 'bad' })).error,
        true
      );
      assert.equal(
        (await call('write_file', { path: 'future-private/new.txt', content: 'bad' })).error,
        true
      );
      assert.equal(
        (await call('write_file', { path: 'nested/AGENTS.md', content: 'bad' })).error,
        true
      );
      assert.equal(
        (await call('write_file', { path: 'allowed/new.txt', content: 'good' })).error,
        false
      );
      assert.equal(readFileSync(join(work, 'allowed/new.txt'), 'utf8'), 'good');
      assert.equal(readFileSync(join(privateDir, 'hidden.txt'), 'utf8'), 'PRIVATE-MARKER');
    });
    // A caller that omits noAccess keeps the upstream behavior.
    await withServer({ ...walls, noAccess: undefined }, async (call) => {
      assert.match(
        (await call('read_file', { path: 'private/hidden.txt' })).text,
        /PRIVATE-MARKER/
      );
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('malformed private walls fail closed and case aliases are conservatively denied', () => {
  const root = mkdtempSync(join(tmpdir(), 'oddboro-private-policy-'));
  try {
    const file = join(root, 'public.txt');
    writeFileSync(file, 'public');
    for (const noAccess of [null, 'bad', ['relative/path'], [42], [join(root, 'private'), null]]) {
      const walls = wallsFromEnv({
        ODDBORO_FILES: JSON.stringify({
          cwd: root,
          reads: [root],
          writes: [root],
          noWrite: [],
          noAccess
        })
      });
      assert.ok('refused' in resolveIn(walls, file, 'read'));
    }
    const walls: FileWalls = {
      cwd: root,
      reads: [root],
      writes: [root],
      noWrite: [],
      noAccess: [join(root, 'PRIVATE.txt')]
    };
    assert.ok('refused' in resolveIn(walls, join(root, 'private.txt'), 'write'));
    assert.ok('refused' in resolveIn({ ...walls, noAccess: [file.toUpperCase()] }, file, 'read'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('office MCP refuses an existing FIFO before opening it', async (t) => {
  if (process.platform === 'win32') return t.skip('FIFO fixture requires mkfifo');
  const root = mkdtempSync(join(tmpdir(), 'oddboro-pi-fifo-'));
  try {
    const fifo = join(root, 'pipe');
    const made = spawnSync('mkfifo', [fifo]);
    if (made.error || made.status !== 0) return t.skip('mkfifo is unavailable');
    const walls: FileWalls = {
      cwd: root,
      reads: [root],
      writes: [root],
      noWrite: [],
      noAccess: []
    };
    await withServer(walls, async (call) => {
      const read = await call('read_file', { path: 'pipe' });
      assert.equal(read.error, true);
      assert.match(read.text, /not a regular file or folder/);
      const write = await call('write_file', { path: 'pipe', content: 'no' });
      assert.equal(write.error, true);
      assert.match(write.text, /not a regular file or folder/);
      const search = await call('search_files', { path: '.', pattern: 'nothing' });
      assert.equal(search.error, false);
    });
    // Search also skips special files for existing callers without noAccess.
    await withServer({ cwd: root, reads: [root], writes: [root], noWrite: [] }, async (call) => {
      const search = await call('search_files', { path: '.', pattern: 'nothing' });
      assert.equal(search.error, false);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
