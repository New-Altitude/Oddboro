// Run after stage.ts. Use the shipped Node and native library on this machine.
// The fixture echoes its input and terminal size without launching a shell.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const binaries = join(desktop, 'src-tauri', 'binaries');
const runtime = readdirSync(binaries).find((name) => name.startsWith('node-'));
assert.ok(runtime, 'Stage the desktop before checking its terminal.');
const result = spawnSync(
  join(binaries, runtime),
  [
    '--input-type=commonjs',
    '-e',
    `
const assert = require('node:assert/strict');
const {spawn} = require('node-pty');
const child = spawn(process.execPath, ['-e',
  "process.stdin.setEncoding('utf8');process.stdin.once('data',v=>{console.log('RECEIVED:'+v.trim()+':'+process.stdout.columns);process.exit(0)});console.log('READY')"
], {cwd:process.cwd(),env:process.env,cols:80,rows:24});
let output='', sent=false;
const timeout=setTimeout(()=>{child.kill();process.exit(1)},12000);
child.onData(s=>{
  output+=s;
  if(!sent && output.includes('READY')){
    sent=true;
    child.resize(92,30);
    child.write('office-check\\r');
  }
});
child.onExit(({exitCode})=>{
  clearTimeout(timeout);
  assert.equal(exitCode,0);
  assert.match(output,/RECEIVED:office-check:92/);
  console.log('Bundled terminal passed input and resize.');
});
`
  ],
  { cwd: join(desktop, 'stage'), stdio: 'inherit', timeout: 18000 }
);
if (result.error) throw result.error;
assert.equal(result.status, 0);
