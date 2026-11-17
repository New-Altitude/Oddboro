// The Projects window mounted in a browser-like document, against a stand-in
// office: Focus, Reconnect's Move here, Disconnect, and Claude Code's setup question
// answering a Start the owner has since changed or left for a session. Each test clicks and types as
// the owner does and reads what the window then shows.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROJECT_WORDS } from '../project-words.ts';
import {
  button,
  buttons,
  described,
  enterFolder,
  FOLDERS,
  office,
  one,
  pick,
  projectsWindow,
  refused,
  sameElement,
  sent,
  settled
} from './projects-window-under-test.ts';
import { rememberFocus } from './projects-focus.ts';

const NATIVE = '11111111-0000-4000-8000-000000000000';
const SESSION = {
  id: 'session-1',
  agent: 'claude',
  folder: '/work/app',
  title: 'Fix the build',
  nativeId: NATIVE,
  staffId: null,
  configDir: null,
  sendsUnasked: null,
  status: 'idle',
  connected: true,
  mark: null
};
const viewOf = (connected: boolean, terminal: boolean) => ({
  connected,
  terminal,
  note: connected ? 'Connected' : 'Not connected',
  folderNotice: null,
  reply: ''
});

const titleRow = (root: Element) => root.querySelector('header h2')?.textContent ?? null;
const sessionList = (root: Element) => root.querySelector('nav[aria-label="Sessions"]');

test('Focus folds away the Projects title row and the session list only while a connected session’s terminal shows', async (t) => {
  await t.test(
    'pressing Focus on a terminal folds both away, and again brings them back',
    async () => {
      rememberFocus(false);
      office({ sessions: [SESSION], view: viewOf(true, true) });
      const shown = await projectsWindow();
      try {
        assert.ok(shown.target.querySelector('.term .xterm'), 'the session’s terminal shows');
        sameElement(shown.target.querySelector('[role="alert"]'), null, 'with no error');
        assert.equal(titleRow(shown.target), 'Projects');
        assert.ok(sessionList(shown.target));
        const focus = button(shown.target, PROJECT_WORDS.focus);
        assert.equal(focus.getAttribute('aria-label'), 'Focus: fill the window with the terminal');
        assert.ok(
          focus.getAttribute('aria-label')?.startsWith(focus.textContent?.trim() ?? '\u0000'),
          'its name starts with the word it shows'
        );
        assert.equal(focus.getAttribute('aria-pressed'), 'false');

        focus.click();
        shown.flush();
        assert.equal(titleRow(shown.target), null);
        sameElement(sessionList(shown.target), null, 'no session list');
        assert.equal(focus.getAttribute('aria-pressed'), 'true');

        focus.click();
        shown.flush();
        assert.equal(titleRow(shown.target), 'Projects');
        assert.ok(sessionList(shown.target));
      } finally {
        await shown.unmount();
      }
    }
  );

  await t.test('the choice is read as the window opens, and kept for the next', async () => {
    rememberFocus(true);
    office({ sessions: [SESSION], view: viewOf(true, true) });
    const shown = await projectsWindow();
    try {
      assert.equal(titleRow(shown.target), null);
      sameElement(sessionList(shown.target), null, 'no session list');
      button(shown.target, PROJECT_WORDS.focus).click();
      shown.flush();
      assert.equal(localStorage.getItem('oddboro.projects.focus'), '0');
    } finally {
      await shown.unmount();
    }
  });

  const unfocusable = [
    { name: 'with no session', sessions: [], view: undefined },
    { name: 'with a session not connected', sessions: [SESSION], view: viewOf(false, false) },
    {
      name: 'with a session whose terminal is closed',
      sessions: [SESSION],
      view: viewOf(true, false)
    }
  ];
  for (const { name, sessions, view } of unfocusable) {
    await t.test(`both stay, Focus chosen or not, ${name}`, async () => {
      rememberFocus(true);
      office({ sessions, view });
      const shown = await projectsWindow();
      try {
        assert.equal(titleRow(shown.target), 'Projects');
        assert.ok(sessionList(shown.target));
        assert.deepEqual(
          buttons(shown.target, PROJECT_WORDS.focus).map(described),
          [],
          'no Focus to press'
        );
      } finally {
        await shown.unmount();
      }
    });
  }
  rememberFocus(false);
});

