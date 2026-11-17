// The Projects window's New session form, mounted in a browser-like document
// against a stand-in office. Each test types, picks and clicks as the owner
// does, then reads what the window shows and which requests it sent: when a
// list starts, where an error shows, and when Claude Code's setup question
// for a new folder shows and ends.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PROJECT_WORDS } from '../project-words.ts';
import { mountedForClient, type Mounted } from './onboarding/mounted-for-client.ts';
import type { Choice } from './project-form.ts';
import type ProjectSessionsComponent from './ProjectSessions.svelte';

const source = join(dirname(fileURLToPath(import.meta.url)), 'ProjectSessions.svelte');

/** One request the window sent to the project sessions route. */
type Sent = { action: string } & Record<string, unknown>;
/** What the stand-in office answers a request with: a body, a whole response, or a wait. */
type Answer = (sent: Sent) => unknown;
let answer: Answer = () => ({});
let sent: Sent[] = [];
/** What Choose folder's own route answers. */
let picked: unknown = {};
globalThis.fetch = (async (url: string, init: RequestInit) => {
  if (url === '/api/folders/pick') return Response.json(picked);
  const body = JSON.parse(String(init.body)) as Sent;
  sent.push(body);
  const reply = await answer(body);
  return reply instanceof Response ? reply : Response.json(reply);
}) as typeof fetch;
// The window's live updates: none arrive in these tests.
Object.defineProperty(globalThis, 'EventSource', {
  value: class {
    addEventListener() {}
    close() {}
  },
  configurable: true,
  writable: true
});

const FOLDERS = [
  { path: '/work/claude-a', mark: 'owner@example.com' },
  { path: '/work/claude-b', mark: 'second@example.com' }
];
const row = (n: number, more: Partial<Choice> = {}): Choice => ({
  id: `${n}${n}${n}${n}${n}${n}${n}${n}-0000-4000-8000-000000000000`,
  title: `Conversation ${n}`,
  live: false,
  updated: Date.UTC(2026, 10, 16),
  ...more
});
const ROW_1 = row(1);
const ROW_2 = row(2);
const REFUSED = 'Claude is replying in that terminal.';
const refused = (message: string) => Response.json({ message }, { status: 409 });

/** An office with no sessions yet, answering anything else through `more`. */
function office(more: Answer = () => ({})) {
  sent = [];
  picked = {};
  answer = (s) => {
    if (s.action === 'connections') return [];
    if (s.action === 'folders') return FOLDERS;
    return more(s);
  };
}
/** An answer the test gives when it chooses. */
function later() {
  return Promise.withResolvers<unknown>();
}
const asked = (action: string) => sent.filter((s) => s.action === action);

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

function one<E extends Element>(root: Element, selector: string): E {
  const found = root.querySelector<E>(selector);
  assert.ok(found, `one ${selector}`);
  return found;
}
function buttons(root: Element, words: string) {
  return [...root.querySelectorAll('button')].filter((b) => b.textContent?.trim() === words);
}
function button(root: Element, words: string) {
  const found = buttons(root, words);
  assert.equal(found.length, 1, `one button reading "${words}"`);
  return found[0];
}
const folderField = (root: Element) =>
  one<HTMLInputElement>(root, 'input[placeholder^="Folder path"]');
