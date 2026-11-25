// Connecting a server added by its address that takes a key, as issue #305
// met it. A stand-in server wants its key in `x-brain-key`: at one address it
// turns a missing key away, at another it lists no tools. Connect's error
// tells the owner how to give a key, Confirm refuses a service that listed no
// tools, and a Confirm that connects says what it connected on the step. Run
// with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { after, test } from 'node:test';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { L, request, secrets } from './office-under-test.ts';

const KEY = 'the-brain-key-for-tests-01';
const keyOf = (req: IncomingMessage) => req.headers['x-brain-key'];

// `/strict` turns a missing key away as the reported server did; `/lenient`
// answers without it, with no tools.
const http = createServer(async (req, res) => {
  const strict = req.url?.startsWith('/strict');
  const keyed = keyOf(req) === KEY;
  if (strict && !keyed) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid or missing access key' }));
    return;
  }
  const server = new Server({ name: 'brain', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: keyed
      ? [
          {
            name: 'search_thoughts',
            description: 'Search.',
            inputSchema: { type: 'object' as const },
            annotations: { readOnlyHint: true }
          },
          {
            name: 'capture_thought',
            description: 'Save.',
            inputSchema: { type: 'object' as const }
          }
        ]
      : []
  }));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => void transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res);
});
await new Promise<void>((done) => http.listen(0, '127.0.0.1', done));
after(() => http.close());
const port = (http.address() as { port: number }).port;

/** A server added by its address, as the owner or an Odd adds one, granted to Lena with its connect task. */
async function added(id: string, path: string, headers?: string[]) {
  await L.addConnector({
    id,
    name: 'Brain',
    description: 'A hosted memory.',
    kind: 'http',
    config: {
      url: `http://127.0.0.1:${port}${path}`,
      ...(headers ? { headers, oauth: false } : { oauth: false })
    }
  });
  await L.grantAccess('lead', { connector: id, level: 'read' });
  const task = (await L.tasksFrom('lead')).find(
    (t) =>
      t.status === 'open' &&
      t.steps.some((s) => s.action && 'connector' in s.action && s.action.connector === id)
  )!;
  const at = (kind: string) => task.steps.findIndex((s) => s.action?.kind === kind);
  return { task, at };
}

/** A step's POST, and what the route said: its JSON, or the message it refused with. */
async function step(taskId: number, body: Record<string, unknown>) {
  try {
    const r = await request('/api/tasks/[id]', 'POST', {
      params: { id: String(taskId) },
      body
    });
    return { ok: true, body: (await r.json()) as Record<string, unknown> };
  } catch (e) {
    return { ok: false, said: (e as { body?: { message?: string } }).body?.message ?? String(e) };
  }
}

test('a server added with no key box that turns the office away tells the owner how to give it a key', async () => {
  const { task, at } = await added('brain-strict', '/strict');
  const r = await step(task.id, { op: 'tools', index: at('tools') });
  assert.equal(r.ok, false);
  assert.match(r.said ?? '', /Invalid or missing access key/);
  assert.match(r.said ?? '', /open the Odd's Settings, then Services, click \+ Add service/);
  assert.match(r.said ?? '', /pick Takes a key/);
});

test('Confirm refuses a service that listed no tools, and a Confirm that connects says what it connected', async () => {
  const empty = await added('brain-empty', '/lenient');
  const listed = await step(empty.task.id, { op: 'tools', index: empty.at('tools') });
  assert.deepEqual(listed.body?.tools, []);
  const refused = await step(empty.task.id, { op: 'confirm-tools', index: empty.at('tools') });
  assert.equal(refused.ok, false);
  assert.match(refused.said ?? '', /listed no tools, so nothing connected/);
  assert.equal((await L.connector('brain-empty'))?.readyAt, null, 'not marked connected');
  assert.equal((await L.task(empty.task.id))?.steps[empty.at('tools')].done, false);

  const keyed = await added('brain-keyed', '/strict', ['x-brain-key']);
  const box = keyed.at('secret');
  assert.ok(box >= 0, 'a key box');
  await step(keyed.task.id, { op: 'secret', index: box, value: KEY });
  assert.equal(secrets.get('brain-keyed:x-brain-key'), KEY);
  const confirmed = await step(keyed.task.id, { op: 'confirm-tools', index: keyed.at('tools') });
  assert.ok(confirmed.ok, confirmed.said);
  const c = await L.connector('brain-keyed');
  assert.deepEqual(c?.tools, ['search_thoughts', 'capture_thought']);
  assert.ok(c?.readyAt);
  const done = (await L.task(keyed.task.id))?.steps[keyed.at('tools')];
  assert.equal(done?.done, true);
  assert.equal(done?.answer, 'Connected: 2 tools, 1 that only reads.');
});
