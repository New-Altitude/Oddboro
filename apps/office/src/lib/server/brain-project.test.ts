import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync as real, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { home, STAFF_SERVER } from '@oddboro/ledger';
import { pendingDecisions, unpairBrain } from './brain-project.ts';

for (const host of ['codex', 'claude'])
  test(host + ' shares only a selected verbatim project quote', (t) => {
    const workspace = mkdtempSync(join(tmpdir(), 'brain-hook-'));
    const pairs = home('dreaming', 'pairs');
    mkdirSync(pairs, { recursive: true });
    const id =
      host === 'claude'
        ? 'e735cfd0-4997-4912-aede-56ec77f67077'
        : '3fefa69b-347c-430e-a3cd-53661e83f34d';
    const path = join(pairs, id + '.json');
    writeFileSync(
      path,
      JSON.stringify({
        id,
        host,
        workspace: real(workspace),
        command: 'unused',
        key: 'only-in-this-test'
      })
    );
    t.after(() => {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(path, { force: true });
    });
    const prompt = 'The rehearsal is on Wednesday. Shall we invite another team?';
    const event = {
      hook_event_name: 'UserPromptSubmit',
      cwd: workspace,
      prompt,
      session_id: 'test',
      turn_id: 'turn'
    };
    const run = (data: unknown) =>
      execFileSync(
        process.execPath,
        [join(dirname(STAFF_SERVER), 'brain-capture.mjs'), path, host],
        { input: JSON.stringify(data), encoding: 'utf8' }
      );
    assert.equal(run({ ...event, cwd: tmpdir() }), '');
    const hints = JSON.parse(run(event)).hookSpecificOutput.additionalContext;
    const choices = JSON.parse(hints.split('\n').at(-1));
    assert.equal(choices.length, 2);
    const turn = createHash('sha256')
      .update(JSON.stringify(['test', 'turn', prompt]))
      .digest('hex');
    const dir = join(workspace, '.oddboro-decisions');
    mkdirSync(dir);
    const file = join(dir, turn + '.json');
    writeFileSync(file, JSON.stringify([{ ...choices[0], quote: 'The rehearsal was cancelled.' }]));
    assert.deepEqual(pendingDecisions(), []);
    writeFileSync(file, JSON.stringify([choices[0]]));
    const got = pendingDecisions();
    assert.equal(got.length, 1);
    assert.match(got[0].content, /Wednesday/);
    assert.doesNotMatch(got[0].content, /invite another team/);
    const nextEvent = { ...event, turn_id: 'another-turn' };
    const nextHints = JSON.parse(run(nextEvent)).hookSpecificOutput.additionalContext;
    const nextQuote = JSON.parse(nextHints.split('\n').at(-1))[0];
    const nextTurn = createHash('sha256')
      .update(JSON.stringify(['test', 'another-turn', prompt]))
      .digest('hex');
    writeFileSync(join(dir, nextTurn + '.json'), JSON.stringify([nextQuote]));
    assert.equal(
      new Set(pendingDecisions().map((d) => d.content)).size,
      2,
      'reaffirming an old decision is a new source turn'
    );
    unpairBrain(id);
    assert.deepEqual(pendingDecisions(), []);
    assert.equal(run(event), '');
  });
