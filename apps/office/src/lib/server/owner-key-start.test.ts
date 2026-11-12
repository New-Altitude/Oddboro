// A damaged key file stops the office's start with the one sentence that says
// what to do, and no stack. The app's failure dialog shows the end of the
// office's log, so that sentence must be its last line. Each start runs in a
// process of its own, since it ends that process.
// Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { tempOffice } from './diagnostics-harness.ts';

const { folder } = tempOffice('owner-key-start');
after(() => rmSync(folder, { recursive: true, force: true }));
const keyFile = join(folder, 'owner-key');
writeFileSync(keyFile, 'not an owner key\n', { mode: 0o600 });

const office = join(import.meta.dirname, '..', '..', '..');
const url = (path: string) => JSON.stringify(pathToFileURL(join(office, path)).href);

/** Run `script` as a module in a process of its own, as this office: its exit code, and stdout and stderr as one log, in order. */
function start(script: string): Promise<{ code: number | null; lines: string[] }> {
  const env = { ...process.env };
  // A child that inherits it runs as a test and prints nothing of its own.
  delete env.NODE_TEST_CONTEXT;
  // With it set, the start would bring up a real database.
  delete env.ODDBORO_LOCAL_DB;
  const child = spawn(
    process.execPath,
    ['--import', '@oddboro/ledger/test-defaults', '--input-type=module', '--eval', script],
    { cwd: office, env }
  );
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  return new Promise((done, fail) => {
    child.on('error', fail);
    child.on('close', (code) =>
      done({ code, lines: log.split('\n').filter((l) => l.trim() !== '') })
    );
  });
}

const SENTENCE = `${keyFile} does not hold an owner key. Move it aside and start the office again.`;

function showsOnlyTheSentence({ code, lines }: { code: number | null; lines: string[] }) {
  assert.notEqual(code, 0, 'the start went on');
  assert.equal(lines.at(-1), SENTENCE, lines.join('\n'));
  assert.deepEqual(
    lines.filter((l) => /^\s+at /.test(l)),
    [],
    'the log holds stack frames'
  );
}

test('with a damaged key file, a release start (Kit awaiting init) prints only the sentence saying to move it aside, and exits with an error', async () => {
  // adapter-node's handler awaits the server's init at the top of a module, so this does too.
  showsOnlyTheSentence(await start(`await (await import(${url('src/hooks.server.ts')})).init();`));
});

test('with a damaged key file, a dev start (Vite making its server with the office plugin) prints only the sentence saying to move it aside, and exits with an error', async () => {
  // Vite runs each plugin's configureServer as it makes the server, before it listens.
  showsOnlyTheSentence(
    await start(
      `const { createServer } = await import('vite');
       const { ownerOnly } = await import(${url('vite.config.ts')});
       await createServer({ configFile: false, root: ${JSON.stringify(folder)}, logLevel: 'silent',
         appType: 'custom', server: { watch: null }, plugins: [ownerOnly()] });`
    )
  );
});
