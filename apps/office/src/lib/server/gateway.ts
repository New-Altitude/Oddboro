// The gateway between an Odd's run and the outside tools it holds. A run
// never gets an outside server's address, key or sign-in: it gets one address
// per tool on the office itself (`/api/gateway/<connector>`) and a token that
// lives only as long as the run. The office holds the keys, connects to the
// real server (`upstream` in access.ts), lists only the tools the grant
// reaches, and refuses a call to any other. Read only reaches the tools that
// pass `readsOnly` now, as the server marks them on this run, and that the
// connector's stored list still names; Read and write reaches every tool. At
// Draft, Read and write still lists every tool, but a call to one that changes
// something goes on the owner's desk instead (`raiseCall`): the office makes
// that exact call on their yes (`makeCall`), and the Odd hears the result in a
// new run. The tool a run goes through (Claude Code, Codex, Grok) still gets
// its own per-tool allow list too, so either one alone holds.
import { randomBytes } from 'node:crypto';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool
} from '@modelcontextprotocol/sdk/types.js';
import {
  POSTAL_ID,
  grantsFor,
  connector,
  narrowReadTools,
  OFFICE_URL,
  ownerName,
  raiseCall,
  readsOnly,
  type CallPlace,
  type ConnectorRow,
  type HeldCall,
  type Level
} from '@oddboro/ledger';
import { postalTools, postalArguments } from './postal.ts';
import { upstream } from './access.ts';

export const GATEWAY_PATH = '/api/gateway';

/**
 * One outside tool a run holds, its connection made on first use and kept for
 * the run. `waits`: a write grant at Draft, whose changes wait for the owner.
 */
type Held = {
  pmb?: string;
  level: Level;
  waits: boolean;
  client?: Promise<Client>;
  tools?: Promise<Tool[]>;
};
/** `place` is where a held call lands; a run with none (a lesson run) changes nothing. */
type GatewayRun = { staffId?: string; held: Map<string, Held>; until: number; place?: CallPlace };

/**
 * Runs going, by token. Each goes when its run ends, or at the latest when its
 * time is up. Kept on the process, not the module: in development Vite reloads
 * the server's code under a running office, and a run the old code opened was
 * refused by the new code's guard (403) until the office restarted.
 */
const runs: Map<string, GatewayRun> = ((
  globalThis as { oddboroGatewayRuns?: Map<string, GatewayRun> }
).oddboroGatewayRuns ??= new Map());

/** A server entry as a run's tool takes it: Claude Code's --mcp-config, Codex's and Grok's alike. */
export type GatewayServer = { type: 'http'; url: string; headers: Record<string, string> };

/**
 * Open the gateway for one run: a token, and one server entry per outside
 * tool, each pointing at the office. `ms` is the run's own time limit, after
 * which the token stops working even if the run never said it ended.
 */
export function openGateway(
  grants: { connector: ConnectorRow; level: Level; waits?: boolean }[],
  ms: number,
  place?: CallPlace,
  staffId = place?.staffId
): { token: string; servers: Record<string, GatewayServer> } {
  const now = Date.now();
  for (const [t, r] of runs) if (r.until < now) void closeGateway(t);
  const token = randomBytes(32).toString('base64url');
  runs.set(token, {
    held: new Map(
      grants.map((g) => [
        g.connector.id,
        { pmb: g.connector.config.pmb, level: g.level, waits: !!g.waits }
      ])
    ),
    until: now + ms + 60_000,
    place,
    staffId
  });
  const servers = Object.fromEntries(
    grants.map((g) => [
      g.connector.id,
      {
        type: 'http' as const,
        url: `${OFFICE_URL}${GATEWAY_PATH}/${encodeURIComponent(g.connector.id)}`,
        headers: { Authorization: `Bearer ${token}` }
      }
    ])
  );
  return { token, servers };
}

/** The run ended: its token stops working and its connections close. */
export async function closeGateway(token: string): Promise<void> {
  const r = runs.get(token);
  runs.delete(token);
  if (!r) return;
  await Promise.all(
    [...r.held.values()].map((h) => h.client?.then((c) => c.close()).catch(() => {}))
  );
}

/** The run a request comes from, by its token, while it is going. */
function runOf(request: Request): GatewayRun | undefined {
  const token = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  const r = token ? runs.get(token) : undefined;
  return r && r.until >= Date.now() ? r : undefined;
}

/** Whether a request carries a going run's token: the office's guard lets it through to the gateway. */
export const fromRun = (request: Request): boolean => !!runOf(request);

function clientOf(c: ConnectorRow, h: Held): Promise<Client> {
  h.client ??= upstream(c).catch((e: unknown) => {
    h.client = undefined;
    throw e;
  });
  return h.client;
}

/** Every tool the server lists, once per run. */
function listed(c: ConnectorRow, h: Held): Promise<Tool[]> {
  h.tools ??= clientOf(c, h)
    .then((client) => client.listTools())
    .then((r) => r.tools)
    .catch((e: unknown) => {
      h.tools = undefined;
      throw e;
    });
  return h.tools;
}

