// A project session's terminal, mounted in a browser-like document against a
// stand-in office: when it asks the session to draw again for it. Claude Code's
// background service draws a session for the window that sized it last, so once
// this terminal or the browser window lost focus, coming back to the terminal
// asks once. Each test moves focus, types and resizes as the owner does, then
// reads the size requests the terminal sent.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { mountedForClient } from './onboarding/mounted-for-client.ts';
import { asked, office, one, settled } from './projects-window-under-test.ts';
import type ProjectTerminalComponent from './ProjectTerminal.svelte';

const here = dirname(fileURLToPath(import.meta.url));

// The stand-in terminal from the mount helper, which keeps each one opened, so a
// test can change its size as a refit would.
const { Terminal } = (await import('@xterm/xterm')) as unknown as {
  Terminal: { prototype: { open(host: HTMLElement): void } };
};
const opened: { cols: number }[] = [];
const open = Terminal.prototype.open;
Terminal.prototype.open = function (this: { cols: number }, host: HTMLElement) {
  opened.push(this);
  open.call(this, host);
};
// The document never lays anything out, so a box change is the test's to make:
// it calls what the terminal gave the observer, as a panel drag does.
let observed = () => {};
globalThis.ResizeObserver = class {
  constructor(changed: () => void) {
    observed = changed;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

/** Lets the size the terminal settles on go out: it waits 150 ms after the last change. */
const settledSize = () => new Promise((r) => setTimeout(r, 200));

/** The terminal for session-1, taking the typing, with its box and what it sent. */
async function terminal() {
  office();
  opened.length = 0;
  const shown = await mountedForClient<typeof ProjectTerminalComponent>(
    join(here, 'ProjectTerminal.svelte'),
    { id: 'session-1', view: 'view-1', writable: true, onerror: () => {}, onstream: () => {} }
  );
  await settled(shown);
  const screen = one<HTMLElement>(shown.target, '.xterm');
  const host = screen.parentElement;
  assert.ok(host, 'the terminal sits in its box');
  // xterm stops every key it sends to the terminal from going further.
  screen.addEventListener('keydown', (e) => e.stopPropagation());
  return {
    shown,
    host,
    focus: () => screen.dispatchEvent(new FocusEvent('focusin', { bubbles: true })),
    leave: () => screen.dispatchEvent(new FocusEvent('focusout', { bubbles: true })),
    type: () => screen.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })),
    /** The box at a size, and the terminal refitted to `cols` in it. */
    resize: (cols: number) => {
      for (const side of ['clientWidth', 'clientHeight'])
        Object.defineProperty(host, side, { value: 600, configurable: true });
      opened[0].cols = cols;
      observed();
    }
  };
}
const leaveWindow = () => window.dispatchEvent(new Event('blur'));
const REDRAW = {
  action: 'size',
  id: 'session-1',
  view: 'view-1',
  cols: 80,
  rows: 24,
  redraw: true
};

test('Coming back to the terminal after focus left it asks the session to draw again, once', async (t) => {
  const ways = [
    { name: 'the terminal', lost: (on: Awaited<ReturnType<typeof terminal>>) => on.leave() },
    { name: 'the browser window', lost: () => leaveWindow() }
  ];
  for (const { name, lost } of ways) {
    await t.test(`after ${name} lost focus`, async () => {
      const on = await terminal();
      try {
        lost(on);
        on.focus();
        assert.deepEqual(asked('size'), [REDRAW], 'one redraw as the terminal takes focus');
        on.focus();
        on.type();
        assert.deepEqual(asked('size'), [REDRAW], 'none again with no focus lost since');
      } finally {
        await on.shown.unmount();
      }
    });
  }
});

test('Focus and typing with no focus lost since ask for nothing', async () => {
  const on = await terminal();
  try {
    on.focus();
    on.type();
    assert.deepEqual(asked('size'), []);
  } finally {
    await on.shown.unmount();
  }
});

test('The first key after focus left asks once, though xterm keeps the key to itself', async () => {
  const on = await terminal();
  try {
    leaveWindow();
    on.type();
    assert.deepEqual(asked('size'), [REDRAW], 'one redraw on the first key');
    on.type();
    assert.deepEqual(asked('size'), [REDRAW], 'none on the next');
  } finally {
    await on.shown.unmount();
  }
});

test('A new size, as Focus or a panel drag sends, needs no redraw after it, and the same size does', async () => {
  const on = await terminal();
  try {
    on.resize(80);
    await settledSize();
    leaveWindow();
    on.resize(100);
    await settledSize();
    on.focus();
    assert.deepEqual(
      asked('size').map((s) => [s.cols, s.redraw]),
      [
        [80, undefined],
        [100, undefined]
      ],
      'the new size alone'
    );

    leaveWindow();
    on.resize(100);
    await settledSize();
    on.focus();
    assert.deepEqual(
      asked('size').map((s) => [s.cols, s.redraw]),
      [
        [80, undefined],
        [100, undefined],
        [100, true]
      ],
      'the same size sends nothing, so coming back redraws'
    );
  } finally {
    await on.shown.unmount();
  }
});
