// The New session form's move confirm, clicked as the owner does: the form is
// mounted in a browser-like document, so a click opens the confirm under its
// row and the confirm's own buttons answer. Its own file, since a test file
// compiles components for the client or the server, never both.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROJECT_WORDS } from '../project-words.ts';
import { button, form, lineOf, REFUSED, sameElement } from './projects-window-under-test.ts';
import type { Choice } from './project-form.ts';

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
test('Its confirm reads the ruled words, under the row, and Move here moves that row', async () => {
  const shown = await form({ candidates: [OPEN, SAVED] });
  try {
    sameElement(shown.target.querySelector('[role="alertdialog"]'), null, 'shut until asked');
    button(shown.target, PROJECT_WORDS.moveButton).click();
    shown.flush();

    const confirm = shown.target.querySelector('[role="alertdialog"]');
    assert.ok(confirm, 'the confirm opens');
    sameElement(confirm.previousElementSibling, lineOf(shown.target, OPEN), 'right under its row');
    const label = confirm.getAttribute('aria-labelledby');
    assert.equal(
      label && shown.target.querySelector(`[id="${label}"]`)?.textContent,
      PROJECT_WORDS.moveConfirm
    );
    assert.deepEqual(shown.chosen, [], 'opening the confirm opens nothing yet');

    button(confirm, PROJECT_WORDS.moveButton).click();
    shown.flush();
    assert.deepEqual(shown.moved, [OPEN]);
    sameElement(shown.target.querySelector('[role="alertdialog"]'), null, 'the confirm closes');
  } finally {
    await shown.unmount();
  }
});

test('Cancel closes the move confirm and moves nothing', async () => {
  const shown = await form({ candidates: [OPEN, SAVED] });
  try {
    button(shown.target, PROJECT_WORDS.moveButton).click();
    shown.flush();
    const confirm = shown.target.querySelector('[role="alertdialog"]');
    assert.ok(confirm);
    button(confirm, PROJECT_WORDS.moveCancel).click();
    shown.flush();
    sameElement(shown.target.querySelector('[role="alertdialog"]'), null, 'the confirm closes');
    assert.deepEqual(shown.moved, []);
  } finally {
    await shown.unmount();
  }
});

test("With the row's error showing, the move confirm comes first, then the error", async () => {
  const shown = await form({ candidates: [OPEN, SAVED], problemRow: OPEN.id });
  try {
    button(shown.target, PROJECT_WORDS.moveButton).click();
    shown.flush();
    const confirm = shown.target.querySelector('[role="alertdialog"]');
    assert.ok(confirm);
    sameElement(confirm.previousElementSibling, lineOf(shown.target, OPEN), 'under its row');
    const alert = shown.target.querySelector('[role="alert"]');
    assert.equal(alert?.textContent?.trim(), REFUSED);
    sameElement(alert?.previousElementSibling, confirm, 'the error after the confirm');
  } finally {
    await shown.unmount();
  }
});
