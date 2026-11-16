// The Projects window's New session form: which fields show on each path, and
// which conversations the filter keeps, and where an error shows.
// Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProjectAgent } from '@oddboro/ledger';
import {
  errorPlace,
  listAsk,
  matchesFilter,
  newSessionFields,
  rowsFor,
  type Choice,
  type ErrorSource,
  type SessionPath
} from './project-form.ts';

const AGENTS: ProjectAgent[] = ['claude', 'codex'];
const PATHS: (SessionPath | undefined)[] = [undefined, 'start', 'continue'];

/** Every form the owner can reach: each path, tool, folder count and hand-over. */
const forms = PATHS.flatMap((path) =>
  AGENTS.flatMap((agent) =>
    [1, 2, 3].flatMap((claudeFolders) =>
      [false, true].map((handingOver) => ({ path, agent, claudeFolders, handingOver }))
    )
  )
);

test('nothing that belongs to a path shows before the owner picks one', () => {
  for (const form of forms.filter((f) => !f.path)) {
    const shown = newSessionFields(form);
    assert.deepEqual(
      [shown.account, shown.start, shown.list, shown.handover],
      [false, false, false, false],
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
    const form = { path: 'start', agent: 'claude', claudeFolders, handingOver: false } as const;
    assert.equal(newSessionFields(form).account, true);
  }
  const codex = { path: 'start', agent: 'codex', claudeFolders: 3, handingOver: false } as const;
  assert.equal(newSessionFields(codex).account, false);
});

test('the start path shows Session name and Start, and no list', () => {
  for (const form of forms.filter((f) => f.path === 'start')) {
    const shown = newSessionFields(form);
    assert.equal(shown.start, true, JSON.stringify(form));
    assert.equal(shown.list, false, JSON.stringify(form));
  }
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
      agent,
      claudeFolders: 2,
      handingOver: false
    });
    assert.deepEqual([listing.list, listing.handover], [true, false]);
    const handing = newSessionFields({
      path: 'continue',
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

/** Conversations as Find existing lists them, with marks shaped as `claudeFolderMark` makes them. */
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