/** The session's conversation as a list finds it: open in a terminal, and `movable` or not. */
const inTerminal = (movable: boolean) => ({
  id: NATIVE,
  title: 'Fix the build',
  live: true,
  updated: 0,
  ...(movable && { movable })
});
/** The session in the list whose title is `title`. */
const rowOf = (root: Element, title: string) => {
  const found = [...root.querySelectorAll('[role="option"]')].filter((o) =>
    o.textContent?.includes(title)
  );
  assert.equal(found.length, 1, `one session row for "${title}"`);
  return found[0] as HTMLElement;
};

test('Reconnect on a conversation open in a terminal asks before moving it here', async (t) => {
  await t.test('one the office can move shows the confirm in place of Reconnect', async () => {
    office({
      sessions: [SESSION],
      view: viewOf(false, false),
      more: (s) => (s.action === 'find' ? [inTerminal(true)] : {})
    });
    const shown = await projectsWindow();
    try {
      const body = one(shown.target, '.term');
      button(body, 'Reconnect').click();
      await settled(shown);

      const confirm = body.querySelector('[role="alertdialog"]');
      assert.ok(confirm, 'the confirm shows');
      assert.match(confirm.textContent ?? '', new RegExp(PROJECT_WORDS.moveConfirm.slice(0, 40)));
      assert.deepEqual(buttons(body, 'Reconnect').map(described), [], 'in place of Reconnect');
      assert.deepEqual(buttons(body, 'Remove').map(described), [], 'and Remove');
      assert.equal(
        sent.some((s) => s.action === 'connect'),
        false,
        'nothing moves before the yes'
      );

      button(confirm, PROJECT_WORDS.moveButton).click();
      await settled(shown);
      const connect = sent.find((s) => s.action === 'connect');
      assert.equal(connect?.nativeId, NATIVE);
      assert.equal(connect?.move, true);
      sameElement(body.querySelector('[role="alertdialog"]'), null, 'the confirm closes');
    } finally {
      await shown.unmount();
    }
  });

  await t.test('one it cannot move connects at once and shows the office’s words', async () => {
    office({
      sessions: [SESSION],
      view: viewOf(false, false),
      more: (s) => {
        if (s.action === 'find') return [inTerminal(false)];
        if (s.action === 'connect') return refused(PROJECT_WORDS.windows);
        return {};
      }
    });
    const shown = await projectsWindow();
    try {
      const body = one(shown.target, '.term');
      button(body, 'Reconnect').click();
      await settled(shown);
      sameElement(body.querySelector('[role="alertdialog"]'), null, 'no confirm');
      assert.equal(sent.find((s) => s.action === 'connect')?.move, undefined);
      assert.equal(body.querySelector('[role="alert"] p')?.textContent, PROJECT_WORDS.windows);
    } finally {
      await shown.unmount();
    }
  });
});

test('The move confirm shows only on the session it was opened for', async () => {
  const other = {
    ...SESSION,
    id: 'session-2',
    nativeId: NATIVE.replace('1111', '2222'),
    title: 'Write the docs'
  };
  office({
    sessions: [SESSION, other],
    view: viewOf(false, false),
    more: (s) => (s.action === 'find' ? [inTerminal(true)] : {})
  });
  const shown = await projectsWindow();
  try {
    const confirm = () => shown.target.querySelector('.term [role="alertdialog"]');
    button(one(shown.target, '.term'), 'Reconnect').click();
    await settled(shown);
    assert.ok(confirm(), 'the confirm shows on the session it was opened for');

    rowOf(shown.target, other.title).click();
    await settled(shown);
    sameElement(confirm(), null, 'not on another session');
    button(one(shown.target, '.term'), 'Reconnect');

    rowOf(shown.target, SESSION.title).click();
    await settled(shown);
    sameElement(confirm(), null, 'nor on its own once opened again');
    assert.equal(
      sent.some((s) => s.action === 'connect'),
      false,
      'nothing moved'
    );
  } finally {
    await shown.unmount();
  }
});

