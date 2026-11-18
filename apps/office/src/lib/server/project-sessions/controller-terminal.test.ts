// A project session's terminal view, through the controller the project
// route drives: reopening it, and the size the page sets. The stand-in claude
// and terminal library are in controller-background-under-test.ts.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  c,
  claudeFolder,
  request,
  resized,
  SHELL_STAND_IN
} from './controller-background-under-test.ts';
import { app } from './controller-under-test.ts';

test('Opening the terminal again clears the note that it closed', SHELL_STAND_IN, async () => {
  const dir = claudeFolder('.claude-reopen');
  writeFileSync(join(dir, 'start-id'), randomUUID());
  const s = await c.connect('claude', app, { configDir: dir, title: 'Work' });
  (await c.terminal(s.id)).close();
  assert.equal(c.view(s.id)?.note, 'Terminal closed. You can reopen the conversation.');
  await c.terminal(s.id);
  assert.equal(c.view(s.id)?.note, 'Connected');
});

test(
  'A size from the page resizes the terminal once, and a redraw holds it one column wider for 30 ms, unless a newer size comes first',
  SHELL_STAND_IN,
  async (t) => {
    const dir = claudeFolder('.claude-size');
    writeFileSync(join(dir, 'start-id'), randomUUID());
    const s = await c.connect('claude', app, { configDir: dir, title: 'Work' });
    const terminal = await c.terminal(s.id);
    const view = randomUUID();
    const post = async (body: object) => {
      const answer = await request('/api/project-sessions', 'POST', {
        body: { id: s.id, view, ...body }
      });
      assert.ok(answer.ok, await answer.text());
    };
    await post({ action: 'control' });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    /** Each size set since the last call, after `ms` more of the clock. */
    const sizes = (ms = 0) => {
      t.mock.timers.tick(ms);
      return resized.splice(0);
    };
    sizes();
    await post({ action: 'size', cols: 100, rows: 30 });
    assert.deepEqual(sizes(1000), [[100, 30]]);

    await post({ action: 'size', cols: 100, rows: 30, redraw: true });
    assert.deepEqual(sizes(29), [[101, 30]]);
    assert.deepEqual(sizes(1), [[100, 30]]);

    terminal.redraw(100, 30);
    terminal.redraw(100, 30);
    assert.deepEqual(sizes(1000), [
      [101, 30],
      [101, 30],
      [100, 30]
    ]);

    terminal.redraw(100, 30);
    terminal.resize(120, 40);
    assert.deepEqual(sizes(1000), [
      [101, 30],
      [120, 40]
    ]);

    terminal.redraw(100, 30);
    terminal.close();
    assert.deepEqual(sizes(1000), [[101, 30]]);
  }
);

test(
  "The window that opens a session's terminal takes its typing before any other window's stream connects",
  SHELL_STAND_IN,
  async () => {
    const dir = claudeFolder('.claude-opener');
    writeFileSync(join(dir, 'start-id'), randomUUID());
    const s = await c.connect('claude', app, { configDir: dir, title: 'Work' });
    const [a, b] = [randomUUID(), randomUUID()];
    const open = async (view: string) => {
      const answer = await request('/api/project-sessions', 'POST', {
        body: { action: 'terminal', id: s.id, view }
      });
      assert.ok(answer.ok, await answer.text());
    };
    await open(a);
    const opened = c.openTerminal(s.id);
    assert.ok(opened.controls(a));
    assert.equal(opened.take(b), false);

    // Open terminal in another window while it runs moves the typing there.
    await open(b);
    assert.equal(c.openTerminal(s.id), opened);
    assert.ok(opened.controls(b));

    // Work an Odd sends opens the terminal for no window.
    opened.close();
    assert.equal((await c.terminal(s.id)).take(b), true);
  }
);
