// The Projects window's Focus choice, kept in the browser's storage. Node has
// no `localStorage`, so each test puts its own on `globalThis`, as a page has it.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { focusRemembered, rememberFocus } from './projects-focus.ts';

/** Puts `store` where the page finds its storage; undefined takes it away. */
function storage(store: Pick<Storage, 'getItem' | 'setItem'> | undefined) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: store,
    configurable: true,
    writable: true
  });
}
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

/** A store that keeps what it is given, as the browser's does. */
function kept() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value)
  };
}
const blocked = () => {
  throw new Error('The operation is insecure.');
};

test('The Focus choice is remembered on this computer and is off when storage is unavailable', async (t) => {
  await t.test('off until the owner chooses it, then kept on and off', () => {
    const store = kept();
    storage(store);
    assert.equal(focusRemembered(), false);
    rememberFocus(true);
    assert.equal(store.items.get('oddboro.projects.focus'), '1');
    assert.equal(focusRemembered(), true);
    rememberFocus(false);
    assert.equal(focusRemembered(), false);
  });

  await t.test('off when reading the store throws, and choosing it throws nothing', () => {
    storage({ getItem: blocked, setItem: blocked });
    assert.equal(focusRemembered(), false);
    assert.doesNotThrow(() => rememberFocus(true));
  });

  await t.test('off when there is no store at all', () => {
    storage(undefined);
    assert.equal(focusRemembered(), false);
    assert.doesNotThrow(() => rememberFocus(true));
  });
});
