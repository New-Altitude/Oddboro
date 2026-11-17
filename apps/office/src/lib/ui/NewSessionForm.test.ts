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
import { PROJECT_WORDS } from '../project-words.ts';
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

const ONE_FOLDER: Folder[] = [{ path: '/work/.claude', mark: '~/.claude · owner@example.com' }];
const TWO_FOLDERS: Folder[] = [
  ...ONE_FOLDER,
  { path: '/work/.claude-second', mark: '~/.claude-second · second@example.com' }
];

/** The form as the page renders it, for a path and what the owner has so far. */
function shown(form: {
  path: SessionPath | undefined;
  folder?: string;
  agent?: ProjectAgent;
  folders?: Folder[];
  candidates?: Choice[];
  found?: boolean;
  listing?: boolean;
  problem?: string;
  place?: ErrorPlace;
  problemRow?: string;
  setup?: { id: string; view: string };
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
      listing: form.listing ?? false,
      busy: false,
      problem: form.problem,
      place: form.place,
      problemRow: form.problemRow,
      setup: form.setup,
      onfilter: () => {},
      onchange: () => {},
      onpick: () => {},
      onpath: () => {},
      onstart: () => {},
      onchoose: () => {},
      onmove: () => {},
      onsetuperror: () => {},
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

test('Refresh list shows while the list is empty or not loaded yet', () => {
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
/** The end of the row's line, which holds the row's button and any button beside it. */
const lineEnd = (c: Choice) => `${rowEnd(c)}${GAP}</div>`;
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
    assert.ok(new RegExp(`${lineEnd(last)}${GAP}${ALERT}`).test(body), `${n} rows`);
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

/** One conversation of each kind a Claude Code list can hold. */
function kinds(): Record<'movable' | 'windows' | 'running' | 'saved', Choice> {
  const [movable, windows, running, saved] = conversations(4);
  return {
    movable: { ...movable, live: true, movable: true },
    windows: { ...windows, live: true, movable: false },
    running: { ...running, live: true, job: 'job-1', movable: true },
    saved
  };
}
const MOVE = `>${PROJECT_WORDS.moveButton}</button>`;
const moves = (body: string) => body.split(MOVE).length - 1;

test('Move here shows only on a row the office says can move', () => {
  const rows = kinds();
  const body = shown({ path: 'continue', candidates: Object.values(rows), found: true });
  assert.equal(moves(body), 1);
  // Beside the row's own button, never inside it.
  assert.match(body, new RegExp(`${rowEnd(rows.movable)}${GAP}<button[^>]*${MOVE}`));
  // Only the row the office can move gets its own button after it.
  const after = (c: Choice) => body.slice(body.indexOf(rowEnd(c))).split('</div>')[0];
  assert.doesNotMatch(after(rows.windows), new RegExp(MOVE), 'open in a terminal, not movable');
  assert.doesNotMatch(after(rows.running), new RegExp(MOVE), 'running in the background');
});

test('each row says whether its conversation is open in a terminal, running or saved', () => {
  const rows = kinds();
  const body = shown({ path: 'continue', candidates: Object.values(rows), found: true });
  const label = (c: Choice) =>
    body
      .slice(0, body.indexOf(rowEnd(c)))
      .split('<button')
      .at(-1);
  assert.match(label(rows.movable) ?? '', new RegExp(` · ${PROJECT_WORDS.inTerminal} · `));
  assert.match(label(rows.windows) ?? '', new RegExp(` · ${PROJECT_WORDS.inTerminal} · `));
  assert.match(label(rows.running) ?? '', / · Running · /);
  assert.match(label(rows.saved) ?? '', / · Saved · /);
});

test('a running Codex conversation reads as running and offers no move', () => {
  const rows = kinds();
  const body = shown({
    path: 'continue',
    agent: 'codex',
    candidates: [rows.movable],
    found: true
  });
  assert.match(body, / · Running · /);
  assert.equal(moves(body), 0);
});

const LOOKING = `<p class="text-xs text-muted">${PROJECT_WORDS.looking}</p>`;

test('while a list loads, one line under Refresh list says the office is looking', () => {
  const body = shown({ path: 'continue', listing: true });
  assert.match(body, new RegExp(`${REFRESH.source}${GAP}</div>${GAP}${LOOKING}`));
  assert.equal(body.split(PROJECT_WORDS.looking).length - 1, 1);
  assert.doesNotMatch(shown({ path: 'continue', found: true }), new RegExp(PROJECT_WORDS.looking));
});

test("a row's error whose row is no longer shown shows at the list", () => {
  const rows = conversations(3);
  const gone = conversations(4)[3];
  const body = shown({
    path: 'continue',
    candidates: rows,
    found: true,
    problem: REFUSED,
    place: 'row',
    problemRow: gone.id
  });
  const at = body.indexOf(ALERT);
  assert.ok(at > body.indexOf('Refresh list'), 'the error renders under Refresh list');
  assert.ok(at < body.indexOf(rowEnd(rows[0])), 'above the rows');
  assert.equal(alerts(body), 1);
  // With no rows at all, as after the folder changed, it still shows.
  const none = shown({ path: 'continue', problem: REFUSED, place: 'row', problemRow: gone.id });
  assert.equal(alerts(none), 1);
});

test("Claude Code's question about a new folder shows under Start, with Start again", () => {
  const setup = {
    id: '11111111-0000-4000-8000-000000000000',
    view: '22222222-0000-4000-8000-000000000000'
  };
  const body = shown({ path: 'start', setup });
  const start = body.indexOf('>Start</button>');
  const line = body.indexOf(PROJECT_WORDS.trustLine);
  const terminal = body.indexOf('bg-night');
  const again = body.indexOf(`>${PROJECT_WORDS.startAgain}</button>`);
  assert.ok(start > -1 && start < line, 'the trust line is under Start');
  assert.ok(line < terminal, 'then the terminal');
  assert.ok(terminal < again, 'then Start again');

  const without = shown({ path: 'start' });
  assert.ok(!without.includes(PROJECT_WORDS.trustLine));
  assert.ok(!without.includes(PROJECT_WORDS.startAgain));
  assert.ok(!without.includes('bg-night'));
});
