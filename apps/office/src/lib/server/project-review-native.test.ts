// Exercise the real session controller and Claude inbox with controlled clients.
// The provider substitutes own two existing conversations; no model is called.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, mock, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { L, bin, folder } from './office-under-test.ts';
import type { RpcMessage } from './project-sessions/codex-rpc.ts';

const project = join(realpathSync(folder), 'native-review');
mkdirSync(project);
writeFileSync(
  join(project, 'project-skill.md'),
  'Put the project fact at the start of the edited note.'
);
const fact = 'The launch color is saffron.';
const sessions = new Map<
  string,
  {
    id: string;
    cwd: string;
    updatedAt: number;
    turns: { id: string; status: string; items?: { type: string; text: string }[] }[];
  }
>();
let receive: (message: RpcMessage) => void;
let sent: { threadId: string; input: { text: string }[] }[] = [];
let loseReply = false;
let decision: unknown;
const rpc = {
  request: async (method: string, params: Record<string, unknown> = {}) => {
    const id = params.threadId as string;
    if (method === 'thread/loaded/list') return { data: [...sessions.keys()] };
    if (method === 'thread/read' || method === 'thread/resume') return { thread: sessions.get(id) };
    if (method === 'account/read') return { account: null };
    if (method === 'turn/start') {
      sent.push(params as (typeof sent)[number]);
      const turn = { id: randomUUID(), status: 'inProgress' };
      sessions.get(id)!.turns.push(turn);
      if (loseReply) throw new Error('Reply lost after acceptance');
      return { turn };
    }
    throw new Error('Unexpected native request ' + method);
  },
  send: (answer: unknown) => {
    decision = answer;
  },
  terminal: () => ({ args: [], env: {} })
};
const connect = async (callback: typeof receive) => {
  receive = callback;
  return rpc;
};
mock.module(new URL('./project-sessions/codex-rpc.ts', import.meta.url).href, {
  exports: {
    startCodex: connect,
    joinCodex: async (_socket: string, callback: typeof receive) => connect(callback)
  }
});
mock.module('@anthropic-ai/claude-agent-sdk', { exports: { listSessions: async () => [] } });
mock.module(new URL('./project-sessions/terminal.ts', import.meta.url).href, {
  exports: {
    ProjectTerminal: class {
      events = new EventEmitter();
      running = true;
      async releaseProcess() {
        this.running = false;
      }
    }
  }
});
writeFileSync(join(bin, 'claude'), '#!/usr/bin/env node\nconsole.log("[]");\n', { mode: 0o755 });
const { ProjectController } = await import('./project-sessions/controller.ts');
const clients: Client[] = [];
after(async () => {
  for (const c of clients) await c.close();
});
async function settled(fn: () => Promise<boolean>) {
  const until = Date.now() + 5000;
  while (!(await fn())) {
    if (Date.now() > until) throw new Error('Native result did not arrive');
    await delay(20);
  }
}
async function answered(agent: 'codex' | 'claude') {
  const s = await L.connectProject(agent, randomUUID(), project, 'Original');
  const other = await L.connectProject(agent, randomUUID(), project, 'Second conversation');
  await L.shareProject(s.id, 'sam');
  const r = await L.saveProjectReview({
    id: randomUUID(),
    sessionId: s.id,
    staffId: 'sam',
    personaId: 'sam',
    slug: 'pat',
    question: 'Review the note.',
    message: 'Approved source',
    source: {
      file: 'note.md',
      sha256: 'source-revision',
      start: 1,
      end: 1,
      omitted: 0,
      excerpt: fact
    }
  });
  await L.claimProjectReview(r.id);
  await L.finishProjectReview(
    r.id,
    'Use the original project fact. [Source](https://example.test/one)',
    'answered'
  );
  await L.returnProjectReview(r.id, 'Keep the existing project skill.');
  // Sam is Draft in some fixtures. This owner approval is the same request action as the UI.
  await L.changeProjectRequest(r.id, s.id, ['proposed'], 'authorized');
  return { s, other, r };
}

