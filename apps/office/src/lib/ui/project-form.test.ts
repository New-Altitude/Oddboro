// The Projects window's New session form: which fields show on each path, and
// which conversations the filter keeps, and where an error shows.
// Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProjectAgent } from '@oddboro/ledger';
import {
  errorPlace,
  listAsk,
  listFor,
  lists,
  matchesFilter,
  newSessionFields,
  rowsFor,
  type Choice,
  type ErrorSource,
  type FormChange,
  type Found,
  type ListAsk,
  type SessionPath
} from './project-form.ts';

const AGENTS: ProjectAgent[] = ['claude', 'codex'];
const PATHS: (SessionPath | undefined)[] = [undefined, 'start', 'continue'];

/** Every form the owner can reach: each path, folder or none, tool, folder count and hand-over. */
const forms = PATHS.flatMap((path) =>
  ['', '~/my-project'].flatMap((folder) =>
    AGENTS.flatMap((agent) =>
      [1, 2, 3].flatMap((claudeFolders) =>
        [false, true].map((handingOver) => ({ path, folder, agent, claudeFolders, handingOver }))
      )
    )
  )
);

test('nothing that belongs to a path shows before the owner picks one', () => {
  for (const form of forms.filter((f) => !f.path)) {
    const shown = newSessionFields(form);
    assert.deepEqual(
      [shown.account, shown.start, shown.list, shown.refresh, shown.handover],
      [false, false, false, false, false],
      JSON.stringify(form)
    );
  }
});

test('Account and Session name never show on the continue path', () => {
  for (const form of forms.filter((f) => f.path === 'continue')) {
    const shown = newSessionFields(form);
    assert.equal(shown.account, false, JSON.stringify(form));
    assert.equal(shown.start, false, JSON.stringify(form));
  }
});

test('Account never shows with one Claude folder known', () => {
  for (const form of forms.filter((f) => f.claudeFolders === 1)) {
    assert.equal(newSessionFields(form).account, false, JSON.stringify(form));
  }
});

test('Account shows on the start path for Claude Code with two or more Claude folders', () => {
  for (const claudeFolders of [2, 3]) {
    const form = {
      path: 'start',
      folder: '~/my-project',
      agent: 'claude',
      claudeFolders,
      handingOver: false
    } as const;
    assert.equal(newSessionFields(form).account, true);
  }
  const codex = {
    path: 'start',
    folder: '~/my-project',
    agent: 'codex',
    claudeFolders: 3,
    handingOver: false
  } as const;
  assert.equal(newSessionFields(codex).account, false);
});

test('the start path shows Session name and Start, and no list or Refresh list', () => {
  for (const form of forms.filter((f) => f.path === 'start')) {
    const shown = newSessionFields(form);
    assert.equal(shown.start, true, JSON.stringify(form));
    assert.equal(shown.list, false, JSON.stringify(form));
    assert.equal(shown.refresh, false, JSON.stringify(form));
  }
});

test('Refresh list shows on the continue path once a folder is set, and never without one', () => {
  for (const form of forms.filter((f) => f.path === 'continue' && !f.handingOver)) {
    assert.equal(newSessionFields(form).refresh, !!form.folder, JSON.stringify(form));
  }
  const blank = { path: 'continue', folder: '  ', agent: 'claude', claudeFolders: 1 } as const;
  assert.equal(newSessionFields({ ...blank, handingOver: false }).refresh, false);
});

test('the hand-over never shows on the start path', () => {
  for (const form of forms.filter((f) => f.path === 'start')) {
    assert.equal(newSessionFields(form).handover, false, JSON.stringify(form));
  }
});

test('on the continue path the hand-over takes the place of the list', () => {
  for (const agent of AGENTS) {
    const listing = newSessionFields({
      path: 'continue',
      folder: '~/my-project',
      agent,
      claudeFolders: 2,
      handingOver: false
    });
    assert.deepEqual([listing.list, listing.handover], [true, false]);
    const handing = newSessionFields({
      path: 'continue',
      folder: '~/my-project',
      agent,
      claudeFolders: 2,
      handingOver: true
    });
    assert.deepEqual([handing.list, handing.handover], [false, true]);
  }
});

test("a running Codex server's socket shows for Codex on either path, and never for Claude Code", () => {
  for (const form of forms.filter((f) => f.agent === 'codex')) {
    assert.equal(newSessionFields(form).socket, true, JSON.stringify(form));
  }
  for (const form of forms.filter((f) => f.agent === 'claude')) {
    assert.equal(newSessionFields(form).socket, false, JSON.stringify(form));
  }
});

