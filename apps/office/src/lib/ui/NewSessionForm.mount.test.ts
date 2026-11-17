// The New session form mounted in a browser-like document, typed into and
// clicked as the owner does, so the events its markup wires are what a test
// reads: which change each one reports, and an error scrolling into view.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { mock, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { mountedForClient } from './onboarding/mounted-for-client.ts';
import { newSessionFields, type Choice, type FormChange } from './project-form.ts';
import type NewSessionFormComponent from './NewSessionForm.svelte';

const source = join(dirname(fileURLToPath(import.meta.url)), 'NewSessionForm.svelte');

const ROW: Choice = {
  id: '33333333-0000-4000-8000-000000000000',
  title: 'Saved earlier',
  live: false,
  updated: Date.UTC(2026, 10, 15)
};
const REFUSED = 'Claude is replying in that terminal.';

/** The form on the continue path for ~/app with one row, and every change it reported. */
async function form(problemRow?: string) {
  const reported: FormChange[] = [];
  const nothing = () => {};
  const mounted = await mountedForClient<typeof NewSessionFormComponent>(source, {
    folder: '/work/app',
    agent: 'claude',
    socket: '',
    name: '',
    startIn: '',
    filter: '',
    path: 'continue',
    fields: newSessionFields({
      path: 'continue',
      folder: '/work/app',
      agent: 'claude',
      claudeFolders: 1,
      handingOver: false
    }),
    folders: [],
    candidates: [ROW],
    found: true,
    listing: false,
    busy: false,
    problem: problemRow ? REFUSED : undefined,
    place: problemRow ? 'row' : undefined,
    problemRow,
    setup: undefined,
    onfilter: nothing,
    onchange: (change) => reported.push(change),
    onpick: nothing,
    onpath: nothing,
    onstart: nothing,
    onchoose: nothing,
    onmove: nothing,
    onsetuperror: nothing,
    onhandover: nothing
  });
  return { ...mounted, reported };
}

function one<E extends Element>(root: Element, selector: string): E {
  const found = root.querySelector<E>(selector);
  assert.ok(found, `one ${selector}`);
  return found;
}

test('Each control on the form reports the change it makes, so only a committed one can list', async (t) => {
  await t.test(
    'typing in the folder reports each keystroke as typing, never as a folder',
    async () => {
      const shown = await form();
      try {
        const field = one<HTMLInputElement>(shown.target, 'input[placeholder^="Folder path"]');
        for (const value of ['/work/a', '/work/ap', '/work/app2']) {
          field.value = value;
          field.dispatchEvent(new Event('input', { bubbles: true }));
        }
        shown.flush();
        assert.deepEqual(shown.reported, ['typed', 'typed', 'typed']);
      } finally {
        await shown.unmount();
      }
    }
  );

  await t.test('leaving the folder field after a change reports the folder', async () => {
    const shown = await form();
    try {
      const field = one<HTMLInputElement>(shown.target, 'input[placeholder^="Folder path"]');
      field.value = '/work/other';
      field.dispatchEvent(new Event('change', { bubbles: true }));
      shown.flush();
      assert.deepEqual(shown.reported, ['folder']);
    } finally {
      await shown.unmount();
    }
  });

  await t.test('switching the coding tool reports the tool', async () => {
    const shown = await form();
    try {
      const tool = one<HTMLSelectElement>(shown.target, 'select[aria-label="Coding tool"]');
      tool.value = 'codex';
      tool.dispatchEvent(new Event('change', { bubbles: true }));
      shown.flush();
      assert.deepEqual(shown.reported, ['tool']);
    } finally {
      await shown.unmount();
    }
  });

  await t.test('Refresh list reports a refresh, on each press', async () => {
    const shown = await form();
    try {
      const refresh = [...shown.target.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Refresh list'
      );
      assert.ok(refresh, 'Refresh list');
      refresh.click();
      refresh.click();
      shown.flush();
      assert.deepEqual(shown.reported, ['refresh', 'refresh']);
    } finally {
      await shown.unmount();
    }
  });
});

test('An error under a row scrolls itself into view as it appears', async () => {
  // happy-dom lays nothing out, so the call itself is what the test can see.
  const scrolled = mock.method(Element.prototype, 'scrollIntoView', () => {});
  const shown = await form(ROW.id);
  try {
    const alert = one(shown.target, '[role="alert"]');
    assert.equal(alert.textContent?.trim(), REFUSED);
    assert.equal(scrolled.mock.callCount(), 1);
    const [call] = scrolled.mock.calls;
    // Compared as yes or no: a failed assertion on an element prints the whole document.
    assert.ok(call.this === alert, 'the error itself scrolls, nothing else');
    assert.deepEqual(call.arguments, [{ block: 'nearest' }]);
  } finally {
    scrolled.mock.restore();
    await shown.unmount();
  }
});
