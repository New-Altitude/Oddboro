// The steps of connecting a tool that the office does itself: a hosted
// server's sign-in, and starting a server to list its tools. `upstream` is
// the one way the office reaches an outside server, here and in the gateway
// every run goes through (gateway.ts).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  AWS_SECRETS_ID,
  POSTAL_ID,
  POSTAL_URL,
  bindPostalMailbox,
  connector,
  connectorReady,
  notesOf,
  refreshTools,
  type ToolChanges,
  readsOnly,
  setConnectorConfig,
  tickKey,
  toolCommand,
  type ConnectorRow,
  type GoogleProduct
} from '@oddboro/ledger';
import { awsReady, secretNamesClient, toolKeys } from './aws.ts';
import { driveServer } from './google/drive.ts';
import { gmailServer, heldWords, type HeldWords } from './google/gmail.ts';
import { bearer, BuiltWithout, startSignIn } from './oauth.ts';
import { postalInboxes, postalTools } from './postal.ts';
import { outsideToolEnv } from './run-env-allow.ts';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/** Check the sign-in the run will use, including an AWS role that holds another tool's key. */
export async function sourceReady(c: ConnectorRow): Promise<boolean> {
  if (c.config.oauth && !(await bearer(c.id).catch(() => undefined))) return false;
  return awsReady(c);
}

export type ToolInfo = { name: string; description: string; readOnly: boolean };

/**
 * Connect to an outside server with its keys and sign-in, which stay in the
 * office. `open` leaves the sign-in out, to see whether it needs one.
 */
export async function upstream(c: ConnectorRow, open = false): Promise<Client> {
  if (
    c.id === POSTAL_ID &&
    (c.kind !== 'http' || c.config.url !== POSTAL_URL || c.config.oauth !== true || open)
  )
    throw new Error('Physical mail requires sign-in at the LegalZoom read-only endpoint.');
  if (c.kind === 'builtin') return builtin(c);
  // AWS Secrets Manager's names come from the office itself, never a server.
  if (c.id === AWS_SECRETS_ID) return secretNamesClient();
  const { env, headers } = await toolKeys(c);
  const token = c.config.oauth && !open ? await bearer(c.id) : undefined;
  if (c.id === POSTAL_ID && !token) throw new Error('Reconnect LegalZoom to read physical mail.');
  let transport: StdioClientTransport | StreamableHTTPClientTransport;
  switch (c.kind) {
    case 'http':
      // A hosted connector is saved with its address (registry.ts).
      transport = new StreamableHTTPClientTransport(new URL(c.config.url!), {
        requestInit: {
          headers: {
            ...headers,
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          }
        }
      });
      break;
    case 'stdio':
      transport = new StdioClientTransport({
        ...toolCommand(c.config.command!, c.config.args ?? []),
        // Only what a run may have of the office's environment, as when the
        // run's own tool started the server, and the connector's own keys. No
        // `AWS_` setting of the owner's is listed: a tool server runs outside
        // the sandbox and could sign in as the owner.
        env: { ...outsideToolEnv(), ...env },
        stderr: 'ignore'
      });
      break;
    default: {
      const missed: never = c.kind;
      throw new Error(`No way to start a ${String(missed)} connector`);
    }
  }
  const client = new Client({ name: 'oddboro-office', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

/** The servers the office serves itself, by the Google product a connector serves. */
const BUILTIN: Record<
  GoogleProduct,
  (token: () => Promise<string>, account?: string) => McpServer
> = {
  gmail: gmailServer,
  drive: driveServer
};

/**
 * A server the office serves itself, inside this process: Gmail and Google
 * Drive, one server per account, whose tools name the account they reach.
 * Each call asks `bearer` for a live token, so the Google sign-in never
 * leaves the office, not even to a process of its own.
 */
/** A live token for one of the office's own Google connectors, asked of `bearer` each time. */
const tokenOf = (c: ConnectorRow) => async () => {
  const t = await bearer(c.id);
  if (!t) throw new Error(`${c.name} needs signing in again. Call reconnect_access.`);
  return t;
};

/**
 * A held call to the office's own Gmail in the owner's words (`heldWords`):
 * what it does and to which emails. Undefined for any other call, or when
 * Gmail cannot be read now, so the desk shows the call as it is.
 */
export async function heldWordsFor(
  c: ConnectorRow,
  tool: string,
  args: Record<string, unknown>
): Promise<HeldWords | undefined> {
  if (c.kind !== 'builtin' || c.config.google !== 'gmail') return undefined;
  return heldWords(tokenOf(c), tool, args).catch(() => undefined);
}

async function builtin(c: ConnectorRow): Promise<Client> {
  const make = c.config.google && BUILTIN[c.config.google];
  if (!make) throw new Error(`The office serves no tool named ${c.id}`);
  const token = tokenOf(c);
  const [ours, theirs] = InMemoryTransport.createLinkedPair();
  await make(token, c.config.account).connect(theirs);
  const client = new Client({ name: 'oddboro-office', version: '1.0.0' });
  await client.connect(ours);
  return client;
}

/** Start a connector with its secrets and list its tools, marking the ones a Read only grant reaches (`readsOnly`). */
export async function listTools(id: string, open = false): Promise<ToolInfo[]> {
  const c = await connector(id);
  if (!c) throw new Error(`No connector named ${id}`);
  const client = await upstream(c, open);
  try {
    const { tools } = await client.listTools();
    return tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      readOnly: !!c.config.readsByRole || readsOnly(t)
    }));
  } finally {
    await client.close();
  }
}

