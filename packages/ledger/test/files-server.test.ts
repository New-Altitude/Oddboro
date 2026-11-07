// The office's file tools against a made-up office full of decoys, through
// the real server over stdio as a run starts it (files-server.ts): what an
// Odd may read and change, and every way out it might try. A link, a
// junction, `..`, another case, a hard link, and on Windows a data stream, a
// device name, a network path or a short name all lead nowhere the walls do
// not allow. The same file runs on a Mac, Linux and Windows. Run with
// `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const WIN = process.platform === 'win32';
const SERVER =
  process.env.FILES_SERVER ?? fileURLToPath(new URL('../src/files-server.ts', import.meta.url));

const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'oddboro-files-')));
const office = join(root, 'office');
const ada = join(office, 'staff', 'ada');
const theo = join(office, 'staff', 'theo');
const data = join(office, 'data');
const codexHome = join(office, 'accounts', 'codex', 'office');
const proj = join(root, 'projects', 'site');
for (const d of [
  ada,
  theo,
  data,
  codexHome,
  join(root, 'home', '.ssh'),
  join(proj, '.git', 'hooks'),
  join(proj, 'src')
])
  mkdirSync(d, { recursive: true });
const decoy = (path: string, name: string) => (writeFileSync(path, `DECOY-${name}\n`), path);
const files = {
  own: decoy(join(ada, 'notes.md'), 'own'),
  edited: decoy(join(ada, 'plan.md'), 'edited'),
  data: decoy(join(data, 'people.json'), 'data'),
  theo: decoy(join(theo, 'notes.md'), 'theo'),
  auth: decoy(join(codexHome, 'auth.json'), 'auth'),
  db: decoy(join(office, 'database.bin'), 'db'),
  ssh: decoy(join(root, 'home', '.ssh', 'id_ed25519'), 'ssh'),
  realHome: decoy(join(homedir(), '.oddboro-files-probe-secret'), 'realhome'),
  projFile: decoy(join(proj, 'src', 'app.js'), 'proj')
};
writeFileSync(join(proj, '.git', 'config'), '[core]\n');

// Ways out, planted in the Odd's own folder as a command or the owner might.
const planted: string[] = [];
const plant = (name: string, make: () => void) => {
  try {
    make();
    planted.push(name);
  } catch {
    // A link Windows will not make without Developer Mode: that way out is not there to try.
  }
};
plant('link-theo.md', () => symlinkSync(files.theo, join(ada, 'link-theo.md'), 'file'));
plant('link-codex', () =>
  symlinkSync(codexHome, join(ada, 'link-codex'), WIN ? 'junction' : 'dir')
);
plant('hard-theo.md', () => linkSync(files.theo, join(ada, 'hard-theo.md')));

const walls = {
  cwd: ada,
  reads: [data],
  writes: [ada, proj],
  noWrite: [
    ...['AGENTS.md', 'CLAUDE.md', '.claude', '.codex'].flatMap((n) =>
      [ada, proj].flatMap((w) => [`${w}/${n}`, `${w}/**/${n}`])
    ),
    ...['.git/hooks', '.git/config', '.git/modules'].flatMap((p) => [
      `${proj}/${p}`,
      `${proj}/**/${p}`
    ]),
    files.edited
  ]
};

const client = new Client({ name: 'probe', version: '1.0.0' });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: { ...(process.env as Record<string, string>), ODDBORO_FILES: JSON.stringify(walls) },
    cwd: ada,
    stderr: 'inherit'
  })
);
after(async () => {
  await client.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(files.realHome, { force: true });
});

const call = async (name: string, args: Record<string, unknown>) => {
  const r = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text?: string; data?: string; mimeType?: string }[];
    isError?: boolean;
  };
  return { text: r.content.map((c) => c.text).join('\n'), error: !!r.isError };
};
const reads = async (path: string) => (await call('read_file', { path })).text.includes('DECOY-');
const refusedRead = async (path: string) => {
  const r = await call('read_file', { path });
  assert.ok(r.error && !r.text.includes('DECOY-'), `read ${path} got through: ${r.text}`);
};
const refusedWrite = async (path: string) => {
  const r = await call('write_file', { path, content: 'WROTE' });
  assert.ok(r.error, `write ${path} got through: ${r.text}`);
};

test('the Odd reads and changes its own folder, and reads the data folder', async () => {
  assert.ok(await reads('notes.md'));
  assert.ok(await reads(files.own));
  assert.ok(await reads(files.data));
  assert.ok(!(await call('write_file', { path: 'out/new.md', content: 'hi\n' })).error);
  assert.equal(readFileSync(join(ada, 'out', 'new.md'), 'utf8'), 'hi\n');
  const edit = await call('edit_file', {
    path: 'out/new.md',
    old_string: 'hi',
    new_string: 'hello'
  });
  assert.ok(!edit.error, edit.text);
  assert.equal(readFileSync(join(ada, 'out', 'new.md'), 'utf8'), 'hello\n');
  assert.ok(!(await call('write_file', { path: join(proj, 'src', 'app.js'), content: 'x' })).error);
});