/** Conversations as the continue path lists them, with marks shaped as `claudeFolderMark` makes them. */
const FOUND = [
  {
    id: '3f2a9c71-0b1e-4d2a-9f00-111111111111',
    title: 'Fix the checkout page',
    mark: '~/.claude-personal · owner@example.com'
  },
  {
    id: 'a81d04be-77c2-4e55-8a00-222222222222',
    title: 'Draft the release notes',
    mark: '~/.claude · work@example.org'
  },
  { id: 'c0dex000-1111-2222-3333-444444444444', title: 'Codex refactor', mark: null }
];
const kept = (typed: string) => FOUND.filter((c) => matchesFilter(c, typed)).map((c) => c.title);

test('the filter keeps conversations whose title holds the words, in any case', () => {
  assert.deepEqual(kept('CHECKOUT'), ['Fix the checkout page']);
});

test("the filter keeps conversations by their account's Claude folder", () => {
  assert.deepEqual(kept('~/.claude-personal'), ['Fix the checkout page']);
});

test("the filter keeps conversations by their account's login", () => {
  assert.deepEqual(kept('work@example'), ['Draft the release notes']);
});

test('the filter keeps a conversation by the first 8 characters of its id', () => {
  assert.deepEqual(kept('A81D04BE'), ['Draft the release notes']);
  assert.deepEqual(kept('3f2a9c71'), ['Fix the checkout page']);
});

test('the filter matches an id only from its start', () => {
  assert.deepEqual(kept('9c71'), []);
});

test('the filter keeps nothing when nothing matches', () => {
  assert.deepEqual(kept('invoice'), []);
});

test('an empty or blank filter keeps every conversation', () => {
  const all = FOUND.map((c) => c.title);
  assert.deepEqual(kept(''), all);
  assert.deepEqual(kept('   '), all);
});

const SOURCES: ErrorSource[] = ['pick', 'start', 'continue', 'connect', 'load', 'session'];

test('an error opening a conversation from the list shows above the rows, not after them', () => {
  assert.equal(errorPlace('connect', false), 'list');
});

test('an error listing the conversations shows above the rows', () => {
  assert.equal(errorPlace('continue', false), 'list');
});

test('an error starting a conversation shows under Start', () => {
  assert.equal(errorPlace('start', false), 'start');
});

test('an error choosing a folder shows under the Project folder field', () => {
  assert.equal(errorPlace('pick', false), 'folder');
});

test('an error reading the sessions shows at the top of the form', () => {
  assert.equal(errorPlace('load', false), 'top');
});

test('with a session open, every error shows in its pane', () => {
  for (const source of SOURCES) assert.equal(errorPlace(source, true), 'session', source);
});

/** What the form asks a list about, for a folder, a tool and the socket typed. */
const asking = (folder: string, agent: ProjectAgent = 'claude', socket = '') =>
  listAsk({ folder, agent, socket });
const ROWS: Choice[] = [
  {
    id: '3f2a9c71-0b1e-4d2a-9f00-111111111111',
    title: 'Fix the checkout page',
    live: false,
    updated: 0
  }
];
const inA = { ask: asking('~/project-a'), rows: ROWS };

test('rows listed for one folder never show once the folder changes, typed or chosen', () => {
  assert.equal(rowsFor(inA, asking('~/project-b')), undefined);
  assert.equal(rowsFor(inA, asking('~/project-a/sub')), undefined);
});

test('choosing the same folder again keeps its rows', () => {
  assert.deepEqual(rowsFor(inA, asking('~/project-a')), ROWS);
});

test('rows listed for one coding tool never show for the other', () => {
  assert.equal(rowsFor(inA, asking('~/project-a', 'codex')), undefined);
});

test("a Codex list's rows never show for another socket, and Claude Code sends none", () => {
  const codex = { ask: asking('~/project-a', 'codex', '/tmp/a.sock'), rows: ROWS };
  assert.equal(rowsFor(codex, asking('~/project-a', 'codex', '/tmp/b.sock')), undefined);
  assert.deepEqual(rowsFor(codex, asking('~/project-a', 'codex', ' /tmp/a.sock ')), ROWS);
  assert.equal(asking('~/project-a', 'claude', '/tmp/a.sock').socket, undefined);
  assert.equal(asking('~/project-a', 'codex', '  ').socket, undefined);
});

test('a folder with nothing listed yet shows no rows', () => {
  assert.equal(rowsFor(undefined, asking('~/project-a')), undefined);
});

