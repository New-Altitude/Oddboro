// The Projects window's New session form as the page shows it: which fields
// each path renders, where an error shows, and the continue path's list.
// NewSessionForm.svelte is compiled and rendered on the server, with its
// fields from newSessionFields, so each test reads the real markup over the
// real rule. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { render } from 'svelte/server';
import type { ProjectAgent } from '@oddboro/ledger';
import { compiledForServer } from './onboarding/compiled-for-server.ts';
import {
  newSessionFields,
  type Choice,
  type ErrorPlace,
  type Folder,
  type SessionPath
} from './project-form.ts';
import type NewSessionFormComponent from './NewSessionForm.svelte';

const NewSessionForm = await compiledForServer<typeof NewSessionFormComponent>(
  join(dirname(fileURLToPath(import.meta.url)), 'NewSessionForm.svelte')
);

const ONE_FOLDER: Folder[] = [
  { path: '/home/owner/.claude', mark: '~/.claude · owner@example.com' }
];
const TWO_FOLDERS: Folder[] = [
  ...ONE_FOLDER,
  { path: '/home/owner/.claude-second', mark: '~/.claude-second · second@example.com' }
];

/** The form as the page renders it, for a path and what the owner has so far. */
function shown(form: {
  path: SessionPath | undefined;
  folder?: string;
  agent?: ProjectAgent;
  folders?: Folder[];
  candidates?: Choice[];
  found?: boolean;
  problem?: string;
  place?: ErrorPlace;
  problemRow?: string;
}) {
  const { path, folder = '~/my-project', agent = 'claude', folders = TWO_FOLDERS } = form;
  const fields = newSessionFields({
    path,
    folder,
    agent,
    claudeFolders: folders.length,
    handingOver: false
  });
  return render(NewSessionForm, {
    props: {
      folder,
      agent,
      socket: '',
      name: '',
      startIn: folders[0]?.path ?? '',
      filter: '',
      path,
      fields,
      folders,
      candidates: form.candidates ?? [],
      found: form.found ?? false,
      busy: false,
      problem: form.problem,
      place: form.place,
      problemRow: form.problemRow,
      onfilter: () => {},
      onchange: () => {},
      onpick: () => {},
      onpath: () => {},
      onstart: () => {},
      onchoose: () => {},
      onhandover: () => {}
    }
  }).body;
}

/** `n` conversations, newest first, each with an id that starts with its number. */
const conversations = (n: number): Choice[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${String(i + 1).padStart(8, '0')}-0000-4000-8000-000000000000`,
    title: `Conversation ${i + 1}`,
    live: false,
    updated: Date.UTC(2026, 10, 16) - i * 60_000
  }));

const REFRESH = /<button class="link[^"]*"[^>]*>Refresh list<\/button>/;
/** Svelte's own markers between elements, and whitespace. */
const GAP = String.raw`(?:\s|<!--[^>]*-->)*`;

test('Refresh list shows at the end of the filter row on the continue path with a folder', () => {
  const body = shown({ path: 'continue', candidates: conversations(3), found: true });
  assert.match(
    body,
    new RegExp(`aria-label="Filter conversations"[^>]*/?>${GAP}${REFRESH.source}`)
  );
});

test('Refresh list shows while the list is empty or not loaded yet, as after /bg', () => {
  assert.match(shown({ path: 'continue', found: true }), REFRESH);
  assert.match(shown({ path: 'continue', found: false }), REFRESH);
});

test('without a folder the continue path asks for one, in place of Refresh list', () => {
  const body = shown({ path: 'continue', folder: '' });
  assert.match(
    body,
    /<p class="text-muted">Choose a project folder to see its conversations\.<\/p>/
  );
  assert.doesNotMatch(body, REFRESH);
});

test('Refresh list never shows on the start path or before a path is chosen', () => {
  for (const path of ['start', undefined] as const) {
    assert.doesNotMatch(shown({ path, candidates: conversations(3), found: true }), REFRESH, path);
  }
});

test('no Find existing button renders on either path', () => {
  for (const path of ['start', 'continue', undefined] as const) {
    assert.doesNotMatch(shown({ path }), /Find existing/, path);
  }
});

const REFUSED = 'That conversation is no longer in ~/.claude-second · second@example.com.';
const ALERT = `<p role="alert" class="text-coral">${REFUSED}</p>`;
/** The end of a conversation's row: the first 8 characters of its id close the button. */
const rowEnd = (c: Choice) => `${c.id.slice(0, 8)}</button>`;
const alerts = (body: string) => body.split('role="alert"').length - 1;

test('an error opening the last of a long list shows right under that row, and only there', () => {
  for (const n of [12, 13, 20, 40]) {
    const rows = conversations(n);
    const last = rows[n - 1];
    const body = shown({
      path: 'continue',
      candidates: rows,
      found: true,
      problem: REFUSED,
      place: 'row',
      problemRow: last.id
    });
    assert.ok(new RegExp(`${rowEnd(last)}${GAP}${ALERT}`).test(body), `${n} rows`);
    assert.equal(alerts(body), 1, `${n} rows`);
  }
});

test('an error opening the first row shows between it and the second row', () => {
  const rows = conversations(40);
  const body = shown({
    path: 'continue',
    candidates: rows,
    found: true,
    problem: REFUSED,
    place: 'row',
    problemRow: rows[0].id
  });
  const at = body.indexOf(ALERT);
  assert.ok(at > body.indexOf(rowEnd(rows[0])));
  assert.ok(at < body.indexOf(rowEnd(rows[1])));
  assert.equal(alerts(body), 1);
});

test('an error listing the conversations shows above the rows', () => {
  const rows = conversations(40);
  const body = shown({
    path: 'continue',
    candidates: rows,
    found: true,
    problem: REFUSED,
    place: 'list'
  });
  const at = body.indexOf(ALERT);
  assert.ok(at > -1, 'the list error renders');
  assert.ok(at < body.indexOf(rowEnd(rows[0])));
  assert.equal(alerts(body), 1);
});

test('an error starting a conversation shows under Start', () => {
  const body = shown({ path: 'start', problem: REFUSED, place: 'start' });
  assert.match(body, new RegExp(`>Start</button>${GAP}${ALERT}`));
});

test('Account and Session name never render on the continue path', () => {
  for (const folders of [ONE_FOLDER, TWO_FOLDERS]) {
    const body = shown({ path: 'continue', folders, candidates: conversations(3), found: true });
    assert.doesNotMatch(body, /aria-label="Account"/);
    assert.doesNotMatch(body, /Session name/);
  }
});

test('Account renders on the start path with two Claude folders, and not with one', () => {
  assert.match(shown({ path: 'start', folders: TWO_FOLDERS }), /aria-label="Account"/);
  const one = shown({ path: 'start', folders: ONE_FOLDER });
  assert.doesNotMatch(one, /aria-label="Account"/);
  assert.match(one, /Session name/);
});
