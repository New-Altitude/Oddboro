// The section of the system prompt every run gets. Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OFFICE_SECTION, SETTINGS_TAB } from '@oddboro/ledger/access';
import { house, stillOnDeskSection } from './house.ts';

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

test('every run is told Run commands and Browse the web are its own tools, which my_access says how to get, never outside tools to find', () => {
  assert.ok(
    section.includes(
      '- my_access lists your outside tools and your own. Run commands and Browse the web are your own tools, not outside tools: my_access says whether you have each, and if not, whether {owner} can switch it on in your Settings tab, under Office. When a job needs one they can switch on, call ask_for_switch. When an outside tool stops working'
    ),
    section
  );
  // The tab and its section are named as the card names them.
  assert.ok(section.includes(`in your ${SETTINGS_TAB} tab, under ${OFFICE_SECTION}.`), section);
});

test('a run that can ask for access is told where more outside tools come from', () => {
  const at = (held: string[]) =>
    house({ has: (t) => held.includes(t), now: '9:00', zone: 'London time' });
  assert.match(
    at(['ask_for_access', 'find_connectors']),
    /ask_for_switch\. For more outside tools, call find_connectors, then ask_for_access\. When an outside tool/
  );
  assert.match(
    at(['ask_for_access']),
    /ask_for_switch\. For more outside tools, call ask_for_access\. When an outside tool/
  );
  assert.doesNotMatch(section, /For more outside tools/);
});

test("every run is told to read what it has on the owner's desk before raising anything, and to revise rather than raise again", () => {
  assert.ok(
    section.includes(
      `- Before you put anything on {owner}'s desk, read "Still on {owner}'s desk from you" above, when it is there. To change an item on it, raise it again with revises set to its id. Never put the same thing on their desk twice.`
    ),
    section
  );
});

test('the desk section lists each open item with its id, says how many more, and is absent when the Odd has none', () => {
  assert.equal(stillOnDeskSection({ items: [], more: 0 }), '');
  assert.equal(
    stillOnDeskSection({
      items: [
        { kind: 'task', id: 9, title: 'Sign the form' },
        { kind: 'ask', id: 4, title: 'Reply to Re: Lunch' }
      ],
      more: 3
    }),
    "\n## Still on {owner}'s desk from you\n\n- Task #9: Sign the form\n- Ask #4: Reply to Re: Lunch\n- And 3 more.\n"
  );
});