/**
 * The owner confirmed the tools: the connector is ready. The office lists
 * them again itself and works out which ones Read only reaches, so nothing
 * the page sends can add a tool that changes something.
 */
export async function confirmTools(id: string): Promise<void> {
  if (id === POSTAL_ID) throw new Error('Choose the physical mailbox first.');
  const tools = await listTools(id);
  await connectorReady(
    id,
    tools.map((t) => t.name),
    tools.filter((t) => t.readOnly).map((t) => t.name),
    notesOf(tools)
  );
}

/**
 * Ask a service for its tools now and bring the stored ones up to date: the
 * owner's Refresh, and their opening its actions on the Settings tab.
 */
export async function refreshService(id: string): Promise<ToolChanges> {
  const c = await connector(id);
  // Connecting stores the first list (`confirmTools`); until then there is none to keep.
  if (!c?.readyAt) throw new Error('Finish connecting it first');
  return refreshTools(id, await listTools(id));
}

/**
 * Start a hosted server's sign-in. Returns the page to open in the owner's browser.
 * A server that turns out to need no sign-in is marked open and the step ticks.
 */
export async function hostedSignIn(id: string): Promise<{ url?: string }> {
  try {
    return await startSignIn(id);
  } catch (signInError) {
    // A Google tool always needs its sign-in: listing its tools takes none, so
    // the check below would wrongly mark it open. A build without a sign-in's
    // secret says so, never that the server offers none. Physical mail only
    // ever reads with its sign-in.
    if (
      id === POSTAL_ID ||
      (await connector(id))?.config.oauth === 'google' ||
      signInError instanceof BuiltWithout
    )
      throw signInError;
    try {
      await listTools(id, true);
    } catch {
      // Neither a sign-in nor an open door: most likely it takes a key.
      const why = signInError instanceof Error ? signInError.message : String(signInError);
      throw new Error(
        `This server did not offer a sign-in${why ? ` (${why})` : ''}. If its setup guide gives you a key instead, open the Odd's Settings, then Services, click + Add service, paste the server's address, and pick Takes a key.`
      );
    }
    const c = await connector(id);
    if (c) await setConnectorConfig(id, { ...c.config, oauth: false });
    await tickKey(`oauth:${id}`);
    return {};
  }
}

/** Only the owner's setup step may enumerate mailboxes. Never give that tool to a run. */
export async function postalSetup(taskId: number, selected?: string) {
  const c = await connector(POSTAL_ID);
  if (!c) throw new Error('Request physical mail access first.');
  const client = await upstream(c);
  try {
    const { tools } = await client.listTools();
    const checked = (name: string) => tools.some((t) => t.name === name && readsOnly(t));
    if (!checked('list_inboxes'))
      throw new Error('LegalZoom did not offer read-only mailbox discovery.');
    const inboxes = postalInboxes(
      (await client.callTool({ name: 'list_inboxes', arguments: {} })) as CallToolResult
    );
    if (selected !== undefined) {
      if (!selected.trim() || selected.length > 80) throw new Error('Choose a mailbox number.');
      if (inboxes.length && !inboxes.some((i) => i.pmb === selected))
        throw new Error('Choose a mailbox from your LegalZoom account.');
      // Even when discovery returned prose, check the exact owner-supplied number with
      // the provider before binding it. Never use the first mailbox as a default.
      if (
        !checked('get_inbox_overview') ||
        (await client.callTool({ name: 'get_inbox_overview', arguments: { pmb: selected } }))
          .isError
      )
        throw new Error('LegalZoom could not verify that mailbox.');
      const names = postalTools(tools).map((t) => t.name);
      if (names.length !== 3)
        throw new Error('LegalZoom did not offer all three required mail reads.');
      await bindPostalMailbox(taskId, selected, names);
    }
    return { inboxes: c.config.pmb ? inboxes.filter((i) => i.pmb === c.config.pmb) : inboxes };
  } finally {
    await client.close();
  }
}
