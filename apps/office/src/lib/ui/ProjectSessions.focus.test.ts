// The Projects window mounted in a browser-like document, against a stand-in
// office: Focus, Reconnect's Move here, and Claude Code's setup question
// answering a Start the owner has since changed. Each test clicks and types as
// the owner does and reads what the window then shows.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PROJECT_WORDS } from '../project-words.ts';
import { mountedForClient, type Mounted } from './onboarding/mounted-for-client.ts';
import { rememberFocus } from './projects-focus.ts';
import type ProjectSessionsComponent from './ProjectSessions.svelte';

const source = join(dirname(fileURLToPath(import.meta.url)), 'ProjectSessions.svelte');

/** One request the window sent to the project sessions route. */
type Sent = { action: string } & Record<string, unknown>;
/** The stand-in office: what it answers each request with, a body or a whole response. */
let answer: (sent: Sent) => unknown = () => ({});
const sent: Sent[] = [];
globalThis.fetch = (async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body)) as Sent;
  sent.push(body);
  const reply = await answer(body);
  return reply instanceof Response ? reply : Response.json(reply);
}) as typeof fetch;
// The session's live updates: none arrive in these tests.
class QuietStream {
  addEventListener() {}
  close() {}
}
Object.defineProperty(globalThis, 'EventSource', {
  value: QuietStream,
  configurable: true,
  writable: true
});

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
const FOLDERS = [
  { path: '/work/claude-a', mark: 'owner@example.com' },
  { path: '/work/claude-b', mark: 'second@example.com' }
];

/** An office with `sessions`, each showing `view`, answering anything else through `more`. */
function office(sessions: unknown[], view: unknown, more: (s: Sent) => unknown = () => ({})) {
  sent.length = 0;
  answer = (s) => {
    if (s.action === 'connections') return sessions;
    if (s.action === 'folders') return FOLDERS;
    if (s.action === 'history') return { work: [], view };
    return more(s);
  };
}

/** Lets every request answered so far land, and the window show it. */
async function settled(shown: Mounted) {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setImmediate(r));
    shown.flush();
  }
}
async function projectsWindow() {
  const shown = await mountedForClient<typeof ProjectSessionsComponent>(source, {
    staff: [],
    version: 0,
    ask: { n: 0 }
  });
  await settled(shown);
  return shown;
}

const FOLDER_FIELD = 'input[placeholder^="Folder path"]';
const titleRow = (root: Element) => root.querySelector('header h2')?.textContent ?? null;
const sessionList = (root: Element) => root.querySelector('nav[aria-label="Sessions"]');
function buttons(root: Element, words: string) {
  return [...root.querySelectorAll('button')].filter((b) => b.textContent?.trim() === words);
}
function button(root: Element, words: string) {
  const found = buttons(root, words);
  assert.equal(found.length, 1, `one button reading "${words}"`);
  return found[0];
}
/** The one element `selector` finds in `root`. */
function one<E extends Element>(root: Element, selector: string): E {
  const found = root.querySelector<E>(selector);
  assert.ok(found, `one ${selector}`);
  return found;
}
/** Types `value` into the field `selector` finds and leaves it, as the owner does. */
function typeInto(root: Element, selector: string, value: string) {
  const field = one<HTMLInputElement>(root, selector);
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}
/** Picks `value` in the list `selector` finds, as the owner does. */
function pick(root: Element, selector: string, value: string) {
  const list = one<HTMLSelectElement>(root, selector);
  list.value = value;
  list.dispatchEvent(new Event('change', { bubbles: true }));
}

test('Focus folds away the Projects title row and the session list only while a connected session’s terminal shows', async (t) => {
  await t.test(
    'pressing Focus on a terminal folds both away, and again brings them back',
    async () => {
      rememberFocus(false);
      office([SESSION], viewOf(true, true));
      const shown = await projectsWindow();
      try {
        assert.ok(shown.target.querySelector('.term .xterm'), 'the session’s terminal shows');
        assert.equal(shown.target.querySelector('[role="alert"]'), null, 'with no error');
        assert.equal(titleRow(shown.target), 'Projects');
        assert.ok(sessionList(shown.target));
        const focus = button(shown.target, PROJECT_WORDS.focus);
        assert.equal(focus.getAttribute('aria-label'), PROJECT_WORDS.focusName);
        assert.equal(focus.getAttribute('aria-pressed'), 'false');

        focus.click();
        shown.flush();
        assert.equal(titleRow(shown.target), null);
        assert.equal(sessionList(shown.target), null);
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
    office([SESSION], viewOf(true, true));
    const shown = await projectsWindow();
    try {
      assert.equal(titleRow(shown.target), null);
      assert.equal(sessionList(shown.target), null);
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
      office(sessions, view);
      const shown = await projectsWindow();
      try {
        assert.equal(titleRow(shown.target), 'Projects');
        assert.ok(sessionList(shown.target));
        assert.deepEqual(buttons(shown.target, PROJECT_WORDS.focus), [], 'no Focus to press');
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
    office([SESSION], viewOf(false, false), (s) => (s.action === 'find' ? [inTerminal(true)] : {}));
    const shown = await projectsWindow();
    try {
      const body = one(shown.target, '.term');
      button(body, 'Reconnect').click();
      await settled(shown);

      const confirm = body.querySelector('[role="alertdialog"]');
      assert.ok(confirm, 'the confirm shows');
      assert.match(confirm.textContent ?? '', new RegExp(PROJECT_WORDS.moveConfirm.slice(0, 40)));
      assert.deepEqual(buttons(body, 'Reconnect'), [], 'in place of Reconnect');
      assert.deepEqual(buttons(body, 'Remove'), [], 'and Remove');
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
      assert.equal(body.querySelector('[role="alertdialog"]'), null, 'the confirm closes');
    } finally {
      await shown.unmount();
    }
  });

  await t.test('one it cannot move connects at once and shows the office’s words', async () => {
    office([SESSION], viewOf(false, false), (s) => {
      if (s.action === 'find') return [inTerminal(false)];
      if (s.action === 'connect')
        return Response.json({ message: PROJECT_WORDS.windows }, { status: 409 });
      return {};
    });
    const shown = await projectsWindow();
    try {
      const body = one(shown.target, '.term');
      button(body, 'Reconnect').click();
      await settled(shown);
      assert.equal(body.querySelector('[role="alertdialog"]'), null, 'no confirm');
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
      change: (root: Element) => typeInto(root, FOLDER_FIELD, '/work/other')
    },
    {
      name: 'a tool change',
      changed: true,
      change: (root: Element) => pick(root, 'select[aria-label="Coding tool"]', 'codex')
    },
    {
      name: 'an account change',
      changed: true,
      change: (root: Element) => pick(root, 'select[aria-label="Account"]', FOLDERS[1].path)
    }
  ];
  for (const { name, changed, change } of changes) {
    await t.test(`after ${name} while Start waits`, async () => {
      let started = (_: unknown) => {};
      office([], undefined, (s) =>
        s.action === 'connect' ? new Promise((r) => (started = r)) : {}
      );
      const shown = await projectsWindow();
      try {
        button(shown.target, 'Start a new conversation').click();
        shown.flush();
        typeInto(shown.target, FOLDER_FIELD, '/work/app');
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
