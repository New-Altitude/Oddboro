// The manager's chat as the office launches it, in a throwaway office.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { L, chat, chatOf } from './office-under-test.ts';
import { saveSession, sectionsOf } from './resume.ts';

const { sayInChat } = await import('./staff.ts');

test('the manager takes a first brief and picks up an older chat with current tools and the goal still to meet', async () => {
  const preset = L.MANAGERS.find((m) => m.id === 'ziva')!;
  const manager = await L.hireManager({ preset: preset.id });
  sayInChat(manager.id, preset.hello('Ada'));
  const brief = 'Bring the dispatch schedule here. The editor wants only late trains flagged.';
  const run = await chatOf(manager.id, brief);
  assert.ok(run.message.endsWith(brief));
  assert.match(run.system, /acknowledge one specific answer/);
  assert.ok(run.system.startsWith(manager.desk));
  assert.doesNotMatch((await chatOf('sam')).system, /## Moving work into the office/);

  // Resume the same chat with an older, customized job and the sections it already saw.
  const desk = 'You run this office. Show costs in whole dollars. Put intake questions in a file.';
  const { id } = manager;
  await L.pg`update staff set desk = ${desk} where id = ${id}`;
  await L.addConnector({
    id: 'editor',
    name: 'Dispatch editor',
    description: 'Judgment on the dispatch rules.',
    kind: 'stdio',
    config: { command: process.execPath }
  });
  await L.pg`insert into grants (staff_id, connector_id, level) values (${id}, 'editor', 'read')`;
  const earlier = await chatOf(id);
  assert.match(earlier.system, /Dispatch editor .*held back until/);
  assert.ok(earlier.claudeSettings);
  assert.ok(!earlier.claudeSettings.permissions.allow.includes('mcp__editor__consult'));
  const seen = sectionsOf(earlier.system, desk);
  delete seen['## Moving work into the office'];
  const session = L.chatSession(id);
  saveSession(session, { sessionId: 'old-chat', seen, home: earlier.configDir ?? '' });

  const [goal] = await L.pg<{ id: number }[]>`insert into goals (title, done_when)
    values ('Repair the presses', 'Each press passes a print test') returning id`;
  const hand = await L.handOff({
    from: id,
    to: 'paige',
    work: { title: 'Inventory the presses', brief: 'List each press.' },
    thread: { title: 'Press repairs', goalId: goal.id }
  });
  assert.ok('id' in hand);
  const job = await L.startFollowUp(hand.id);
  assert.ok(job);
  await L.finishFollowUp(job, 'Inventory the presses', 'done', 'Both cataloged. One needs a belt.');
  writeFileSync(
    join(dirname(session), 'notes', 'pending-judgments.md'),
    'Which route changes should the dispatch flag?'
  );
  await L.connectorReady('editor', ['consult'], ['consult']);
  const now = await chatOf(id, 'Where are we on the presses?');
  assert.equal(now.args[now.args.indexOf('--resume') + 1], 'old-chat');
  assert.match(now.message, /Read notes\/pending-judgments.md/);
  assert.match(now.message, /Done when: Each press passes a print test/);
  assert.match(now.message, /Inventory the presses \(Paige\): finished/);
  assert.match(now.message, /One needs a belt/);
  assert.match(now.message, /If work remains, keep the goal open/);
  assert.match(now.message, /Dispatch editor .*1 tool/);
  assert.ok(now.claudeSettings);
  assert.ok(now.claudeSettings.permissions.allow.includes('mcp__editor__consult'));
  assert.ok(now.system.startsWith(desk));
  assert.equal((await L.staffer(id))?.desk, desk);
});

test('a custom answer to the second question goes straight to the manager with the first choice', async () => {
  const manager = await L.hireManager({ preset: 'jamal' });
  sayInChat(manager.id, L.customHello(manager.name, 'Ada'));
  const first = L.FIRST_QUESTIONS[0].answers[2];
  await chat(manager.id, first, () => {});
  const brief = 'Draft the rota in the morning and ask me only if two shifts overlap.';
  const run = await chatOf(manager.id, brief);
  assert.ok(run.message.includes(first));
  assert.ok(run.message.endsWith(brief));
  assert.doesNotMatch(run.message, /My report lands at 7/);
});
