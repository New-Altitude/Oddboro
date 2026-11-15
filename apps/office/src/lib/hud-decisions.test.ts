import assert from 'node:assert/strict';
import test from 'node:test';
import { hudDecisions, isWaitingChat } from './hud-decisions.ts';
import type { AgentNotice } from './server/agent-attention.ts';

test('two questions in one thread stay distinct; its native waiting flag adds no decision', () => {
  const session = {
    id: 'project',
    nativeId: 'thread',
    terminalPid: 45,
    agent: 'codex' as const,
    title: 'Imports',
    questions: [
      { key: 'one', label: 'Pick a column' },
      { key: 'two', label: 'Allow the export?' }
    ]
  };
  const ask = {
    id: 17,
    staffId: 'pip',
    title: 'Send the report?',
    why: 'It is ready',
    ifApproved: 'It goes to the editor'
  };
  const first = {
    id: 'a',
    sessionId: session.id,
    title: session.title,
    prompt: 'Review export',
    staffId: 'pip'
  };
  const office = {
    staff: [{ id: 'pip', name: 'Pip' }],
    sessions: [session],
    desk: { asks: [ask], projectWork: [first, { ...first, id: 'b' }] },
    uncertain: [{ ...first, id: 'c' }]
  };
  const native: AgentNotice = {
    agent: 'codex',
    id: 'thread',
    title: session.title,
    reason: 'Waiting',
    state: 'waiting'
  };
  const other = { ...native, id: 'unrelated' };
  const decisions = hudDecisions(office, [
    native,
    { ...native, id: 'alias', pid: 45 },
    other,
    other,
    { ...other, id: 'finished', state: 'review' }
  ]);
  assert.deepEqual(
    decisions.map((d) => d.id),
    [
      'ask-17',
      'proposal-a',
      'proposal-b',
      'uncertain-c',
      'question-one',
      'question-two',
      'codex-unrelated'
    ]
  );
  assert.deepEqual(
    decisions.filter(isWaitingChat).map((d) => d.id),
    ['codex-unrelated']
  );
  assert.deepEqual(decisions[2].target, { project: 'project', item: 'proposal-b' });
  assert.deepEqual(decisions[5].target, { project: 'project', item: 'question-two' });
});
