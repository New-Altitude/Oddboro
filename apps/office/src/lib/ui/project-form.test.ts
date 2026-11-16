// The Projects window's New session form: which fields show on each path.
// Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProjectAgent } from '@oddboro/ledger';
import { newSessionFields, type SessionPath } from './project-form.ts';

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
