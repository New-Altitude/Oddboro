// The steps of connecting a tool that the office does itself: a hosted
// server's sign-in, and starting a server to list its tools.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { connector, connectorReady, setConnectorConfig, tickKey } from '@oddboro/ledger';
import { getSecret, headerSecret } from './keychain.ts';
import { bearer, startSignIn } from './oauth.ts';

export type ToolInfo = { name: string; description: string; readOnly: boolean };

/** Start a connector with its secrets and list its tools, marking the ones that say they only read. */
export async function listTools(id: string, open = false): Promise<ToolInfo[]> {
  const c = await connector(id);
  if (!c) throw new Error(`No connector named ${id}`);
  const secret = (n: string) => getSecret(c.id, n) ?? '';
  const transport =
    c.kind === 'http'
      ? new StreamableHTTPClientTransport(new URL(c.config.url!), {
          requestInit: {
            headers: {
              ...Object.fromEntries(
                (c.config.headers ?? []).map((n) => [n, headerSecret(c.id, n)])
              ),
              ...(c.config.oauth && !open ? { Authorization: `Bearer ${await bearer(c.id)}` } : {})
            }
          }
        })
      : new StdioClientTransport({
          command: c.config.command!,
          args: c.config.args ?? [],
          env: {
            ...(process.env as Record<string, string>),
            ...Object.fromEntries((c.config.secrets ?? []).map((n) => [n, secret(n)]))
          },
          stderr: 'ignore'
        });
  const client = new Client({ name: 'oddboro-office', version: '1.0.0' });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    return tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      readOnly: t.annotations?.readOnlyHint === true
    }));
  } finally {
    await client.close();
  }
}

/** The owner confirmed which tools only read. The connector is ready. */
export async function confirmTools(id: string, all: string[], readTools: string[]): Promise<void> {
  await connectorReady(
    id,
    all,
    readTools.filter((t) => all.includes(t))
  );
}

/**
 * Start a hosted server's sign-in. Returns the page to open in the owner's browser.
 * A server that turns out to need no sign-in is marked open and the step ticks.
 */
export async function hostedSignIn(id: string): Promise<{ url?: string }> {
  try {
    return await startSignIn(id);
  } catch (signInError) {
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
