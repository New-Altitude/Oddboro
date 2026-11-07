// The Pi SDK supplies the agent loop, not the Pi CLI: no global Pi config, skills, extensions or built-in shell are loaded.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Agent, type AgentMessage, type AgentTool } from '@earendil-works/pi-agent-core';
import { createModels, createProvider, type Model } from '@earendil-works/pi-ai';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  getDefaultEnvironment
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

type Server = {
  type?: string;
  url?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
};
type Input = {
  staffId: string;
  account: string;
  system: string;
  input: string;
  resume?: string;
  sessionDir: string;
  baseUrl: string;
  model: string;
  sourceIdentity: string;
  servers: Record<string, Server>;
  allowed: string[];
  images: { path: string; mediaType: string }[];
  timeoutMs: number;
  bare: boolean;
};
const emit = (event: unknown) => process.stdout.write(`${JSON.stringify(event)}\n`);
// Capture the inference key before starting any MCP child; its environment must not inherit it.
const key = process.env.ODDBORO_PI_API_KEY;
delete process.env.ODDBORO_PI_API_KEY;
const clients: Client[] = [];
const controller = new AbortController();
let agent: Agent | undefined;
let stopping = false;
const stop = () => {
  stopping = true;
  controller.abort();
  agent?.abort();
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);