test('a picture comes back as a picture, and a long file pages on', async () => {
  // A 1 by 1 PNG.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  writeFileSync(join(ada, 'dot.png'), png);
  const r = (await client.callTool({ name: 'read_file', arguments: { path: 'dot.png' } })) as {
    content: { type: string; data?: string; mimeType?: string }[];
  };
  assert.equal(r.content[0].type, 'image');
  assert.equal(r.content[0].mimeType, 'image/png');
  assert.equal(r.content[0].data, png.toString('base64'));
  writeFileSync(
    join(ada, 'long.md'),
    Array.from({ length: 5000 }, (_, i) => `line ${i + 1}`).join('\n')
  );
  const first = await call('read_file', { path: 'long.md' });
  assert.match(first.text, /^ *1\tline 1$/m);
  assert.match(first.text, /read on with offset 2001/);
  const next = await call('read_file', { path: 'long.md', offset: 4999 });
  assert.match(next.text, /^4999\tline 4999\n5000\tline 5000$/m);
});

test('nothing outside its folders opens, by any name', async () => {
  for (const p of [
    files.theo,
    files.auth,
    files.db,
    files.ssh,
    files.realHome,
    '../theo/notes.md',
    '../../database.bin'
  ])
    await refusedRead(p);
  // Another case: on a Mac and Windows the same folder, still outside.
  await refusedRead('../THEO/notes.md');
  await refusedRead('../Theo/NOTES.md');
});

test('a link, a junction or a hard link in its own folder leads nowhere', async () => {
  if (planted.includes('link-theo.md')) await refusedRead('link-theo.md');
  if (planted.includes('link-codex')) {
    await refusedRead('link-codex/auth.json');
    assert.ok((await call('list_files', { path: 'link-codex' })).error);
    await refusedWrite('link-codex/new.json');
  }
  if (planted.includes('hard-theo.md')) {
    await refusedRead('hard-theo.md');
    await refusedWrite('hard-theo.md');
  }
});

test('listing, finding and searching stay inside', async () => {
  assert.ok((await call('list_files', { path: '../theo' })).error);
  assert.ok((await call('list_files', { path: office })).error);
  const found = await call('find_files', { pattern: '**/*' });
  assert.ok(!found.text.includes('auth.json'), found.text);
  const hits = await call('search_files', { pattern: 'DECOY-' });
  assert.ok(hits.text.includes('DECOY-own'), hits.text);
  for (const leak of ['DECOY-theo', 'DECOY-auth']) assert.ok(!hits.text.includes(leak), hits.text);
  assert.ok((await call('search_files', { pattern: 'DECOY-', path: '/' })).error);
});

test('the data folder, its instructions, the owner’s edit and git’s places are never written', async () => {
  for (const p of [
    join(data, 'x.json'),
    'AGENTS.md',
    'agents.md',
    'sub/CLAUDE.md',
    '.claude/settings.json',
    '.codex/config.toml',
    'plan.md',
    join(proj, '.git', 'hooks', 'pre-commit'),
    join(proj, '.git', 'config'),
    join(proj, 'AGENTS.md'),
    '../theo/x.md',
    join(homedir(), '.oddboro-files-probe-wrote')
  ])
    await refusedWrite(p);
  assert.ok(!existsSync(join(homedir(), '.oddboro-files-probe-wrote')));
  assert.equal(readFileSync(files.edited, 'utf8'), 'DECOY-edited\n');
});

test(
  'Windows: streams, devices, network paths, short names and trailing dots',
  { skip: !WIN },
  async () => {
    writeFileSync(`${files.own}:hidden`, 'DECOY-stream\n');
    await refusedRead('notes.md:hidden');
    for (const p of ['CON', 'nul.txt', 'COM1', 'aux.md'])
      assert.ok((await call('read_file', { path: p })).error, p);
    await refusedWrite('NUL');
    await refusedRead(`\\\\localhost\\${theo.replace(':', '$')}\\notes.md`);
    await refusedRead(`\\\\?\\${files.theo}`);
    await refusedRead('..\\theo\\notes.md.');
    await refusedWrite('notes.md ');
    // The short name, where the disk makes them.
    try {
      const short = execFileSync('cmd', ['/c', `for %I in ("${files.theo}") do @echo %~sI`], {
        encoding: 'utf8'
      }).trim();
      if (short && short !== files.theo) await refusedRead(short);
    } catch {
      // No short names on this disk.
    }
  }
);
