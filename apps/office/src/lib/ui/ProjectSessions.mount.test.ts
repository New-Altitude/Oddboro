// The Projects window's New session form, mounted in a browser-like document
// against a stand-in office. Each test types, picks and clicks as the owner
// does, then reads what the window shows and which requests it sent: when a
// list starts, where an error shows, and when Claude Code's setup question
// for a new folder shows and ends.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROJECT_WORDS } from '../project-words.ts';
import {
  asked,
  button,
  enterFolder,
  folderField,
  FOLDERS,
  lineOf,
  office,
  one,
  pick,
  projectsWindow,
  REFUSED,
  refused,
  sameElement,
  sent,
  settled,
  streamAt,
  typeFolder,
  type Answer
} from './projects-window-under-test.ts';
import type { Choice } from './project-form.ts';

const row = (n: number, more: Partial<Choice> = {}): Choice => ({
  id: `${n}${n}${n}${n}${n}${n}${n}${n}-0000-4000-8000-000000000000`,
  title: `Conversation ${n}`,
  live: false,
  updated: Date.UTC(2026, 10, 16),
  ...more
});
const ROW_1 = row(1);
const ROW_2 = row(2);

/** An answer the test gives when it chooses. */
function later() {
  return Promise.withResolvers<unknown>();
}

const rowShown = (root: Element, c: Choice) => lineOf(root, c) !== null;
/** The words of each error shown. */
const alerts = (root: Element) =>
  [...root.querySelectorAll('[role="alert"]')].map((a) => a.textContent?.trim());
const says = (root: Element, words: string) => root.textContent?.includes(words) ?? false;

/** The window on the continue path, with `folder` entered and its list landed or waiting. */
async function continuing(folder: string, more: Answer) {
  office({ more });
  const shown = await projectsWindow();
  button(shown.target, 'Continue an earlier one').click();
  shown.flush();
  enterFolder(shown.target, folder);
  await settled(shown);
  return shown;
}

