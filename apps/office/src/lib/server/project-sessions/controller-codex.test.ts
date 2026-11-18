// Connect and Stop of a Codex conversation, through the controller the project
// route drives. Codex's app server is a stand-in that answers each request from a
// table, so no Codex runs. In a file of its own, so the stand-in reaches no
// other test.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { app } from './controller-under-test.ts';

/** What the stand-in Codex answers for a thread's folder. */
let threadFolder = '/elsewhere';
const rpc = {
  request: async (method: string, params?: { threadId?: string }) => {
    if (method === 'thread/read' || method === 'thread/resume')
      return { thread: { id: params?.threadId, cwd: threadFolder, updatedAt: 0 } };
    if (method === 'thread/loaded/list') return { data: [] };
    throw new Error(`The stand-in Codex has no answer for ${method}.`);
  }
};
mock.module('./codex-rpc.ts', {
  namedExports: { startCodex: async () => rpc, joinCodex: async () => rpc }
});
const { L } = await import('../office-under-test.ts');
const { projectController } = await import('./controller.ts');
const { projectFolder } = await import('./native.ts');

test('a Codex conversation whose folder is another project is refused in the one different-project line', async () => {
  threadFolder = '/elsewhere';
  await assert.rejects(projectController().connect('codex', app, { nativeId: randomUUID() }), {
    message: L.OTHER_PROJECT
  });
});

test('Stop on a connected Codex session is refused, since only a Claude Code session has it', async () => {
  threadFolder = await projectFolder(app);
  const controller = projectController();
  const s = await controller.connect('codex', app, { nativeId: randomUUID(), handedOver: true });
  await assert.rejects(controller.end(s.id), {
    message: 'Only a Claude Code session has Stop.'
  });
  await controller.disconnect(s.id);
});
