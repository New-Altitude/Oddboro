// The New session form's move confirm, clicked as the owner does: the form is
// mounted in a browser-like document, so a click opens the confirm under its
// row and the confirm's own buttons answer. Its own file, since a test file
// compiles components for the client or the server, never both.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PROJECT_WORDS } from '../project-words.ts';
import { mountedForClient } from './onboarding/mounted-for-client.ts';
import { newSessionFields, type Choice } from './project-form.ts';
import type NewSessionFormComponent from './NewSessionForm.svelte';

const source = join(dirname(fileURLToPath(import.meta.url)), 'NewSessionForm.svelte');

const OPEN: Choice = {
  id: '11111111-0000-4000-8000-000000000000',
  title: 'Open in a terminal here',
  live: true,
  movable: true,
  updated: Date.UTC(2026, 10, 16)
};
const SAVED: Choice = {
  id: '22222222-0000-4000-8000-000000000000',
  title: 'Saved earlier',
  live: false,
  updated: Date.UTC(2026, 10, 15)
};
const REFUSED = 'Claude is replying in that terminal.';

/** The form on the continue path with two rows, and what its callbacks got. */
async function form(problemRow?: string) {
  const moved: Choice[] = [];
  const chosen: Choice[] = [];
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
    candidates: [OPEN, SAVED],
    found: true,
    listing: false,
    busy: false,
    problem: problemRow ? REFUSED : undefined,
    place: problemRow ? 'row' : undefined,
    problemRow,
    setup: undefined,
    onfilter: nothing,
    onchange: nothing,
    onpick: nothing,
    onpath: nothing,
    onstart: nothing,
    onchoose: (c) => chosen.push(c),
    onmove: (c) => moved.push(c),
    onsetuperror: nothing,
    onhandover: nothing
  });
  return { ...mounted, moved, chosen };
}

function button(root: Element, words: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].filter((b) => b.textContent?.trim() === words);
  assert.equal(found.length, 1, `one button reading "${words}"`);
  return found[0];
}
/** The line a row's button sits on, with any button beside it. */
const lineOf = (root: Element, c: Choice) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.includes(c.id.slice(0, 8)))
    ?.parentElement;

test('Its confirm reads the ruled words, under the row, and Move here moves that row', async () => {
  const shown = await form();
  try {
    assert.equal(shown.target.querySelector('[role="alertdialog"]'), null, 'shut until asked');
    button(shown.target, PROJECT_WORDS.moveButton).click();
    shown.flush();

    const confirm = shown.target.querySelector('[role="alertdialog"]');
    assert.ok(confirm, 'the confirm opens');
    assert.equal(confirm.previousElementSibling, lineOf(shown.target, OPEN), 'right under its row');
    const label = confirm.getAttribute('aria-labelledby');
    assert.equal(
      label && shown.target.querySelector(`[id="${label}"]`)?.textContent,
      PROJECT_WORDS.moveConfirm
    );
    assert.deepEqual(shown.chosen, [], 'opening the confirm opens nothing yet');

    button(confirm, PROJECT_WORDS.moveButton).click();
    shown.flush();
    assert.deepEqual(shown.moved, [OPEN]);
    assert.equal(shown.target.querySelector('[role="alertdialog"]'), null, 'the confirm closes');
  } finally {
    await shown.unmount();
  }
});

test('Cancel closes the move confirm and moves nothing', async () => {
  const shown = await form();
  try {
    button(shown.target, PROJECT_WORDS.moveButton).click();
    shown.flush();
    const confirm = shown.target.querySelector('[role="alertdialog"]');
    assert.ok(confirm);
    button(confirm, PROJECT_WORDS.moveCancel).click();
    shown.flush();
    assert.equal(shown.target.querySelector('[role="alertdialog"]'), null);
    assert.deepEqual(shown.moved, []);
  } finally {
    await shown.unmount();
  }
});

test("With the row's error showing, the move confirm comes first, then the error", async () => {
  const shown = await form(OPEN.id);
  try {
    button(shown.target, PROJECT_WORDS.moveButton).click();
    shown.flush();
    const confirm = shown.target.querySelector('[role="alertdialog"]');
    assert.ok(confirm);
    assert.equal(confirm.previousElementSibling, lineOf(shown.target, OPEN));
    const alert = shown.target.querySelector('[role="alert"]');
    assert.equal(alert?.textContent?.trim(), REFUSED);
    assert.equal(alert?.previousElementSibling, confirm);
  } finally {
    await shown.unmount();
  }
});