/**
 * The tools this grant reaches on this run. A stored Read only tool the
 * server no longer marks as reading, or whose name says it changes something,
 * leaves the stored list too, with a line in the Ledger (`narrowReadTools`).
 */
export async function reachable(c: ConnectorRow, h: Held): Promise<Tool[]> {
  const tools = await listed(c, h);
  if (c.id === POSTAL_ID) return postalTools(tools).filter((t) => c.readTools.includes(t.name));
  // A tool whose own permissions only read (AWS read only's role) holds itself.
  if (h.level === 'act' || c.config.readsByRole) return tools;
  const named = tools.filter((t) => c.readTools.includes(t.name));
  const gone = named.filter((t) => !readsOnly(t)).map((t) => t.name);
  if (gone.length) await narrowReadTools(c.id, gone);
  return named.filter(readsOnly);
}

const refusal = (text: string): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text }]
});

/** Whether a call to `t` changes nothing: the tool only reads, or the service's own role holds it to reading. */
const onlyReads = (c: ConnectorRow, t: Tool): boolean => !!c.config.readsByRole || readsOnly(t);

/**
 * Hold one call that changes something for the owner's yes: it goes on their
 * desk as a call ask, and the run hears that nothing has happened yet.
 */
async function hold(
  c: ConnectorRow,
  name: string,
  args: Record<string, unknown>,
  place: CallPlace | undefined
): Promise<CallToolResult> {
  if (!place)
    return refusal(
      `This run only reads, so it cannot ask to use ${name}. Say what you would change in your reply.`
    );
  const owner = await ownerName();
  const { ask, already } = await raiseCall(
    place,
    { connector: c.id, tool: name, arguments: args },
    c.name
  );
  return {
    content: [
      {
        type: 'text',
        text: `${already ? `This exact call is already on ${owner}'s desk as ask ${ask.id}` : `Held for ${owner}'s yes as ask ${ask.id}`}. Nothing has changed in ${c.name} yet. ${owner} sees this exact call on their desk. If they approve it, the office makes it, and you carry on in a new run with what it returned. Do not call it again, and do not say it is done. Carry on with anything that does not need it, then say in your reply what waits on their yes.`
      }
    ]
  };
}

/**
 * The owner said yes to a held call: the office makes that exact call, as
 * the run would have, and returns what came back. A failure to reach the
 * service throws, so the ask stays open to try again; a tool that answers
 * with an error is a result like any other.
 */
export async function makeCall(call: HeldCall): Promise<NonNullable<HeldCall['result']>> {
  const c = await connector(call.connector);
  if (!c) throw new Error('That service is no longer in the office');
  if (c.id === POSTAL_ID) throw new Error('Physical mail has no approval actions.');
  const client = await upstream(c);
  try {
    const r = (await client.callTool({ name: call.tool, arguments: call.arguments }, undefined, {
      timeout: 5 * 60_000
    })) as CallToolResult;
    const text = r.content
      .map((p) => (p.type === 'text' ? p.text : `[${p.type}]`))
      .join('\n')
      .trim();
    return { ok: !r.isError, text: text || '(no words came back)', at: new Date().toISOString() };
  } finally {
    await client.close().catch(() => {});
  }
}

/** Answer one request from a run's tool to the outside tool `id`. */
export async function gateway(request: Request, id: string): Promise<Response> {
  const run = runOf(request);
  if (!run) return new Response('This run has ended, or never started', { status: 401 });
  const h = run.held.get(id);
  const c = h && (await connector(id));
  if (!h || !c) return new Response('This run does not hold that tool', { status: 403 });

  if (
    id === POSTAL_ID &&
    (!run.staffId ||
      !c.readyAt ||
      !c.config.pmb ||
      c.config.pmb !== h.pmb ||
      !(await grantsFor(run.staffId)).some((g) => g.connectorId === id && g.level === 'read'))
  )
    return new Response('This run no longer has access to this mailbox', { status: 403 });

  const server = new Server(
    { name: `oddboro-gateway-${id}`, version: '1.0.0' },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await reachable(c, h) }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const tool = (await reachable(c, h)).find((t) => t.name === name);
    if (!tool)
      return refusal(
        h.level === 'act'
          ? `${c.name} has no tool named ${name}.`
          : `${name} is not one you may use. Your ${c.name} access is Read only, which reaches only the tools ${c.name} marks as only reading. Ask the owner for Read and write if the work needs it.`
      );
    // At Draft, a change waits for the owner's yes on their desk.
    if (h.waits && !onlyReads(c, tool)) return hold(c, name, req.params.arguments ?? {}, run.place);
    const client = await clientOf(c, h);
    // As long as the run itself may take: the run's own time limit ends it first.
    return (await client.callTool(
      {
        name,
        arguments:
          id === POSTAL_ID
            ? postalArguments(c.config.pmb!, req.params.arguments)
            : req.params.arguments
      },
      undefined,
      {
        timeout: Math.max(60_000, run.until - Date.now())
      }
    )) as CallToolResult;
  });
  // A new server and transport per request, with no session: the run's state
  // (its token, connections and tool list) lives here, not in the transport.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    void server.close();
  }
}
