import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  endBefore,
  parseRule,
  presetOf,
  presets,
  repeatWords,
  ruleLine,
  ruleWords,
  type Repeat
} from './rrule.ts';
import { instantOf, wallOf, zoneLabel } from './zones.ts';

const LA = 'America/Los_Angeles';
// A Friday, the third of the month.
const FRI = '2026-11-20';

test('every rule the card writes reads back the same, and says itself in words', () => {
  const cases: [string, string][] = [
    ['RRULE:FREQ=DAILY', 'Daily'],
    ['RRULE:FREQ=DAILY;INTERVAL=3;COUNT=10', 'Every 3 days, 10 times'],
    ['RRULE:FREQ=WEEKLY;BYDAY=FR', 'Weekly on Friday'],
    [
      'RRULE:FREQ=WEEKLY;UNTIL=20270401T065959Z;BYDAY=TU,TH',
      'Weekly on Tue and Thu, until Mar 31, 2027'
    ],
    ['RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR', 'Every 2 weeks on Mon, Wed and Fri'],
    ['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'Every weekday (Monday to Friday)'],
    ['RRULE:FREQ=MONTHLY;BYDAY=3FR', 'Monthly on the third Friday'],
    ['RRULE:FREQ=MONTHLY;BYDAY=-1FR', 'Monthly on the last Friday'],
    ['RRULE:FREQ=MONTHLY;BYMONTHDAY=20', 'Monthly on day 20'],
    ['RRULE:FREQ=MONTHLY;INTERVAL=2;COUNT=1;BYMONTHDAY=20', 'Every 2 months on day 20, once'],
    ['RRULE:FREQ=YEARLY', 'Annually on November 20']
  ];
  for (const [line, words] of cases) {
    const r = parseRule([line], FRI, LA);
    assert.ok(r, line);
    assert.equal(ruleLine(r, LA, false), line);
    assert.equal(repeatWords(r, FRI), words);
  }
});

test('a rule Google wrote with parts left to the first day reads as the card would write it', () => {
  const weekly = parseRule(['RRULE:FREQ=WEEKLY;WKST=SU'], FRI, LA)!;
  assert.deepEqual(weekly.days, ['FR']);
  assert.equal(ruleLine(weekly, LA, false), 'RRULE:FREQ=WEEKLY;BYDAY=FR');
  const monthly = parseRule(['RRULE:FREQ=MONTHLY'], FRI, LA)!;
  assert.deepEqual(monthly.monthly, { by: 'day', day: 20 });
});

test('an all-day rule ends on a date, and a timed one at the end of that day in its zone', () => {
  const r: Repeat = {
    freq: 'WEEKLY',
    interval: 1,
    days: ['TU', 'TH'],
    monthly: { by: 'day', day: 1 },
    ends: { by: 'date', date: '2027-03-31' }
  };
  assert.equal(ruleLine(r, LA, true), 'RRULE:FREQ=WEEKLY;UNTIL=20270331;BYDAY=TU,TH');
  assert.equal(ruleLine(r, LA, false), 'RRULE:FREQ=WEEKLY;UNTIL=20270401T065959Z;BYDAY=TU,TH');
  assert.deepEqual(parseRule([ruleLine(r, LA, true)], FRI, LA)?.ends, r.ends);
  assert.deepEqual(parseRule([ruleLine(r, 'Asia/Tokyo', false)], FRI, 'Asia/Tokyo')?.ends, r.ends);
});

test('a rule the card cannot edit is kept and said plainly', () => {
  assert.equal(parseRule(['RRULE:FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1'], FRI, LA), undefined);
  assert.equal(parseRule(['RRULE:FREQ=HOURLY'], FRI, LA), undefined);
  assert.equal(parseRule(['EXDATE:20261127T180000Z'], FRI, LA), undefined);
  assert.equal(ruleWords(undefined, FRI, LA), 'Does not repeat');
  assert.equal(
    ruleWords(
      [
        'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=4TH',
        'EXDATE;TZID=America/Los_Angeles:20271125T100000,20281123T100000'
      ],
      FRI,
      LA
    ),
    'Repeats on a custom rule, except 2 dates'
  );
  assert.equal(
    ruleWords(['RRULE:FREQ=WEEKLY;BYDAY=FR', 'RDATE;VALUE=DATE:20261124'], FRI, LA),
    'Weekly on Friday, plus 1 more date'
  );
});

test("the presets are Google's, from the first day, and a rule finds its preset", () => {
  assert.deepEqual(
    presets(FRI).map((p) => p.label),
    [
      'Does not repeat',
      'Daily',
      'Weekly on Friday',
      'Monthly on the third Friday',
      'Monthly on day 20',
      'Annually on November 20',
      'Every weekday (Monday to Friday)'
    ]
  );
  // The last Friday of the month is offered as both the fourth and the last.
  assert.ok(presets('2026-11-27').some((p) => p.label === 'Monthly on the last Friday'));
  assert.equal(presetOf(parseRule(['RRULE:FREQ=WEEKLY;BYDAY=FR'], FRI, LA), FRI), 'weekly');
  assert.equal(presetOf(parseRule(['RRULE:FREQ=WEEKLY;BYDAY=FR;COUNT=4'], FRI, LA), FRI), 'custom');
  assert.equal(presetOf(undefined, FRI), 'none');
});

test('this and following ends the old series at the end of the day before', () => {
  assert.equal(
    endBefore('RRULE:FREQ=WEEKLY;COUNT=10;BYDAY=FR', '2026-12-04', LA, false),
    'RRULE:FREQ=WEEKLY;BYDAY=FR;UNTIL=20261204T075959Z'
  );
  assert.equal(
    endBefore('RRULE:FREQ=DAILY;UNTIL=20270101', '2026-12-01', LA, true),
    'RRULE:FREQ=DAILY;UNTIL=20261130'
  );
});

test('wall clocks and zones go both ways, across a clock change', () => {
  const at = instantOf('2026-11-01T01:30:00', LA);
  assert.equal(wallOf(at, LA), '2026-11-01T01:30:00');
  assert.equal(instantOf('2026-07-01T09:00:00', LA).toISOString(), '2026-07-01T16:00:00.000Z');
  assert.equal(
    zoneLabel(LA, new Date('2026-12-01T00:00:00Z')),
    '(GMT-08:00) Pacific Time - Los Angeles'
  );
});