test('Codex resumes the same ID, sends the full answer once, and holds an uncertain accepted turn', async () => {
  const { s, other, r } = await answered('codex');
  for (const x of [s, other])
    sessions.set(x.nativeId, { id: x.nativeId, cwd: project, updatedAt: 1, turns: [] });
  const controller = new ProjectController();
  await controller.connect('codex', project, s.nativeId);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].threadId, s.nativeId);
  assert.match(sent[0].input[0].text, /https:\/\/example.test\/one/);
  const turn = sessions.get(s.nativeId)!.turns.at(-1)!;
  const answer = fact + '\n' + readFileSync(join(project, 'project-skill.md'), 'utf8');
  writeFileSync(join(project, 'codex-edited.md'), answer);
  receive({
    method: 'item/completed',
    params: { threadId: s.nativeId, item: { type: 'agentMessage', text: answer } }
  });
  turn.status = 'completed';
  turn.items = [{ type: 'agentMessage', text: answer }];
  receive({ method: 'turn/completed', params: { threadId: s.nativeId, turn } });
  await settled(async () => (await L.projectWork(s.id))[0].state === 'done');
  await controller.disconnect(s.id);
  const restarted = new ProjectController();
  await restarted.connect('codex', project, s.nativeId);
  assert.equal(sent.length, 1);
  assert.equal((await L.projectWork(other.id)).length, 0);
  assert.equal(sessions.get(other.nativeId)!.turns.length, 0);
  assert.equal((await L.projectWork(s.id))[0].id, r.id);
  loseReply = true;
  const next = await L.requestProject({
    id: randomUUID(),
    sessionId: s.id,
    prompt: 'Continue the same work.'
  });
  await restarted.work(s.id);
  assert.equal((await L.projectWork(s.id)).find((v) => v.id === next.id)?.state, 'uncertain');
  await restarted.work(s.id);
  assert.equal(sent.length, 2, 'uncertain send cannot be repeated');
});

test('Claude’s paired MCP reads one full review and returns the original project result', async () => {
  const { s, other } = await answered('claude');
  const controller = new ProjectController();
  await controller.connect('claude', project, s.nativeId);
  const box = L.home('project-sessions', s.id, 'inbox');
  const client = new Client({ name: 'native-review-fixture', version: '1' });
  clients.push(client);
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [
        fileURLToPath(
          new URL('../../../../../packages/ledger/src/project-session-tools.ts', import.meta.url)
        ),
        box,
        s.nativeId,
        project
      ],
      cwd: project,
      env: { PATH: process.env.PATH ?? '', CLAUDE_CODE_SESSION_ID: s.nativeId },
      stderr: 'ignore'
    })
  );
  const offer = await client.callTool({ name: 'take_work', arguments: {} });
  const content = offer.content as { text: string }[];
  const assignment = JSON.parse(content[0].text);
  assert.match(assignment.prompt, /https:\/\/example.test\/one/);
  assert.match(assignment.prompt, /Separate office recommendation/);
  const answer = fact + '\n' + readFileSync(join(project, 'project-skill.md'), 'utf8');
  writeFileSync(join(project, 'claude-edited.md'), answer);
  const result = await client.callTool({
    name: 'finish_work',
    arguments: { id: assignment.id, answer }
  });
  assert.ok(!result.isError, JSON.stringify(result));
  await settled(async () => (await L.projectWork(s.id))[0].state === 'done');
  assert.equal((await L.projectWork(other.id)).length, 0);
  assert.equal((await L.connection(s.id))?.nativeId, s.nativeId);
  await controller.disconnect(s.id);
  const restarted = new ProjectController();
  await restarted.connect('claude', project, s.nativeId);
  assert.equal((await L.projectWork(s.id)).length, 1);
  await restarted.disconnect(s.id);
});

test('the native permission decision reaches Codex and a denied edit stays stopped', async () => {
  loseReply = false;
  const { s } = await answered('codex');
  sessions.set(s.nativeId, { id: s.nativeId, cwd: project, updatedAt: 1, turns: [] });
  const controller = new ProjectController();
  await controller.connect('codex', project, s.nativeId);
  receive({
    id: 9,
    method: 'item/fileChange/requestApproval',
    params: { threadId: s.nativeId, path: 'restricted.md' }
  });
  await settled(async () => !!controller.view(s.id).question);
  const question = controller.view(s.id).question!;
  await controller.answer(s.id, question.id, question.key, 'decline');
  assert.deepEqual(decision, { id: 9, result: { decision: 'decline' } });
  const turn = sessions.get(s.nativeId)!.turns.at(-1)!;
  receive({
    method: 'turn/completed',
    params: {
      threadId: s.nativeId,
      turn: { ...turn, status: 'failed', error: { message: 'Owner denied the write.' } }
    }
  });
  await settled(async () => (await L.projectWork(s.id))[0].state === 'stopped');
  assert.equal((await L.projectWork(s.id))[0].answer, 'Owner denied the write.');
  await controller.disconnect(s.id);
});
