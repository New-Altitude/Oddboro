// The New session form mounted in a browser-like document, typed into and
// clicked as the owner does, so the events its markup wires are what a test
// reads: which change each one reports, and an error scrolling into view.
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import {
  button,
  folderField,
  form,
  one,
  pick,
  REFUSED,
  sameElement
} from './projects-window-under-test.ts';
import type { Choice } from './project-form.ts';

const ROW: Choice = {
  id: '33333333-0000-4000-8000-000000000000',
  title: 'Saved earlier',
  live: false,
  updated: Date.UTC(2026, 10, 15)
};
test('Each control on the form reports the change it makes, so only a committed one can list', async (t) => {
  await t.test(
    'typing in the folder reports each keystroke as typing, never as a folder',
    async () => {
      const shown = await form({ candidates: [ROW] });
      try {
        const field = folderField(shown.target);
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
    const shown = await form({ candidates: [ROW] });
    try {
      const field = folderField(shown.target);
      field.value = '/work/other';
      field.dispatchEvent(new Event('change', { bubbles: true }));
      shown.flush();
      assert.deepEqual(shown.reported, ['folder']);
    } finally {
      await shown.unmount();
    }
  });

  await t.test('switching the coding tool reports the tool', async () => {
    const shown = await form({ candidates: [ROW] });
    try {
      pick(shown.target, 'Coding tool', 'codex');
      shown.flush();
      assert.deepEqual(shown.reported, ['tool']);
    } finally {
      await shown.unmount();
    }
  });

  await t.test('Refresh list reports a refresh, on each press', async () => {
    const shown = await form({ candidates: [ROW] });
    try {
      const refresh = button(shown.target, 'Refresh list');
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
  const shown = await form({ candidates: [ROW], problemRow: ROW.id });
  try {
    const alert = one(shown.target, '[role="alert"]');
    assert.equal(alert.textContent?.trim(), REFUSED);
    assert.equal(scrolled.mock.callCount(), 1);
    const [call] = scrolled.mock.calls;
    sameElement(call.this, alert, 'the error itself scrolls, nothing else');
    assert.deepEqual(call.arguments, [{ block: 'nearest' }]);
  } finally {
    scrolled.mock.restore();
    await shown.unmount();
  }
});
