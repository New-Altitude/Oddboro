// The Projects window mounted in a browser-like document, against a stand-in
// office: Focus, Reconnect's Move here, and Claude Code's setup question
// answering a Start the owner has since changed. Each test clicks and types as
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

test('Reconnect on a conversation open in a terminal asks before moving it here', async (t) => {
  const inTerminal = (movable: boolean) => ({
    id: NATIVE,
    title: 'Fix the build',
    live: true,
    updated: 0,
    ...(movable && { movable })
  });

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