/** Types `value` into the folder field, one `input` per keystroke, and stays in it. */
function typeFolder(root: Element, value: string) {
  const field = folderField(root);
  for (let end = 1; end <= value.length; end++) {
    field.value = value.slice(0, end);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
/** Types `value` into the folder field and leaves it, as the owner does. */
function enterFolder(root: Element, value: string) {
  typeFolder(root, value);
  folderField(root).dispatchEvent(new Event('change', { bubbles: true }));
}
/** Picks `value` in the list `label` names, as the owner does. */
function pick(root: Element, label: string, value: string) {
  const list = one<HTMLSelectElement>(root, `select[aria-label="${label}"]`);
  list.value = value;
  list.dispatchEvent(new Event('change', { bubbles: true }));
}
/** The line a found conversation's row sits on, with any button beside it. */
function lineOf(root: Element, c: Choice) {
  const own = [...root.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(c.id.slice(0, 8))
  );
  return own?.parentElement ?? null;
}
const rowShown = (root: Element, c: Choice) => lineOf(root, c) !== null;
/** The words of each error shown. Tests compare words and yes or no, never elements:
 * a failed assertion on a document element prints the whole document, for a minute. */
const alerts = (root: Element) =>
  [...root.querySelectorAll('[role="alert"]')].map((a) => a.textContent?.trim());
const says = (root: Element, words: string) => root.textContent?.includes(words) ?? false;

/** The window on the continue path, with `folder` entered and its list landed or waiting. */
async function continuing(folder: string, more: Answer) {
  office(more);
  const shown = await projectsWindow();
  button(shown.target, 'Continue an earlier one').click();
  shown.flush();
  enterFolder(shown.target, folder);
  await settled(shown);
  return shown;
}

test('A folder lists its conversations once it is committed, never per keystroke', async (t) => {
  await t.test('typing lists nothing, and leaving the field lists that folder once', async () => {
    office(() => [ROW_1]);
    const shown = await projectsWindow();
    try {
      button(shown.target, 'Continue an earlier one').click();
      shown.flush();
      typeFolder(shown.target, '/work/app');
      await settled(shown);
      assert.deepEqual(asked('find'), [], 'no list while the owner types');

      folderField(shown.target).dispatchEvent(new Event('change', { bubbles: true }));
      await settled(shown);
      assert.deepEqual(
        asked('find').map((s) => s.folder),
        ['/work/app']
      );
      assert.ok(rowShown(shown.target, ROW_1), 'its conversation shows');
    } finally {
      await shown.unmount();
    }
  });

  await t.test('Choose folder lists the folder picked', async () => {
    office(() => [ROW_1]);
    const shown = await projectsWindow();
    try {
      button(shown.target, 'Continue an earlier one').click();
      shown.flush();
      picked = { path: '/work/picked' };
      button(shown.target, 'Choose folder').click();
      await settled(shown);
      assert.equal(folderField(shown.target).value, '/work/picked');
      assert.deepEqual(
        asked('find').map((s) => s.folder),
        ['/work/picked']
      );
      assert.ok(rowShown(shown.target, ROW_1));
    } finally {
      await shown.unmount();
    }
  });
});

test('Rows found for one folder never show while another folder is asked about', async () => {
  const other = later();
  const shown = await continuing('/work/app', (s) =>
    s.action === 'find' ? (s.folder === '/work/app' ? [ROW_1] : other.promise) : {}
  );
  try {
    assert.ok(rowShown(shown.target, ROW_1), 'the first folder’s row');
    enterFolder(shown.target, '/work/other');
    await settled(shown);
    assert.equal(asked('find').length, 2);
    assert.equal(rowShown(shown.target, ROW_1), false, 'not under the other folder');

    other.resolve([ROW_2]);
    await settled(shown);
    assert.equal(rowShown(shown.target, ROW_1), false);
    assert.ok(rowShown(shown.target, ROW_2), 'the other folder’s own row');
  } finally {
    await shown.unmount();
  }
});

test('While a list loads, the form says it is looking, and Refresh list asks only once', async (t) => {
  await t.test('the looking line shows while the list loads, and goes when it lands', async () => {
    const first = later();
    const shown = await continuing('/work/app', (s) => (s.action === 'find' ? first.promise : {}));
    try {
      assert.ok(says(shown.target, PROJECT_WORDS.looking), 'looking while it loads');
      first.resolve([ROW_1]);
      await settled(shown);
      assert.ok(!says(shown.target, PROJECT_WORDS.looking), 'gone once it lands');
      assert.ok(rowShown(shown.target, ROW_1));
    } finally {
      await shown.unmount();
    }
  });

  await t.test(
    'three presses during one load send one request, and one after it one more',
    async () => {
      let waiting = later();
      const shown = await continuing('/work/app', (s) =>
        s.action === 'find' ? waiting.promise : {}
      );
      try {
        waiting.resolve([ROW_1]);
        await settled(shown);
        assert.equal(asked('find').length, 1, 'the folder’s own list');

        waiting = later();
        const refresh = button(shown.target, 'Refresh list');
        for (let press = 0; press < 3; press++) {
          refresh.click();
          await settled(shown);
        }
        assert.equal(asked('find').length, 2, 'three presses during one load ask once');

        waiting.resolve([ROW_1]);
        await settled(shown);
        button(shown.target, 'Refresh list').click();
        await settled(shown);
        assert.equal(asked('find').length, 3, 'a press after it lands asks again');
      } finally {
        await shown.unmount();
      }
    }
  );
});

test('A list error shows only for the folder it came from, and a new list clears it', async (t) => {
  const COULD_NOT = 'Could not read that folder’s conversations.';

  await t.test('an error listing one folder does not show on another', async () => {
    const shown = await continuing('/work/a', (s) =>
      s.action === 'find' ? (s.folder === '/work/a' ? [ROW_1] : refused(COULD_NOT)) : {}
    );
    try {
      enterFolder(shown.target, '/work/b');
      await settled(shown);
      assert.deepEqual(alerts(shown.target), [COULD_NOT], 'shown on its own');

      enterFolder(shown.target, '/work/a');
      await settled(shown);
      assert.equal(asked('find').length, 2, 'back on the first folder, nothing lists again');
      assert.deepEqual(alerts(shown.target), [], 'and the other folder’s error is not shown');
      assert.ok(rowShown(shown.target, ROW_1), 'the first folder’s rows are');
    } finally {
      await shown.unmount();
    }
  });

  await t.test('Refresh list after an error clears it as the new list starts', async () => {
    let fails = true;
    const shown = await continuing('/work/app', (s) =>
      s.action === 'find' ? (fails ? refused(COULD_NOT) : [ROW_1]) : {}
    );
    try {
      assert.deepEqual(alerts(shown.target), [COULD_NOT]);
      fails = false;
      button(shown.target, 'Refresh list').click();
      await settled(shown);
      assert.equal(asked('find').length, 2);
      assert.deepEqual(alerts(shown.target), []);
      assert.ok(rowShown(shown.target, ROW_1));
    } finally {
      await shown.unmount();
    }
  });
});

test('A conversation that will not open shows the office’s words directly under its row', async () => {
  const shown = await continuing('/work/app', (s) => {
    if (s.action === 'find') return [ROW_1, ROW_2];
    if (s.action === 'connect') return refused(REFUSED);
    return {};
  });
  try {
    const line = lineOf(shown.target, ROW_1);
    assert.ok(line);
    one<HTMLButtonElement>(line, 'button').click();
    await settled(shown);
    assert.equal(asked('connect')[0]?.nativeId, ROW_1.id);

    assert.deepEqual(alerts(shown.target), [REFUSED], 'one error, the office’s words');
    const error = one(shown.target, '[role="alert"]');
    assert.ok(error.previousElementSibling === line, 'right under the row clicked');
    assert.ok(error.nextElementSibling === lineOf(shown.target, ROW_2), 'above the next row');
  } finally {
    await shown.unmount();
  }
});

test('Move here on a row open in a terminal moves it, once the owner confirms', async () => {
  const open = row(3, { live: true, movable: true });
  const shown = await continuing('/work/app', (s) => {
    if (s.action === 'find') return [open];
    if (s.action === 'connect') return refused(REFUSED);
    return {};
  });
  try {
    button(shown.target, PROJECT_WORDS.moveButton).click();
    shown.flush();
    const confirm = one(shown.target, '[role="alertdialog"]');
    assert.deepEqual(asked('connect'), [], 'nothing moves before the yes');
    button(confirm, PROJECT_WORDS.moveButton).click();
    await settled(shown);
    const [connect] = asked('connect');
    assert.equal(connect?.nativeId, open.id);
    assert.equal(connect?.move, true);
  } finally {
    await shown.unmount();
  }
});

/**
 * The window on the start path for ~/app, after a Start Claude Code answered
 * with its setup question. A later Start gets `next`.
 */
async function askedToTrust(next: () => unknown = () => ({})) {
  let starts = 0;
  office((s) => (s.action === 'connect' ? (++starts === 1 ? { setup: 'setup-1' } : next()) : {}));
  const shown = await projectsWindow();
  button(shown.target, 'Start a new conversation').click();
  shown.flush();
  enterFolder(shown.target, '/work/app');
  shown.flush();
  button(shown.target, 'Start').click();
  await settled(shown);
  return shown;
}
const setupShown = (root: Element) =>
  says(root, PROJECT_WORDS.trustLine) || !!root.querySelector('.xterm');
const ended = (id: string) => asked('disconnect').some((s) => s.id === id);

test('Claude Code’s question before it works in a new folder shows under Start', async () => {
  const shown = await askedToTrust();
  try {
    const start = button(shown.target, 'Start');
    const line = [...shown.target.querySelectorAll('p')].find(
      (p) => p.textContent === PROJECT_WORDS.trustLine
    );
    assert.ok(line, 'the trust line');
    const terminal = one(shown.target, '.xterm');
    const again = button(shown.target, PROJECT_WORDS.startAgain);
    const follows = (a: Node, b: Node) =>
      !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    assert.ok(follows(start, line), 'the line under Start');
    assert.ok(follows(line, terminal), 'then the setup terminal');
    assert.ok(follows(terminal, again), 'then Start again');
    assert.deepEqual(asked('disconnect'), [], 'it stays open for the owner to answer');
  } finally {
    await shown.unmount();
  }
});

test('The setup question ends when the form it was asked for changes', async (t) => {
  const changes = [
    {
      name: 'a folder change',
      change: (root: Element) => enterFolder(root, '/work/other'),
      took: (root: Element) => folderField(root).value === '/work/other'
    },
    {
      name: 'a tool change',
      change: (root: Element) => pick(root, 'Coding tool', 'codex'),
      // Codex starts in no Claude account, so the Account list goes.
      took: (root: Element) => !root.querySelector('select[aria-label="Account"]')
    }
  ];
  for (const { name, change, took } of changes) {
    await t.test(`${name} takes it away and ends its terminal`, async () => {
      const shown = await askedToTrust();
      try {
        assert.ok(setupShown(shown.target), 'shown first');
        change(shown.target);
        await settled(shown);
        assert.ok(took(shown.target), 'the form changed');
        assert.equal(setupShown(shown.target), false, 'no longer shown');
        assert.ok(ended('setup-1'), 'its terminal ended');
      } finally {
        await shown.unmount();
      }
    });
  }

  await t.test('after an Account change, Start ends it before asking again', async () => {
    // The second Start waits, so what shows while it does is the old question or none.
    const shown = await askedToTrust(() => later().promise);
    try {
      assert.ok(setupShown(shown.target), 'shown first');
      pick(shown.target, 'Account', FOLDERS[1].path);
      await settled(shown);
      button(shown.target, 'Start').click();
      await settled(shown);

      const connects = asked('connect');
      assert.equal(connects.length, 2, 'Start asked again');
      assert.equal(connects[1].configDir, FOLDERS[1].path, 'in the account picked');
      assert.equal(setupShown(shown.target), false, 'the old question is not shown');
      assert.ok(ended('setup-1'), 'its terminal ended');
      const order = sent.map((s) => s.action);
      assert.ok(
        order.indexOf('disconnect') < order.lastIndexOf('connect'),
        'ended before Start asked again'
      );
    } finally {
      await shown.unmount();
    }
  });
});
