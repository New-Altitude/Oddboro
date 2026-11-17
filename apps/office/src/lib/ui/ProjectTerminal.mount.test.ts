// A project session's terminal, mounted in a browser-like document against a
// stand-in office: when it resizes, and when it asks the session to draw again
// for it. Claude Code's background service draws a session for the window that
// sized it last, so once this terminal or the browser window lost focus, coming
// back to the terminal asks once. Each test moves focus, types and resizes as
// the owner does, then reads the sizes the terminal took and sent.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { mountedForClient } from './onboarding/mounted-for-client.ts';
import {
  asked,
  office,
  one,
  refused,
  settled,
  streamAt,
  type Answer
} from './projects-window-under-test.ts';
import type ProjectTerminalComponent from './ProjectTerminal.svelte';

const here = dirname(fileURLToPath(import.meta.url));

// The stand-in terminal from the mount helper, which keeps each one opened, so a
// fit can size it, and what it sends the session as `send`, as xterm's own
// replies and the owner's keys go.
type Opened = { cols: number; rows: number };
type OnData = (listener: (data: string) => void) => { dispose(): void };
const { Terminal } = (await import('@xterm/xterm')) as unknown as {
  Terminal: { prototype: { open(host: HTMLElement): void } };
};
const opened: Opened[] = [];
let send: (data: string) => void = (data) => assert.fail(`nothing listens for ${data}`);
const open = Terminal.prototype.open;
Terminal.prototype.open = function (this: Opened & { onData: OnData }, host: HTMLElement) {
  opened.push(this);
  this.onData = (listener) => ((send = listener), { dispose() {} });
  open.call(this, host);
};
// A fit sizes the terminal to the cells its box holds, as xterm's fit does. The
// document lays nothing out, so the box is the test's to set, and each size a
// fit changed the terminal to is kept, since xterm drops what a narrower size cuts.
const { FitAddon } = (await import('@xterm/addon-fit')) as unknown as {
  FitAddon: { prototype: { fit(): void } };
};
let box: Opened = { cols: 0, rows: 0 };
const fitted: string[] = [];
FitAddon.prototype.fit = () => {
  const term = opened[0];
  if (term.cols === box.cols && term.rows === box.rows) return;
  Object.assign(term, box);
  fitted.push(`${box.cols}x${box.rows}`);
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

/**
 * The terminal for session-1, taking the typing, against an office answering
 * anything else with `more`, with its box, what it sent and the errors it showed.
 */
async function terminal(more?: Answer) {
  office({ more });
  opened.length = 0;
  fitted.length = 0;
  const errors: string[] = [];
  const shown = await mountedForClient<typeof ProjectTerminalComponent>(
    join(here, 'ProjectTerminal.svelte'),
    {
      id: 'session-1',
      view: 'view-1',
      writable: true,
      onerror: (text) => errors.push(text),
      onstream: () => {}
    }
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
    errors,
    focus: () => screen.dispatchEvent(new FocusEvent('focusin', { bubbles: true })),
    leave: () => screen.dispatchEvent(new FocusEvent('focusout', { bubbles: true })),
    type: () => screen.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })),
    /** The box changing to hold `cols` by `rows` cells, as a panel drag does. 0 by 0 is a hidden pane. */
    resize: (cols: number, rows = 24) => {
      box = { cols, rows };
      Object.defineProperty(host, 'clientWidth', { value: cols, configurable: true });
      Object.defineProperty(host, 'clientHeight', { value: rows, configurable: true });
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

test('A panel sliding back to the size sent never resizes the terminal and sends no size', async () => {
  const on = await terminal();
  try {
    on.resize(138, 37);
    await settledSize();
    assert.equal(asked('size').length, 1, 'the settled size, sent once');
    fitted.length = 0;
    // Projects to Services and back: a hidden pane, then the slide back in.
    for (const [cols, rows] of [
      [0, 0],
      [46, 37],
      [25, 34],
      [33, 34],
      [42, 35],
      [54, 37],
      [138, 37]
    ])
      on.resize(cols, rows);
    await settledSize();
    assert.deepEqual(fitted, [], 'no size on the way');
    assert.equal(asked('size').length, 1, 'nothing more sent');
  } finally {
    await on.shown.unmount();
  }
});

test('A box settling at a new size resizes the terminal and sends that size once', async () => {
  const on = await terminal();
  try {
    on.resize(100, 30);
    on.resize(90, 28);
    on.resize(120, 31);
    await settledSize();
    assert.deepEqual(fitted, ['120x31']);
    assert.deepEqual(
      asked('size').map(({ cols, rows }) => ({ cols, rows })),
      [{ cols: 120, rows: 31 }]
    );
  } finally {
    await on.shown.unmount();
  }
});

test('Rows that shrink and grow back while the box moves change nothing', async () => {
  const on = await terminal();
  try {
    on.resize(138, 37);
    await settledSize();
    fitted.length = 0;
    on.resize(138, 34);
    on.resize(138, 37);
    await settledSize();
    assert.deepEqual(fitted, []);
    assert.equal(asked('size').length, 1, 'only the first settled size');
  } finally {
    await on.shown.unmount();
  }
});

test('Taking the typing fits and sends the size at once, and a view without it sends none', async () => {
  const on = await terminal();
  try {
    const control = (takes: boolean) => {
      streamAt('/api/project-sessions/session-1/events?terminal=1').send('control', takes);
      on.shown.flush();
    };
    control(false);
    on.resize(130, 33);
    await settledSize();
    assert.deepEqual(fitted, ['130x33'], 'a view without the typing still fits');
    assert.deepEqual(asked('size'), [], 'and sends no size');

    control(true);
    assert.deepEqual(
      asked('size').map(({ cols, rows }) => ({ cols, rows })),
      [{ cols: 130, rows: 33 }],
      'sent with no wait for the box to settle'
    );
  } finally {
    await on.shown.unmount();
  }
});

test('A reply the terminal sent as its view closed shows no error once the view is gone', async () => {
  let answer: (reply: Response) => void = () => {};
  const on = await terminal((s) =>
    s.action === 'keys' ? new Promise<Response>((r) => (answer = r)) : {}
  );
  let gone = false;
  try {
    // xterm's focus report as the click that lets the session go takes focus.
    send('\x1b[O');
    await settled(on.shown);
    assert.deepEqual(
      asked('keys').map((s) => s.data),
      ['\x1b[O'],
      'sent before the view closed'
    );
    await on.shown.unmount();
    gone = true;
    answer(refused('Connect this session first.'));
    await settled(on.shown);
    assert.deepEqual(on.errors, []);
  } finally {
    if (!gone) await on.shown.unmount();
  }
});
