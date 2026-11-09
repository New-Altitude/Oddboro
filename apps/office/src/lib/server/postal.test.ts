// A throwaway office, its real grants and gateway, and a simulated LegalZoom
// HTTP service. No account, customer mail or external requests.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { L, secrets, onPlatform, chatOf } from './office-under-test.ts';

const { gateway, openGateway, closeGateway } = await import('./gateway.ts');
const { POST } = await import('../../routes/api/tasks/[id]/+server.ts');
const { GET } = await import('../../routes/api/connectors/+server.ts');
const { POSTAL_ID: id, POSTAL_URL } = L;
const names = ['list_mail_items', 'get_mail_item', 'get_mail_item_text'];
const mail = [
  {
    id: '7',
    sender: 'Garden Club',
    status: 'scanned',
    web_app_link: 'https://example.test/mail/7'
  },
  {
    id: '9',
    sender: 'Paper Supply',
    status: 'unscanned',
    web_app_link: 'https://example.test/mail/9'
  }
];
const seen: { name: string; args: Record<string, unknown> }[] = [];

test('the owner chooses one physical mailbox, and only its reads reach the Odd until revoked', async (t) => {
  const real = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url !== POSTAL_URL) {
      if (/^https:/.test(url)) throw new Error('Unexpected outside request in this test');
      return real(input, init);
    }
    const req = new Request(input, init);
    assert.equal(req.headers.get('Authorization'), 'Bearer test-postal-token');
    if (req.method !== 'POST') return new Response(null, { status: 405 });
    const msg = await req.json();
    if (msg.id === undefined) return new Response(null, { status: 202 });
    let result;
    if (msg.method === 'initialize')
      result = {
        protocolVersion: msg.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'sample-postal', version: '1' }
      };
    else if (msg.method === 'tools/list')
      result = {
        tools: [
          ...names,
          'list_inboxes',
          'get_inbox_overview',
          'request_mail_items_shred',
          'new_tool'
        ].map((name) => ({
          name,
          annotations: { readOnlyHint: true },
          inputSchema: {
            type: 'object',
            properties: {
              ...(name === 'list_inboxes' ? {} : { pmb: { type: 'string' } }),
              user_intent: { type: 'string' },
              ...(name === 'list_mail_items'
                ? { sort_by: { type: 'string' }, sort_desc: { type: 'boolean' } }
                : name === 'get_mail_item_text'
                  ? { mail_item_id: { type: 'string' }, page_count: { type: 'integer' } }
                  : name === 'get_mail_item'
                    ? { mail_item_ids: { type: 'array', items: { type: 'string' } } }
                    : {})
            },
            required:
              name === 'list_inboxes'
                ? []
                : name === 'list_mail_items'
                  ? ['pmb', 'sort_by', 'sort_desc']
                  : name === 'get_mail_item_text'
                    ? ['pmb', 'mail_item_id', 'page_count']
                    : name === 'get_mail_item'
                      ? ['pmb', 'mail_item_ids']
                      : ['pmb'],
            additionalProperties: false
          }
        }))
      };
    else {
      assert.equal(msg.method, 'tools/call');
      const { name, arguments: args } = msg.params;
      seen.push({ name, args });
      let value: unknown;
      if (name === 'list_inboxes')
        value = {
          inboxes: [
            { pmb: '001', account_name: 'Garden Office' },
            { pmb: '002', account_name: 'Other Office' }
          ]
        };
      else if (name === 'get_inbox_overview') value = { pmb: args.pmb };
      else {
        assert.equal(args.pmb, '001');
        if (name === 'list_mail_items') assert.equal(args.sort_by, 'RECEIVED_AT');
        value =
          name === 'list_mail_items'
            ? mail
            : name === 'get_mail_item_text'
              ? { text: 'Return the membership form by April 10.', total_pages: 1 }
              : mail[0];
      }
      result = { content: [{ type: 'text', text: JSON.stringify(value) }] };
    }
    return Response.json({ jsonrpc: '2.0', id: msg.id, result });
  });
  const catalog = await (
    await GET({ url: new URL('http://office/api/connectors') } as never)
  ).json();
  assert.ok(catalog.catalog.some((c: { id: string; ready: boolean }) => c.id === id && !c.ready));
  await L.ensureConnector(id);
  await assert.rejects(L.grantAccess('lead', { connector: id, level: 'act' }), /Read only/);
  await L.grantAccess('lead', { connector: id, level: 'read' });
  await assert.rejects(
    L.grantAccess('cleo', { connector: id, level: 'read' }),
    /Choose the office mailbox/
  );
  const [task] =
    await L.pg`select id,steps from tasks where staff_id='lead' and steps @> ${JSON.stringify([{ action: { kind: 'postal' } }])}::jsonb`;
  const index = task.steps.findIndex(
    (s: { action?: { kind: string } }) => s.action?.kind === 'postal'
  );
  const operate = async (op: string, value?: string) =>
    (
      await POST({
        params: { id: String(task.id) },
        request: new Request('http://office/', {
          method: 'POST',
          body: JSON.stringify({ index, op, value })
        })
      } as never)
    ).json();
  await assert.rejects(operate('postal-inboxes'), /Reconnect LegalZoom/);
  secrets.set(
    id + ':oauth',
    JSON.stringify({
      tokens: { access_token: 'test-postal-token', expires_in: 3600 },
      savedAt: Date.now()
    })
  );
  for (const system of ['darwin', 'linux', 'win32'] as const)
    await onPlatform(system, async () =>
      assert.deepEqual(
        (await operate('postal-inboxes')).inboxes.map((i: { pmb: string }) => i.pmb),
        ['001', '002']
      )
    );
  await assert.rejects(operate('postal-select', '003'), /Choose a mailbox/);
  await operate('postal-select', '001');
  const c = (await L.connector(id))!;
  assert.equal(c.config.pmb, '001');
  assert.deepEqual(c.readTools.sort(), [...names].sort());
  assert.ok(c.readyAt);
  assert.equal((await L.task(task.id))!.steps[index].answer, 'PMB 001');
  await assert.rejects(L.setGrantLevel('lead', id, 'act'), /Read only/);
  const chat = await chatOf('lead', 'Which physical letters need attention?');
  assert.ok(chat.args.includes('mcp__' + id + '__get_mail_item_text'));
  assert.ok(!JSON.stringify(chat).includes('test-postal-token'));
  assert.ok(!(await chatOf('cleo')).args.some((a) => a.includes(id)));

  const run = openGateway([{ connector: c, level: 'read' }], 60000, undefined, 'lead');
  const client = new Client({ name: 'odd', version: '1' });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(run.servers[id].url), {
        requestInit: { headers: run.servers[id].headers },
        fetch: (url, init) => gateway(new Request(url, init), id)
      })
    );
    const listed = (await client.listTools()).tools;
    assert.deepEqual(listed.map((t) => t.name).sort(), [...names].sort());
    assert.ok(listed.every((t) => !Object.hasOwn(t.inputSchema.properties ?? {}, 'pmb')));
    const call = async (name: string, args = {}) =>
      (await client.callTool({ name, arguments: args })) as CallToolResult;
    const list = await call('list_mail_items', { sort_by: 'RECEIVED_AT', sort_desc: true });
    assert.deepEqual(JSON.parse((list.content[0] as { text: string }).text), mail);
    const letter = await call('get_mail_item_text', { mail_item_id: '7', page_count: 5 });
    assert.match((letter.content[0] as { text: string }).text, /April 10/);
    assert.equal(seen.at(-1)!.args.pmb, '001');
    const before = seen.length;
    assert.ok((await call('request_mail_items_shred')).isError);
    assert.ok((await call('list_inboxes')).isError);
    await assert.rejects(call('list_mail_items', { pmb: '002' }), /supplies the mailbox/);
    assert.equal(seen.length, before);
    await L.grantAccess('paige', { connector: id, level: 'read' });
    await L.revoke('lead', id);
    await assert.rejects(call('list_mail_items'), /403|no longer/);
    assert.equal(seen.length, before);
    assert.equal((await L.connector(id))?.config.pmb, '001');
    await L.revoke('paige', id);
    assert.equal((await L.connector(id))?.config.pmb, undefined);
  } finally {
    await client.close();
    await closeGateway(run.token);
  }
});
