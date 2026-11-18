// Whether a follow-up's run works at Draft at most (`runsAtDraft`), for every
// kind, with and without a colleague's hand-off it serves, an approval ask it
// carries out, and the owner's choice to let the Odd act on its own on work
// from colleagues. The expected value is the rule as the office had it before
// the work core held it in one place: apps/office/src/lib/server/staff.ts at
// main 04b50575, lines 1624 to 1628, with that commit's `AT_DRAFT`
// (packages/ledger/src/hand-offs.ts, lines 299 to 311) copied out below.
// Copied, not imported, so a change to the code's table fails here. Run with
// `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FOLLOW_UP_KINDS, runsAtDraft, type FollowUpKind } from '../src/work/kinds.ts';

/**
 * Main's `AT_DRAFT` row for each kind. `answered` is a kind main lacks: it
 * keeps the work core's value. Main's `feedback` row is gone with its kind.
 */
const MAIN_AT_DRAFT: Record<FollowUpKind, boolean> = {
  carry_out: false,
  rework: false,
  denied: true,
  task_done: false,
  goal: false,
  first_day: false,
  hand_off: false,
  handed_back: true,
  resume: true,
  answered: true,
  edited: true
};

/** Main's `draftOnly`, word for word but for the names of its inputs. */
const mainDraftOnly = (
  kind: FollowUpKind,
  serves: boolean,
  askKind: 'approval' | 'filter' | undefined,
  actsOnHandOffs: boolean
): boolean =>
  MAIN_AT_DRAFT[kind] ||
  (serves && !(kind === 'carry_out' && askKind === 'approval') && !actsOnHandOffs);

test('a run is at Draft exactly when the office said so before the work core, for every kind, hand-off, approval and owner choice', () => {
  const wrong: string[] = [];
  let rows = 0;
  for (const kind of FOLLOW_UP_KINDS)
    for (const serves of [false, true])
      for (const askKind of ['approval', 'filter', undefined] as const)
        for (const actsOnHandOffs of [false, true]) {
          rows++;
          const expected = mainDraftOnly(kind, serves, askKind, actsOnHandOffs);
          // As follow-through.ts and work/runs.ts both pass it.
          const carriesApproval = kind === 'carry_out' && askKind === 'approval';
          const got = runsAtDraft({ kind, serves, carriesApproval, actsOnHandOffs });
          if (got !== expected)
            wrong.push(
              `${kind}, serves ${serves}, ask ${askKind}, acts on hand-offs ${actsOnHandOffs}: ${got}, not ${expected}`
            );
        }
  assert.equal(rows, FOLLOW_UP_KINDS.length * 2 * 3 * 2);
  assert.deepEqual(wrong, []);
});
