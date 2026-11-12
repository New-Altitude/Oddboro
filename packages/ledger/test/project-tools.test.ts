// Native assignments use the same run ceiling and tool declaration as the rest of the office.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { db, toolServer } from './tool-server.ts';

const { staff } = await import('../src/schema.ts');
const { connectProject, shareProject, projectWork } = await import('../src/project-sessions.ts');
await db.insert(staff).values({
  id: 'editor',
  name: 'Editor',
  role: 'Editor',
  remit: 'Review projects.',
  variant: 'a',
  portrait: 'a',
  permission: 'act',
  desk: 'Review the project.'
});

test('only a shared project offers its tools, and a Draft run keeps one proposal', async () => {
  const before = await toolServer('editor', {});
  assert.ok(!(await before.listTools()).tools.some((t) => t.name === 'send_project_work'));
  const s = await connectProject('codex', randomUUID(), '/fixture/project', 'A project');
  await shareProject(s.id, 'editor');
  const client = await toolServer('editor', { CEILING: 'draft' });
  const call = (key: string) =>
    client.callTool({
      name: 'send_project_work',
      arguments: { session: s.id, key, prompt: 'Review the draft.' }
    });
  const key = randomUUID();
  assert.ok(!(await call(key)).isError);
  assert.ok(!(await call(key)).isError);
  const work = await projectWork(s.id);
  assert.equal(work.length, 1);
  assert.equal(work[0].state, 'proposed');
  const read = await toolServer('editor', { CEILING: 'read' });
  assert.equal(
    (
      await read.callTool({
        name: 'send_project_work',
        arguments: { session: s.id, key: randomUUID(), prompt: 'Review.' }
      })
    ).isError,
    true
  );
  const lesson = await toolServer('editor', { LESSON_RUN: '1' });
  assert.ok(!(await lesson.listTools()).tools.some((t) => t.name === 'send_project_work'));
  await shareProject(s.id, null);
  assert.equal((await call(randomUUID())).isError, true);
  assert.equal((await projectWork(s.id)).length, 1);
});