test('A folder lists its conversations once it is committed, never per keystroke', async (t) => {
  await t.test('typing lists nothing, and leaving the field lists that folder once', async () => {
    office({ more: () => [ROW_1] });
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
    office({ picked: { path: '/work/picked' }, more: () => [ROW_1] });
    const shown = await projectsWindow();
    try {
      button(shown.target, 'Continue an earlier one').click();
      shown.flush();
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
    sameElement(error.previousElementSibling, line, 'right under the row clicked');
    sameElement(error.nextElementSibling, lineOf(shown.target, ROW_2), 'above the next row');
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
 * with its setup question. A later Start gets `next`, and Choose folder `picked`.
 */
async function askedToTrust(next: () => unknown = () => ({}), { picked = {} } = {}) {
  let starts = 0;
  office({
    picked,
    more: (s) => (s.action === 'connect' ? (++starts === 1 ? { setup: 'setup-1' } : next()) : {})
  });
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
    const follows = (a: Node, b: Node) =>
      !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    assert.ok(follows(start, line), 'the line under Start');
    assert.ok(follows(line, terminal), 'then the setup terminal');
    assert.deepEqual(asked('disconnect'), [], 'it stays open for the owner to answer');
  } finally {
    await shown.unmount();
  }
});

/** Claude Code quitting in setup terminal `id`, as it does once the owner answers its question. */
const answered = (id: string) => setupStream(id).send('end', true);
/** The stream setup terminal `id` shows through. */
const setupStream = (id: string) => streamAt(`/api/project-sessions/${id}/events?terminal=1`);

test('Once the trust question ends, Start runs again once by itself, and a folder still untrusted shows the line with no second terminal', async () => {
  const shown = await askedToTrust(() => ({ setup: 'setup-2' }));
  try {
    assert.ok(setupShown(shown.target), 'shown first');
    answered('setup-1');
    await settled(shown);

    assert.equal(asked('connect').length, 2, 'Start ran again by itself, once');
    assert.ok(says(shown.target, PROJECT_WORDS.notTrusted), 'the line shows');
    assert.equal(setupShown(shown.target), false, 'no second terminal');
    assert.deepEqual(
      asked('disconnect').map((s) => s.id),
      ['setup-1', 'setup-2'],
      'the new question ended at once'
    );
    answered('setup-1');
    await settled(shown);
    assert.equal(asked('connect').length, 2, 'no third Start');
  } finally {
    await shown.unmount();
  }
});

test('Once the trust question is answered yes, its terminal goes and the session opens', async () => {
  const shown = await askedToTrust(() => ({ id: 'session-1' }));
  try {
    answered('setup-1');
    await settled(shown);
    assert.equal(asked('connect').length, 2, 'Start ran again by itself');
    assert.equal(setupShown(shown.target), false, 'the terminal is gone');
    assert.ok(
      asked('history').some((s) => s.id === 'session-1'),
      'the session opened'
    );
  } finally {
    await shown.unmount();
  }
});

test('A trust question closed by a form change starts nothing when it ends', async () => {
  const shown = await askedToTrust();
  try {
    enterFolder(shown.target, '/work/other');
    await settled(shown);
    answered('setup-1');
    await settled(shown);
    assert.equal(asked('connect').length, 1, 'no Start');
    assert.equal(says(shown.target, PROJECT_WORDS.notTrusted), false, 'no line');
  } finally {
    await shown.unmount();
  }
});

test('Closing the Projects window ends the setup question’s terminal', async () => {
  const shown = await askedToTrust();
  assert.ok(setupShown(shown.target), 'shown first');
  await shown.unmount();
  assert.deepEqual(
    asked('disconnect').map((s) => s.id),
    ['setup-1'],
    'its terminal ended, once'
  );
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
    },
    {
      // The question was the old account's: answering it would trust the folder for that one.
      name: 'an Account change',
      change: (root: Element) => pick(root, 'Account', FOLDERS[1].path),
      took: (root: Element) =>
        one<HTMLSelectElement>(root, 'select[aria-label="Account"]').value === FOLDERS[1].path
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
        assert.deepEqual(
          asked('disconnect').map((s) => s.id),
          ['setup-1'],
          'its terminal ended, once'
        );
      } finally {
        await shown.unmount();
      }
    });
  }

  await t.test('after an Account change, Start asks again in the account picked', async () => {
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

test('A trust question that ends while another action runs starts again once that action ends, only while it still shows', async (t) => {
  await t.test('Choose folder cancelled: Start runs again once, after it', async () => {
    const shown = await askedToTrust(() => ({ setup: 'setup-2' }));
    try {
      button(shown.target, 'Choose folder').click();
      answered('setup-1');
      await settled(shown);
      assert.equal(asked('connect').length, 2, 'Start ran again by itself, once');
      assert.ok(says(shown.target, PROJECT_WORDS.notTrusted), 'as the Start after the question');
    } finally {
      await shown.unmount();
    }
  });

  await t.test(
    'Choose folder picked another folder: the question went with it, and nothing starts',
    async () => {
      const shown = await askedToTrust(() => ({ setup: 'setup-2' }), {
        picked: { path: '/work/other' }
      });
      try {
        button(shown.target, 'Choose folder').click();
        answered('setup-1');
        await settled(shown);
        assert.equal(folderField(shown.target).value, '/work/other', 'the folder changed');
        assert.equal(asked('connect').length, 1, 'no Start');
        assert.deepEqual(
          asked('disconnect').map((s) => s.id),
          ['setup-1'],
          'its terminal ended, once'
        );
        assert.equal(says(shown.target, PROJECT_WORDS.notTrusted), false, 'no line');
      } finally {
        await shown.unmount();
      }
    }
  );
});

test('A trust terminal gone before its stream connected counts as answered, and a stream the browser reconnects does not', async (t) => {
  await t.test('a stream the office refused for good starts Start again once', async () => {
    const shown = await askedToTrust(() => ({ setup: 'setup-2' }));
    try {
      setupStream('setup-1').fail(true);
      await settled(shown);
      assert.equal(asked('connect').length, 2, 'Start ran again by itself, once');
      assert.ok(says(shown.target, PROJECT_WORDS.notTrusted), 'as the Start after the question');
    } finally {
      await shown.unmount();
    }
  });

  await t.test(
    'a dropped stream the browser reconnects starts nothing, and the question stays',
    async () => {
      const shown = await askedToTrust(() => ({ setup: 'setup-2' }));
      try {
        setupStream('setup-1').fail(false);
        await settled(shown);
        assert.equal(asked('connect').length, 1, 'no Start');
        assert.ok(setupShown(shown.target), 'the question still shows');
        assert.deepEqual(asked('disconnect'), [], 'its terminal stays open');
      } finally {
        await shown.unmount();
      }
    }
  );
});

test('One trust question that ends twice starts Start again only once', async () => {
  const shown = await askedToTrust(() => ({ setup: 'setup-2' }));
  try {
    answered('setup-1');
    setupStream('setup-1').fail(true);
    await settled(shown);
    assert.equal(asked('connect').length, 2, 'Start ran again by itself, once');
    setupStream('setup-1').fail(true);
    await settled(shown);
    assert.equal(asked('connect').length, 2, 'no third Start');
  } finally {
    await shown.unmount();
  }
});

test("A trust question another window's Start replaced goes, and starts nothing here", async () => {
  const shown = await askedToTrust(() => ({ setup: 'setup-2' }));
  try {
    setupStream('setup-1').send('replaced', true);
    await settled(shown);
    assert.equal(setupShown(shown.target), false, 'the line and its terminal are gone');
    assert.equal(button(shown.target, 'Start').disabled, false, 'Start is ready again');
    assert.deepEqual(asked('disconnect'), [], 'the office already closed it');
    assert.deepEqual(alerts(shown.target), [], 'no error');

    // Its stream ending after that, as an end or a refusal, starts nothing.
    answered('setup-1');
    setupStream('setup-1').fail(true);
    await settled(shown);
    assert.equal(asked('connect').length, 1, 'no Start');
    assert.equal(says(shown.target, PROJECT_WORDS.notTrusted), false, 'no line');
  } finally {
    await shown.unmount();
  }
});
