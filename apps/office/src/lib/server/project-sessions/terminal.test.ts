// The office's terminal on the real terminal library, with a stand-in
// `claude`: a Node program that writes each size it reads on a resize, so a
// test sees what a program inside the terminal sees, not only what the office
// asked for.
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { ProjectTerminal } from './terminal.ts';

const bin = mkdtempSync(join(tmpdir(), 'oddboro-terminal-'));
const child = join(bin, 'child.mjs');
// Plain writes, not console.log, which colours numbers in a terminal.
writeFileSync(
  child,
  `const size = () => process.stdout.columns + 'x' + process.stdout.rows;
process.stdout.write('ready ' + size() + '\\n');
process.stdout.on('resize', () => process.stdout.write('resize ' + size() + '\\n'));
setInterval(() => {}, 1000);
`
);
writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${child}"\n`);
chmodSync(join(bin, 'claude'), 0o755);
// The office opens a bare `claude` found through PATH. Only the stand-in's
// folder is on it, so no other claude on this computer can start.
process.env.PATH = bin;
after(() => rmSync(bin, { recursive: true, force: true }));

/** Whether the terminal's screen matches `pattern` within `ms`. */
function shows(t: ProjectTerminal, pattern: RegExp, ms: number) {
  return new Promise<boolean>((resolve) => {
    const done = (found: boolean) => {
      clearTimeout(limit);
      t.events.off('data', check);
      resolve(found);
    };
    const check = () => {
      if (pattern.test(t.screen)) done(true);
    };
    const limit = setTimeout(() => done(false), ms);
    t.events.on('data', check);
    check();
  });
}

test(
  'A redraw makes a program in the terminal see its size change, and leaves it at the size the page sent',
  { skip: process.platform === 'win32' && 'the stand-in claude is a shell script' },
  async () => {
    const t = await ProjectTerminal.open('claude', [], bin);
    try {
      assert.ok(await shows(t, /ready 100x30/, 10_000), t.screen);
      t.redraw(100, 30);
      // The restore's resize is the last a redraw sends.
      await shows(t, /resize 100x30/, 3000);
      const sizes = [...t.screen.matchAll(/resize (\d+x\d+)/g)].map((m) => m[1]);
      assert.ok(sizes.length > 0, 'the program saw no resize');
      assert.equal(sizes.at(-1), '100x30');
    } finally {
      await t.releaseProcess();
    }
  }
);
