// The confirm before Move here ends a conversation in its terminal, as the
// page shows it: rendered on the server, so each test reads the real markup.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { render } from 'svelte/server';
import { compiledForServer } from './onboarding/compiled-for-server.ts';
import { PROJECT_WORDS } from '../project-words.ts';
import type MoveConfirmComponent from './MoveConfirm.svelte';

const MoveConfirm = await compiledForServer<typeof MoveConfirmComponent>(
  join(dirname(fileURLToPath(import.meta.url)), 'MoveConfirm.svelte')
);

const nothing = () => {};
const shown = (busy: boolean) =>
  render(MoveConfirm, { props: { busy, onconfirm: nothing, oncancel: nothing } }).body;

/** Each button's text, and whether it is disabled, in order. */
const buttons = (html: string) =>
  [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map(([, attributes, text]) => ({
    text,
    disabled: /\sdisabled\b/.test(attributes)
  }));

test('The move confirm asks in the ruled words, as an alert dialog named by them', () => {
  const html = shown(false);
  const dialog = /<div[^>]*role="alertdialog"[^>]*aria-labelledby="([^"]+)"/.exec(html);
  assert.ok(dialog, 'an alertdialog named by its words');
  const named = new RegExp(`<p id="${dialog[1]}"[^>]*>${PROJECT_WORDS.moveConfirm}</p>`);
  assert.match(html, named);
});

test('The move confirm offers Move here, then Cancel, and Move here waits while busy', () => {
  assert.deepEqual(buttons(shown(false)), [
    { text: PROJECT_WORDS.moveButton, disabled: false },
    { text: PROJECT_WORDS.cancel, disabled: false }
  ]);
  assert.deepEqual(buttons(shown(true)), [
    { text: PROJECT_WORDS.moveButton, disabled: true },
    { text: PROJECT_WORDS.cancel, disabled: false }
  ]);
});