/** Whether `change` lists, on a form at `path` asking `now`, with what the last lists found and asked. */
const listsOn = (
  change: FormChange,
  form: { path?: SessionPath; now: ListAsk; found?: Found; loading?: ListAsk }
) => lists(change, { path: form.path, now: form.now, found: form.found, loading: form.loading });
const CHANGES: FormChange[] = ['path', 'typed', 'folder', 'tool', 'refresh'];
const inB = asking('~/project-b');

test('choosing Continue with a folder lists once, and again only for a changed ask', () => {
  assert.equal(listsOn('path', { path: 'continue', now: inA.ask }), true);
  assert.equal(listsOn('path', { path: 'continue', now: inA.ask, found: inA }), false);
  assert.equal(listsOn('path', { path: 'continue', now: inA.ask, loading: inA.ask }), false);
  assert.equal(listsOn('path', { path: 'continue', now: inB, found: inA }), true);
});

test('with no folder, nothing lists, whatever the change', () => {
  for (const change of CHANGES) {
    for (const folder of ['', '   ']) {
      assert.equal(listsOn(change, { path: 'continue', now: asking(folder) }), false, change);
    }
  }
});

test('typing in the folder or socket field never lists until the field is left', () => {
  assert.equal(listsOn('typed', { path: 'continue', now: inB, found: inA }), false);
  assert.equal(listsOn('folder', { path: 'continue', now: inB, found: inA }), true);
});

test('Choose folder lists a different folder once, and the same folder not at all', () => {
  assert.equal(listsOn('folder', { path: 'continue', now: inB, found: inA }), true);
  assert.equal(listsOn('folder', { path: 'continue', now: inA.ask, found: inA }), false);
});

test('switching the coding tool lists once', () => {
  const codex = asking('~/project-a', 'codex');
  assert.equal(listsOn('tool', { path: 'continue', now: codex, found: inA }), true);
});

test('Refresh list lists on every press, even with the rows shown or a list loading', () => {
  assert.equal(listsOn('refresh', { path: 'continue', now: inA.ask, found: inA }), true);
  assert.equal(listsOn('refresh', { path: 'continue', now: inA.ask, loading: inA.ask }), true);
});

test('a change while a list loads lists its own ask, not swallowed by that list', () => {
  assert.equal(listsOn('folder', { path: 'continue', now: inB, loading: inA.ask }), true);
  const codex = asking('~/project-a', 'codex');
  assert.equal(listsOn('tool', { path: 'continue', now: codex, loading: inA.ask }), true);
});

test('nothing lists on the start path or before a path is chosen', () => {
  for (const path of [undefined, 'start'] as const) {
    for (const change of CHANGES) {
      assert.equal(listsOn(change, { path, now: inB, found: inA }), false, `${path} ${change}`);
    }
  }
});

/** A list run against a fake request: how often it asked, and what reached the form. */
async function listed(
  ask: ListAsk,
  answer: () => Promise<Choice[]>,
  /** What the form asks once the request is out. */
  then: ListAsk
) {
  let now = ask;
  const seen: string[] = [];
  let asked = 0;
  const shown: { found?: Found; error?: unknown } = {};
  await listFor(ask, {
    find: (a) => {
      asked++;
      assert.deepEqual(a, ask);
      now = then;
      return answer();
    },
    start: () => seen.push('start'),
    now: () => now,
    found: (f) => (shown.found = f),
    failed: (e) => (shown.error = e)
  });
  return { asked, seen, ...shown };
}

test('a list asks once, clears an earlier error as it starts, and lands its rows', async () => {
  const done = await listed(inA.ask, async () => ROWS, inA.ask);
  assert.equal(done.asked, 1);
  assert.deepEqual(done.seen, ['start']);
  assert.deepEqual(done.found, inA);
  assert.equal(done.error, undefined);
});

test('a list for a folder no longer chosen drops its rows', async () => {
  const done = await listed(inA.ask, async () => ROWS, inB);
  assert.equal(done.found, undefined);
});

test('a list for a tool no longer chosen drops its rows', async () => {
  const done = await listed(inA.ask, async () => ROWS, asking('~/project-a', 'codex'));
  assert.equal(done.found, undefined);
});

test('a failed list reports its error while its folder is still chosen', async () => {
  const refusal = new Error('That folder is not there.');
  const done = await listed(inA.ask, () => Promise.reject(refusal), inA.ask);
  assert.equal(done.error, refusal);
  assert.equal(done.found, undefined);
});

test('a failed list for a folder or tool no longer chosen drops its error', async () => {
  const refusal = new Error('That folder is not there.');
  for (const then of [inB, asking('~/project-a', 'codex')]) {
    const done = await listed(inA.ask, () => Promise.reject(refusal), then);
    assert.equal(done.error, undefined, then.folder + then.agent);
  }
});
