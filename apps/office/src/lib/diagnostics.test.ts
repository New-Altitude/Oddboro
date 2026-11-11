// The pure rules about where reports may go: which addresses need a New
// Altitude sign-in, and when the office offers reports at all. Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { needsSignIn, reportsOffered } from './diagnostics.ts';
// The shell's tests read the same cases, so the two languages keep one rule.
import cases from './needs-sign-in.cases.json' with { type: 'json' };

test("only New Altitude's https address, or the account site, needs a sign-in", () => {
  assert.ok(cases.length > 0);
  for (const { dsn, site, needs } of cases)
    assert.equal(
      needsSignIn({ address: dsn, accountSite: site ?? undefined }),
      needs,
      `${dsn} with site ${site}`
    );
});

test('reports are offered only when they can go and need no sign-in or have one', () => {
  const table = [
    { possible: false, account: false, signedIn: false, offered: false },
    { possible: false, account: true, signedIn: true, offered: false },
    { possible: true, account: false, signedIn: false, offered: true },
    { possible: true, account: false, signedIn: true, offered: true },
    { possible: true, account: true, signedIn: false, offered: false },
    { possible: true, account: true, signedIn: true, offered: true }
  ];
  for (const { signedIn, offered, ...state } of table)
    assert.equal(reportsOffered(state, signedIn), offered, JSON.stringify({ signedIn, ...state }));
});