async function readInput(): Promise<Input> {
  let text = '';
  for await (const chunk of process.stdin) {
    text += chunk.toString();
    if (text.length > 4_000_000) throw new Error('Run input is too large.');
  }
  const input = JSON.parse(text) as Input;
  if (
    !key ||
    !input ||
    !input.sourceIdentity ||
    !input.model ||
    !input.baseUrl ||
    !input.staffId ||
    !input.account ||
    !input.servers ||
    typeof input.servers !== 'object' ||
    Array.isArray(input.servers) ||
    !Array.isArray(input.allowed)
  )
    throw new Error('Invalid Pi run.');
  const url = new URL(input.baseUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('Invalid Magpie address.');
  return input;
}

async function mcpTools(input: Input): Promise<AgentTool<any>[]> {
  const tools: AgentTool<any>[] = [];
  for (const [name, server] of Object.entries(input.servers)) {
    // Only the office's existing grants become model-visible; other server tools stay unavailable.
    const prefix = `mcp__${name}`;
    const whole = input.allowed.includes(prefix);
    const individual = new Set(
      input.allowed
        .filter((s) => s.startsWith(`${prefix}__`))
        .map((s) => s.slice(prefix.length + 2))
    );
    if (!whole && !individual.size) continue;
    const client = new Client({ name: 'oddboro-pi', version: '1.0.0' });
    clients.push(client);
    if (server.type === 'http') {
      if (!server.url) throw new Error('A granted tool server has no address.');
      await client.connect(
        new StreamableHTTPClientTransport(new URL(server.url), {
          requestInit: { headers: server.headers ?? {} }
        }),
        { timeout: input.timeoutMs, signal: controller.signal }
      );
    } else {
      if (!server.command) throw new Error('A granted tool server has no command.');
      const env = { ...getDefaultEnvironment(), ...server.env };
      delete env.ODDBORO_PI_API_KEY;
      await client.connect(
        new StdioClientTransport({
          command: server.command,
          args: server.args ?? [],
          env,
          stderr: 'ignore'
        }),
        { timeout: input.timeoutMs, signal: controller.signal }
      );
    }
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    let count = 0;
    let pages = 0;
    do {
      if (++pages > 100 || (cursor && seenCursors.has(cursor)))
        throw new Error('Tool list is incomplete.');
      if (cursor) seenCursors.add(cursor);
      const page = await client.listTools(cursor ? { cursor } : undefined, {
        timeout: input.timeoutMs,
        signal: controller.signal
      });
      for (const tool of page.tools) {
        if (!whole && !individual.has(tool.name)) continue;
        const full = `${prefix}__${tool.name}`;
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(full) || tools.some((t) => t.name === full))
          throw new Error('A granted tool name cannot be used by Pi.');
        tools.push({
          name: full,
          label: full,
          description: tool.description ?? tool.name,
          parameters: tool.inputSchema,
          execute: async (_id: string, args: unknown, signal?: AbortSignal) => {
            const result = await client.callTool(
              { name: tool.name, arguments: args as Record<string, unknown> },
              undefined,
              { signal, timeout: input.timeoutMs }
            );
            if (result.isError) throw new Error('The tool returned an error.');
            if (!Array.isArray(result.content)) throw new Error('Invalid tool response.');
            const content = result.content.flatMap<
              { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
            >((part: Record<string, unknown>) => {
              if (part.type === 'text' && typeof part.text === 'string')
                return [{ type: 'text' as const, text: part.text }];
              if (
                part.type === 'image' &&
                typeof part.data === 'string' &&
                typeof part.mimeType === 'string'
              )
                return [{ type: 'image' as const, data: part.data, mimeType: part.mimeType }];
              return [{ type: 'text' as const, text: JSON.stringify(part) }];
            });
            return { content, details: {} };
          }
        });
        if (++count > 1000) throw new Error('Too many granted tools.');
      }
      cursor = page.nextCursor;
    } while (cursor);
  }
  return tools;
}

async function main(): Promise<void> {
  const input = await readInput();
  // A saved transcript cannot cross an Odd, account, connection or selected route.
  const route = createHash('sha256')
    .update(
      JSON.stringify([
        input.staffId,
        input.account,
        input.sourceIdentity,
        input.baseUrl,
        input.model
      ])
    )
    .digest('hex');
  const session = input.resume ?? randomUUID();
  if (!/^[0-9a-f-]{36}$/i.test(session)) throw new Error('Invalid Pi session.');
  const dir = join(input.sessionDir, route);
  const file = join(dir, `${session}.json`);
  let messages: AgentMessage[] | undefined;
  if (input.resume) {
    const saved = JSON.parse(await readFile(file, 'utf8')) as {
      route?: string;
      messages?: AgentMessage[];
    };
    if (saved.route !== route || !Array.isArray(saved.messages))
      throw new Error('The Pi session is unavailable.');
    messages = saved.messages;
  }
  const baseUrl = `${input.baseUrl.replace(/\/$/, '')}/v1`;
  const model: Model<'openai-responses'> = {
    id: input.model,
    name: input.model,
    provider: 'magpie',
    api: 'openai-responses',
    baseUrl,
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192
  };
  const models = createModels();
  models.setProvider(
    createProvider({
      id: 'magpie',
      auth: { apiKey: { name: 'Magpie', resolve: async () => ({ auth: { apiKey: key! } }) } },
      models: [model],
      api: openAIResponsesApi()
    })
  );
  // The office's granted MCP servers are the complete tool set. Its per-run
  // file server holds file access; external calls use the office gateway and
  // its existing Draft approval gate. A bare office run gets neither.
  const tools = input.bare ? [] : await mcpTools(input);
  if (stopping) throw new Error('Run stopped.');
  agent = new Agent({
    initialState: { systemPrompt: input.system, model, tools, ...(messages ? { messages } : {}) },
    streamFn: models.streamSimple.bind(models),
    sessionId: session,
    toolExecution: 'sequential',
    identity: { attribution: null }
  });
  let failed = false;
  agent.subscribe((event) => {
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta')
      emit({ type: 'delta', text: event.assistantMessageEvent.delta });
    if (event.type === 'tool_execution_start') emit({ type: 'tool', name: event.toolName });
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const message = event.message;
      if (
        message.usage &&
        (message.usage.input ||
          message.usage.output ||
          message.usage.cacheRead ||
          message.usage.cacheWrite)
      )
        emit({
          type: 'usage',
          usage: {
            [input.model]: {
              inputTokens: message.usage.input,
              outputTokens: message.usage.output,
              cacheReadInputTokens: message.usage.cacheRead,
              cacheCreationInputTokens: message.usage.cacheWrite,
              // Pi's zero-rate model metadata is not a billed cost. Keep unknown cost null.
              costUSD: message.usage.cost.totalFromProvider ? message.usage.cost.total : null
            }
          }
        });
      if (message.stopReason !== 'stop' && message.stopReason !== 'toolUse') {
        failed = true;
        return;
      }
      const text = message.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('');
      if (text) emit({ type: 'message', text });
    }
  });
  const images = await Promise.all(
    input.images.map(async (image) => ({
      type: 'image' as const,
      data: (await readFile(image.path)).toString('base64'),
      mimeType: image.mediaType
    }))
  );
  await agent.prompt(input.input, images);
  if (failed || stopping) throw new Error('The Magpie run did not complete.');
  if (!input.bare) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ route, messages: agent.state.messages }), {
      mode: 0o600
    });
    await rename(temporary, file);
    emit({ type: 'session', id: session });
  }
}

void (async () => {
  let ok = false;
  try {
    await main();
    ok = true;
  } catch {
    emit({
      type: 'failed',
      message: stopping
        ? 'The Pi run was stopped.'
        : 'Pi could not complete the Magpie run. Check the connection and granted tools.'
    });
  } finally {
    await Promise.allSettled(clients.map((client) => client.close()));
    if (ok) emit({ type: 'done' });
  }
})();