test('Opening a session ends the setup question’s terminal', async () => {
  office({
    sessions: [SESSION],
    view: viewOf(false, false),
    more: (s) => (s.action === 'connect' ? { setup: 'setup-1' } : {})
  });
  const shown = await projectsWindow();
  try {
    button(shown.target, '+ New session').click();
    shown.flush();
    button(shown.target, 'Start a new conversation').click();
    shown.flush();
    enterFolder(shown.target, '/work/app');
    shown.flush();
    button(shown.target, 'Start').click();
    await settled(shown);
    assert.ok(shown.target.textContent?.includes(PROJECT_WORDS.trustLine), 'shown first');

    rowOf(shown.target, SESSION.title).click();
    await settled(shown);
    assert.deepEqual(
      sent.filter((s) => s.action === 'disconnect').map((s) => s.id),
      ['setup-1'],
      'its terminal ended, once'
    );
  } finally {
    await shown.unmount();
  }
});

test('Claude Code’s setup question for a Start the owner has since changed never shows, and ends', async (t) => {
  const changes = [
    { name: 'no change', changed: false, change: () => {} },
    {
      name: 'a folder change',
      changed: true,
      change: (root: Element) => enterFolder(root, '/work/other')
    },
    {
      name: 'a tool change',
      changed: true,
      change: (root: Element) => pick(root, 'Coding tool', 'codex')
    },
    {
      name: 'an account change',
      changed: true,
      change: (root: Element) => pick(root, 'Account', FOLDERS[1].path)
    }
  ];
  for (const { name, changed, change } of changes) {
    await t.test(`after ${name} while Start waits`, async () => {
      let started = (_: unknown) => {};
      office({
        more: (s) => (s.action === 'connect' ? new Promise((r) => (started = r)) : {})
      });
      const shown = await projectsWindow();
      try {
        button(shown.target, 'Start a new conversation').click();
        shown.flush();
        enterFolder(shown.target, '/work/app');
        shown.flush();
        button(shown.target, 'Start').click();
        await settled(shown);
        assert.ok(
          sent.some((s) => s.action === 'connect'),
          'Start asked the office'
        );

        change(shown.target);
        shown.flush();
        started({ setup: 'setup-1' });
        await settled(shown);

        const shows = shown.target.textContent?.includes(PROJECT_WORDS.trustLine);
        const ended = sent.some((s) => s.action === 'disconnect' && s.id === 'setup-1');
        assert.equal(shows, !changed, changed ? 'the question is not shown' : 'the question shows');
        assert.equal(ended, changed, changed ? 'its terminal ends' : 'its terminal stays');
      } finally {
        await shown.unmount();
      }
    });
  }
});

test('Disconnect closes this window’s terminal before it asks the office, and brings it back when the office refuses', async (t) => {
  const NOT_CONNECTED = 'This session is not connected to the office.';
  /** The window, with whether its terminal showed as the office got the disconnect. */
  async function disconnected(answer: (view: ReturnType<typeof viewOf>) => unknown) {
    const view = viewOf(true, true);
    let shown: Awaited<ReturnType<typeof projectsWindow>> | undefined;
    const terminalShows = () => !!shown?.target.querySelector('.term .xterm');
    let shownAsAsked: boolean | undefined;
    office({
      sessions: [SESSION],
      view,
      more: (s) => {
        if (s.action !== 'disconnect') return {};
        shownAsAsked = terminalShows();
        return answer(view);
      }
    });
    shown = await projectsWindow();
    assert.ok(terminalShows(), 'the terminal shows first');
    button(shown.target, 'Disconnect').click();
    await settled(shown);
    return { shown, terminalShows, shownAsAsked };
  }

  await t.test('a refusal brings the terminal back and shows', async () => {
    const refusal = 'Finish or stop the active work before disconnecting.';
    const { shown, terminalShows, shownAsAsked } = await disconnected(() => refused(refusal));
    try {
      assert.equal(shownAsAsked, false, 'closed before the office was asked');
      assert.ok(terminalShows(), 'back once the office refused');
      assert.equal(shown.target.querySelector('[role="alert"] p')?.textContent, refusal);
    } finally {
      await shown.unmount();
    }
  });

  await t.test('a disconnect the office takes shows no error', async () => {
    const { shown, terminalShows, shownAsAsked } = await disconnected((view) => {
      view.connected = false;
      return {};
    });
    try {
      assert.equal(shownAsAsked, false, 'closed before the office was asked');
      assert.ok(!terminalShows(), 'gone with the session');
      sameElement(shown.target.querySelector('[role="alert"]'), null, 'with no error');
      assert.ok(shown.target.textContent?.includes(NOT_CONNECTED), described(shown.target));
    } finally {
      await shown.unmount();
    }
  });
});
