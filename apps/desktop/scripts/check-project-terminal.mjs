// Run after stage.ts. Both the terminal and its child use the shipped Node.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { WriteStream } from 'node:tty';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const desktop = fileURLToPath(new URL('../', import.meta.url));
const stage = join(desktop, 'stage');

function echoInput() {
  process.stdin.setEncoding('utf8');
  process.stdin.once('data', (input) => {
    // A fresh stream reads the current size. Windows can still have the startup
    // size cached on process.stdout when the input arrives after a resize.
    const [cols, rows] = new WriteStream(1).getWindowSize();
    process.stdout.write(`RECEIVED:${input.trim()}:${cols}x${rows}\n`, () => process.exit(0));
  });
  console.log(`READY:${process.stdout.columns}x${process.stdout.rows}`);
}

function checkTerminal(stop) {
  const { openProjectTerminal } = createRequire(join(stage, 'package.json'))(
    '@oddboro/ledger/project-terminal'
  );
  const child = openProjectTerminal(process.execPath, [script, 'echo'], {
    cwd: stage,
    cols: 80,
    rows: 24
  });
  let output = '';
  let sent = false;
  const timeout = setTimeout(() => {
    child.kill();
    throw new Error(`Timed out waiting for the bundled terminal: ${JSON.stringify(output)}`);
  }, 12000);
  child.onData((data) => {
    output += data;
    if (!sent && output.includes('READY:80x24')) {
      sent = true;
      if (stop) return child.kill();
      child.resize(92, 30);
      child.write('office-check\r');
    }
  });
  child.onExit(({ exitCode }) => {
    clearTimeout(timeout);
    assert.ok(sent, 'Terminal exited before the check started.');
    if (stop) return console.log('Bundled terminal stopped on request.');
    assert.equal(exitCode, 0);
    assert.match(output, /RECEIVED:office-check:92x30/);
    console.log('Bundled terminal passed input and resize.');
  });
}

if (process.argv[2] === 'echo') echoInput();
else if (process.argv[2] === 'check') checkTerminal(false);
else if (process.argv[2] === 'check-stop') checkTerminal(true);
else {
  const binaries = join(desktop, 'src-tauri', 'binaries');
  const runtime = readdirSync(binaries).find((name) => name.startsWith('node-'));
  assert.ok(runtime, 'Stage the desktop before checking its terminal.');
  for (const mode of ['check', 'check-stop']) {
    const result = spawnSync(join(binaries, runtime), [script, mode], {
      cwd: stage,
      stdio: 'inherit',
      timeout: 18000
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0);
  }
}
