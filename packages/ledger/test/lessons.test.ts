// Whether a lesson's quote is the owner's own words, so whether it goes live
// by itself, who it is for, which follow-up notes are the owner's, what an Odd
// sees of an edit, that a lesson replacing another says why, and how a run's
// prompt lists one. Run with
// `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EDIT_CHARS,
  editShown,
  heardIn,
  keptAs,
  lessonLine,
  NOTE_IS_OWNERS,
  ownerNoteOf,
  replacingProblem
} from '../src/lessons.ts';
import type { FollowUpKind } from '../src/schema.ts';

const said = 'Please, keep  reports to “three lines” from now on!';

test('a quote is heard whatever its case, spacing, quote marks or end punctuation', () => {
  assert.equal(heardIn('KEEP REPORTS TO THREE LINES', said), true);
  assert.equal(heardIn('keep reports   to three lines', said), true);
  assert.equal(heardIn('keep reports to "three lines"', said), true);
  assert.equal(heardIn('Keep reports to three lines from now on.', said), true);
});

test('an empty quote is not heard', () => {
  assert.equal(heardIn('', said), false);
  assert.equal(heardIn(' ?! ', said), false);
});

test('a quote under three words is not heard, however exactly it matches', () => {
  assert.equal(heardIn('three lines', said), false);
  assert.equal(heardIn('to three lines', said), true);
});

test('part of a word is not heard as the word', () => {
  assert.equal(heardIn('ports to three', 'keep reports to three lines'), false);
  assert.equal(heardIn('keep reports to thr', 'keep reports to three lines'), false);
});

test('a quote is not heard when the run carried none of the owner words', () => {
  assert.equal(heardIn('keep reports to three lines', undefined), false);
  assert.equal(heardIn('keep reports to three lines', ''), false);
});

test('a quote whose words differ from what the owner said is not heard', () => {
  assert.equal(heardIn('keep reports to two lines', said), false);
  assert.equal(heardIn('keep all reports to three lines', said), false);
});

const chat = { text: said, from: 'chat' } as const;
const how = (a: Omit<Parameters<typeof keptAs>[1], 'scope'>) =>
  keptAs('ziva', { scope: 'me', ...a }).how;

test('a said lesson whose quote is not in the owner words counts as inferred', () => {
  assert.equal(how({ how: 'said', quote: 'never book before 9', ownerWords: chat }), 'inferred');
  assert.equal(how({ how: 'said', quote: 'never book before 9' }), 'inferred');
});

test('a said lesson whose quote is in the owner words stays said', () => {
  assert.equal(
    how({ how: 'said', quote: 'keep reports to three lines', ownerWords: chat }),
    'said'
  );
});

test('an inferred lesson stays inferred even when its quote was heard', () => {
  assert.equal(
    how({ how: 'inferred', quote: 'keep reports to three lines', ownerWords: chat }),
    'inferred'
  );
});

test('a lesson for everyone from a chat or a note is for every Odd', () => {
  const a = { how: 'said', scope: 'everyone', quote: 'keep reports to three lines' } as const;
  assert.equal(keptAs('ziva', { ...a, ownerWords: chat }).staffId, null);
  assert.equal(keptAs('ziva', { ...a, ownerWords: { text: said, from: 'note' } }).staffId, null);
});

test('words from an edit make only a guess for the Odd that read it, whatever it asks', () => {
  assert.deepEqual(
    keptAs('ziva', {
      how: 'said',
      scope: 'everyone',
      quote: 'keep reports to three lines',
      ownerWords: { text: said, from: 'edit' }
    }),
    { how: 'inferred', staffId: 'ziva' }
  );
});

test('an edit shows whole when both versions fit', () => {
  assert.deepEqual(editShown('Dear Sam,', 'Hi Sam,'), {
    from: 0,
    before: 'Dear Sam,',
    now: 'Hi Sam,'
  });
});

test('an edit far down a long file still shows, with a little before it', () => {
  const head = 'x'.repeat(EDIT_CHARS * 3);
  const shown = editShown(`${head}Dear Sam,`, `${head}Hi Sam,`);
  assert.ok(shown.from > 0);
  assert.ok(shown.before.endsWith('Dear Sam,'));
  assert.ok(shown.now.endsWith('Hi Sam,'));
  assert.ok(shown.now.length <= EDIT_CHARS && shown.now.length > 'Hi Sam,'.length);
});

test('a lesson that replaces another is refused until it says why', () => {
  assert.match(replacingProblem({ replaces: 4 }) ?? '', /why_replaced/);
});

test('a reason for replacing is refused when nothing is replaced', () => {
  assert.match(replacingProblem({ whyReplaced: 'missed' }) ?? '', /replaces/);
});

test('a lesson replaces another once it says it missed it or refined it', () => {
  assert.equal(replacingProblem({ replaces: 4, whyReplaced: 'missed' }), undefined);
  assert.equal(replacingProblem({ replaces: 4, whyReplaced: 'refined' }), undefined);
});

test('a new lesson that replaces nothing needs no reason', () => {
  assert.equal(replacingProblem({}), undefined);
});

test('a lesson for everywhere is listed with no place', () => {
  assert.equal(
    lessonLine(
      { id: 4, staffId: null, text: 'Start with the date.', appliesTo: null, quote: 'date first' },
      'Nov 3'
    ),
    '- #4, Nov 3, for every Odd: Start with the date. ({owner}: "date first")'
  );
});

test('a lesson for one place is listed with only there', () => {
  assert.equal(
    lessonLine(
      {
        id: 5,
        staffId: 'ziva',
        text: 'Start with the date.',
        appliesTo: 'reports',
        quote: 'date first'
      },
      'Nov 3'
    ),
    '- #5, Nov 3, for you: Start with the date. (only in: reports) ({owner}: "date first")'
  );
});

test("a colleague's note or the office's lines never reach a run as the owner's note", () => {
  const kinds = Object.keys(NOTE_IS_OWNERS) as FollowUpKind[];
  const theirs = kinds.filter((kind) => ownerNoteOf({ kind, note: 'a note' }) === 'a note');
  assert.deepEqual(theirs.sort(), [
    'carry_out',
    'denied',
    'first_day',
    'goal',
    'rework',
    'task_done'
  ]);
  for (const kind of ['hand_off', 'handed_back', 'resume', 'answered', 'edited'] as const)
    assert.equal(ownerNoteOf({ kind, note: 'a note' }), undefined, kind);
  assert.equal(ownerNoteOf({ kind: 'denied', note: null }), undefined);
});
