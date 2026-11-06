// The section of the system prompt every run gets. Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { house } from './house.ts';

const section = house({ has: () => false, now: '9:00', zone: 'London time' });

test('every run is told that only its reply and its tool calls reach the owner', () => {
  assert.match(
    section,
    /- What reaches \{owner\} is only your reply, and what a tool call put on their desk or in their chat\./
  );
});

test('every run is told that the owner reads every reply, so work goes by its title and a file by its name', () => {
  assert.match(
    section,
    /- \{owner\} reads every reply you write, in any run, even one that goes back to a colleague\./
  );
  assert.match(
    section,
    /never by a number, and a file by its name alone \(plan\.md\), never by its folder or path\./
  );
});

test('every run is told never to claim it sent, gave, brought or handed something no tool call did', () => {
  assert.match(
    section,
    /- Never say you sent, gave, brought or handed something unless a tool call in this run did it and succeeded\./
  );
});

test('every run is told never to promise the owner a later step that no tool call in it set up', () => {
  assert.match(
    section,
    /- Never promise \{owner\} a later step, such as "I'll send you" or "when it's ready", unless a tool call in this run set up what brings you back to do it, such as a hand_off, or an ask or task on their desk\./
  );
});

test('every run speaks of the owner by name or as "they" unless the owner said otherwise', () => {
  assert.match(
    section,
    /- Speak of \{owner\} by name or as "they", unless they have told you otherwise\./
  );
});
