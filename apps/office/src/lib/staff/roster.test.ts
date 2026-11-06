// What the page shows of an Odd. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StaffRow } from '@oddboro/ledger';
import { setZone } from '@oddboro/ledger/time';
import { ownerWords } from '../../../../../packages/ledger/test/owner-words.ts';
import { ACTIVITY_LABEL, toProfile } from './roster.ts';

test("an Odd hired on an evening in New York shows that day as its hire date, not tomorrow's UTC date", () => {
  setZone('America/New_York');
  // 8:30 PM in New York on Nov 3 is 01:30 UTC on Nov 4.
  const row = {
    id: 'penny',
    name: 'Penny',
    role: 'Writer',
    office: 'Main Street',
    sprite: 'staff',
    variant: 'a',
    portrait: 'a',
    room: 'workspace',
    permission: 'draft',
    agent: 'claude',
    tools: [],
    remit: 'Writes the newsletter.',
    desk: 'You are Penny.',
    look: null,
    portraitPx: null,
    hiredAt: new Date('2026-11-04T01:30:00Z'),
    leftAt: null
  } satisfies StaffRow;
  assert.equal(toProfile(row).hired, '2026-11-03');
});

test('no floor label names a thread or a hand-off', () => {
  ownerWords(...Object.values(ACTIVITY_LABEL));
});
