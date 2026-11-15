import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { textHash } from './brain-recent.ts';

test('the office retries unseen records after a restart and only shares verified, eligible records', async (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'brain-watch-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const home = (...parts: string[]) => join(folder, ...parts);
  const job = {
    id: 1,
    name: 'Member email',
    instructions: 'Write the pickup notice.',
    staffId: 'writer'
  };
  const url = 'https://brain.example/open-brain-mcp';
  const ledger = await import('@oddboro/ledger');
  t.mock.module('@oddboro/ledger', {
    namedExports: {
      ...ledger,
      home,
      enabledJobs: async () => [job],
      job: async () => job,
      connector: async () => ({ id: 'brain', config: { url } })
    }
  });
  const rows = [
    { id: 'new', text: 'Use the Copper Room on Saturday.', metadata: {} },
    { id: 'hidden', text: 'Private note.', metadata: { sensitivity_tier: 'restricted' } },
    { id: 'memory', text: 'Agent memory.', metadata: { source: 'agent_memory' } },
    { id: 'old', text: 'The old plan.', metadata: {} }
  ];
  let listed = rows.slice(-1);
  let missing = true;
  let modelOffline = true;
  const queries: string[] = [];
  const client = {
    listTools: async () => ({
      tools: ['search', 'fetch', 'list_thoughts'].map((name) => ({
        name,
        annotations: { readOnlyHint: true }
      }))
    }),
    callTool: async (call: { name: string; arguments: { query: string; id: string } }) => {
      let text;
      if (call.name === 'list_thoughts') {
        text =
          listed.length +
          ' recent thought(s):\n\n' +
          listed.map((r, i) => i + 1 + '. [11/14/2026] (test)\n   ' + r.text).join('\n\n');
      } else if (call.name === 'search') {
        queries.push(call.arguments.query);
        const row = rows.find((r) => r.text === call.arguments.query);
        text = JSON.stringify({
          results: row ? [{ id: missing && row.id === 'new' ? 'old' : row.id }] : []
        });
      } else {
        assert.equal(call.name, 'fetch');
        text = JSON.stringify(rows.find((r) => r.id === call.arguments.id));
      }
      return { content: [{ type: 'text', text }] };
    },
    close: async () => {}
  };
  t.mock.module('./access.ts', { namedExports: { upstream: async () => client } });
  t.mock.module('./office-run.ts', {
    namedExports: {
      runAsOffice: async (data: string) => {
        assert.deepEqual(
          JSON.parse(data).evidence.map((r: { id: string }) => r.id),
          ['new']
        );
        return { ok: !modelOffline, text: '[{"job":1,"sources":["new"]}]' };
      }
    }
  });
  mkdirSync(home('dreaming'));
  writeFileSync(
    home('dreaming', 'connection.json'),
    JSON.stringify({ id: 'brain', url, recentStart: [textHash('The old plan.')] })
  );
  const state = () => readFileSync(home('dreaming', 'review.json'), 'utf8');
  const first = await import('./open-brain.ts');
  await first.reviewBrain(job, true);
  const before = state();
  listed = rows;
  await assert.rejects(first.reviewBrain(job, true), /verify its exact record/);
  assert.equal(state(), before);
  missing = false;
  await assert.rejects(first.reviewBrain(job, true), /could not review the Brain/);
  assert.equal(state(), before);
  modelOffline = false;
  const restarted: typeof first = await import(
    new URL('./open-brain.ts?restart', import.meta.url).href
  );
  assert.match(await restarted.reviewBrain(job, true), /Copper Room/);
  const saved = JSON.parse(state());
  assert.deepEqual(
    saved.recent,
    rows.map((r) => textHash(r.text))
  );
  assert.deepEqual(
    saved.review.byJob[1].map((r: { id: string }) => r.id),
    ['new']
  );
  queries.length = 0;
  assert.match(await restarted.reviewBrain(job, true), /Copper Room/);
  assert.deepEqual(queries, [job.name]);
});
