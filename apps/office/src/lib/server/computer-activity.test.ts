import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { groupProcesses, computerActivity } from './computer-activity.ts';
import { identify, type ProcessRow } from './activity-processes.ts';
import { activityTitles } from './activity-titles.ts';

test('a native child of a launcher counts once, and a separate nested run keeps its resources', () => {
  const rows: ProcessRow[] = [
    { pid: 1, parent: 0, start: '1', ms: 50, bytes: 100, agent: 'codex', launcher: true },
    { pid: 2, parent: 1, start: '2', ms: 300, bytes: 200, agent: 'codex', shared: true },
    { pid: 3, parent: 2, start: '3', ms: 100, bytes: 300 },
    { pid: 4, parent: 3, start: '4', ms: 100, bytes: 400, agent: 'claude' },
    { pid: 5, parent: 4, start: '5', ms: 200, bytes: 500 },
    { pid: 6, parent: 0, start: '6', ms: 100, bytes: 6400 }
  ];
  const { groups } = groupProcesses(
    rows.map((p) => ({ ...p, ms: 0 })),
    rows,
    1000,
    new Map([[1, { agent: 'codex', staffId: 'lead', task: 'Draft brief' }]])
  );
  assert.deepEqual([...groups.keys()], [1, 4]);
  assert.deepEqual(
    [groups.get(1)?.bytes, groups.get(1)?.cpu, groups.get(1)?.staffId, groups.get(1)?.shared],
    [600, 45, 'lead', true]
  );
  assert.deepEqual([groups.get(4)?.bytes, groups.get(4)?.cpu], [900, 30]);
});

test('a replaced process has memory but no CPU measurement from the previous occupant', () => {
  const row: ProcessRow = { pid: 7, parent: 0, start: 'new', agent: 'grok', ms: 500, bytes: 120 };
  const { groups } = groupProcesses([{ ...row, start: 'old', ms: 100 }], [row], 500, new Map());
  assert.equal(groups.get(7)?.cpu, null);
  assert.equal(groups.get(7)?.bytes, 120);
});

test('only the tool or its Node entry point identifies the process', () => {
  assert.equal(identify('/Applications/Codex.app/Contents/MacOS/Codex').agent, undefined);
  assert.equal(identify('/some/codex-helper').agent, undefined);
  assert.equal(identify('/bin/sh', 'codex').agent, undefined);
  assert.equal(identify('node', '-e').agent, undefined);
  assert.equal(
    identify('node.exe', 'C:/tools/node_modules/@google/gemini-cli/dist/index.js').agent,
    'gemini'
  );
  assert.equal(identify('/tools/claude/versions/2.1.0').agent, 'claude');
});

test('the latest title is returned only for a detected conversation', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ob-titles-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(
    join(dir, 'session_index.jsonl'),
    [
      'cut line',
      JSON.stringify({ id: 'open', thread_name: 'First' }),
      JSON.stringify({ id: 'closed', thread_name: 'Private' }),
      JSON.stringify({ id: 'open', thread_name: 'Renamed' })
    ].join('\n')
  );
  assert.deepEqual(await activityTitles(new Set(['open']), dir), { open: 'Renamed' });
});

test('a tool launched outside the office appears with its own CPU and memory', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ob-activity-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bin = join(dir, 'node_modules', '@openai', 'codex', 'bin');
  await mkdir(bin, { recursive: true });
  const entry = join(bin, 'codex.js');
  const id = '12345678-1234-4111-9222-123456789abc';
  await writeFile(
    entry,
    `const fs=require('node:fs'); fs.openSync(process.argv[2],'w'); console.log('ready'); setInterval(()=>{const end=Date.now()+10; while(Date.now()<end){}},30);`
  );
  const child = spawn(
    process.execPath,
    [entry, join(dir, 'rollout-sample-' + id + '.jsonl'), 'private-fixture-argument'],
    { stdio: ['ignore', 'pipe', 'ignore'] }
  );
  const exited = once(child, 'exit');
  t.after(async () => {
    child.kill();
    await exited;
  });
  await once(child.stdout, 'data');
  const sample = await computerActivity(() => new Map());
  const r = sample.runs.find((r) => r.pid === child.pid);
  assert.ok(r);
  assert.equal(r.agent, 'codex');
  assert.ok(r.bytes > 0);
  assert.ok(r.cpu !== null && r.cpu > 0);
  assert.ok(sample.used >= 0 && sample.used <= sample.total);
  assert.ok(sample.cpu !== null && sample.cpu >= 0 && sample.cpu <= 100);
  if (process.platform !== 'win32') assert.ok(r.sessions.includes(id));
  assert.ok(!JSON.stringify(sample).includes('private-fixture-argument'));
});
