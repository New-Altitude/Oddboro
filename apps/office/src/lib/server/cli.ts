// What a staffer's run does by the coding tool it runs on, apart from Claude
// Code's own arguments, which run() in staff.ts builds: how a run on Grok,
// Codex or Gemini starts (grok.ts, codex.ts, gemini.ts), what each tool's own
// file tools reach as the run's prompt says it, the tools a line of Claude
// Code's stream names (Grok streams in that shape), and why a run ended
// early. Server only.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Agent } from '@oddboro/ledger';
import { deniedEdits } from './files.ts';
import type { RunEvent } from './launch.ts';
import { GROK_PLAN_LIMIT, GROK_SIGN_IN, grokLaunch, grokSignedOut } from './grok.ts';
import { codexLaunch, codexReader, codexSignedOut } from './codex.ts';
import { geminiKeyMissing, geminiLaunch, geminiReader } from './gemini.ts';
import { GROK_FILE_TOOLS } from '../staff/work.ts';

/**
 * How one run starts: the tool's arguments, environment and input, and what
 * to remove once it ends. `read` turns a line of a tool's own stream into
 * what the run takes from it; without one, the line is in Claude Code's
 * stream shape, which Grok's follows. `ownGroup`: the tool has a shell, whose
 * commands may outlive it, so the run is a process group of its own, and that
 * group and the group of every process under it stop when the run ends or
 * times out (`stopGroups`).
 */
export type Launch = {
  args: string[];
  env: NodeJS.ProcessEnv;
  stdin: string;
  done: () => void;
  read?: (e: Record<string, unknown>) => RunEvent[];
  ownGroup?: true;
};

/** What a run on Grok, Codex or Gemini needs from run(). */
export type CliRun = {
  /** The run's key (`runsGoing`). */
  key: string;
  staffId: string;
  /** The Odd's folder, the run's cwd. */
  dir: string;
  /** The folders the run reads besides its own: the owner's data folder, and its thread's or those of the goals a lead's chat leads. */
  reads: string[];
  /** On a thread: the Odd's own part of it. */
  part?: string;
  /** The folders the run writes: its own, and on a thread its part of it. */
  writes: string[];
  /** The file the owner edited, by its path inside `dir`, which a run reading that edit may not write. */
  edited?: string;
  system: string;
  /** The catch-up preface and the message. */
  input: string;
  /** The session to resume, else a new one. */
  resume?: string;
  servers: Record<string, Record<string, unknown>>;
  /** The MCP tools the run may call, as access() names them for Claude Code (`mcp__server` or `mcp__server__tool`). */
  allowed: string[];
  /** The longest the run may take before the office cuts it. */
  timeoutMs: number;
};

/**
 * Each tool but Claude Code, whose arguments run() builds from its own
 * rules. Every one has an entry, so a new tool fails the type check until it
 * is handled. A tool that cannot start says why instead (`refused`).
 */
export const LAUNCHES: Record<
  Exclude<Agent, 'claude'>,
  (r: CliRun) => Promise<Launch | { refused: string }>
> = {
  grok: async (r) => {
    const signedOut = await grokSignedOut(r.timeoutMs);
    if (signedOut) return { refused: signedOut };
    return {
      ...grokLaunch({
        key: r.key,
        staffId: r.staffId,
        dir: r.dir,
        reads: r.reads,
        part: r.part,
        writes: r.writes,
        deniedEdits: deniedEdits(r.dir, r.writes, r.edited),
        system: r.system,
        message: r.input,
        resume: r.resume,
        newSession: randomUUID(),
        servers: r.servers,
        allowed: r.allowed
      }),
      // Grok takes its message as an argument and reads no input.
      stdin: ''
    };
  },
  codex: async (r) => {
    const signedOut = codexSignedOut();
    if (signedOut) return { refused: signedOut };
    return {
      ...codexLaunch({
        key: r.key,
        dir: r.dir,
        reads: r.reads,
        writes: r.writes,
        edited: r.edited && join(r.dir, r.edited),
        system: r.system,
        input: r.input,
        resume: r.resume,
        servers: r.servers,
        allowed: r.allowed
      }),
      read: codexReader(process.env.OFFICE_CODEX_MODEL ?? 'codex'),
      ownGroup: true
    };
  },
  gemini: async (r) => {
    const missing = geminiKeyMissing();
    if (missing) return { refused: missing };
    return {
      ...geminiLaunch({
        key: r.key,
        dir: r.dir,
        reads: r.reads,
        writes: r.writes,
        edited: r.edited,
        system: r.system,
        input: r.input,
        resume: r.resume,
        servers: r.servers,
        allowed: r.allowed
      }),
      read: geminiReader(Object.keys(r.servers)),
      // Its MCP servers are processes of their own, which stop with the run.
      ownGroup: true
    };
  }
};

const FILES_ONLY = 'Your own tools work on files only: no shell and no web.';
/**
 * What a run's own tools reach, by the tool it runs on: Claude Code, Grok and
 * Gemini get file tools only, and Codex its shell, which the kernel holds to
 * the run's folders with the network off (codex.ts). Gemini's policy allows a
 * write only by its full path (gemini.ts).
 */
export const OWN_TOOLS: Record<Agent, string> = {
  claude: FILES_ONLY,
  grok: FILES_ONLY,
  gemini: `${FILES_ONLY} Give each file tool the file's full path.`,
  codex:
    'Your own tools are a shell and file edits, confined to your folders, with no network and no web.'
};

/**
 * Claude Code's name for a tool Grok names: a file tool by GROK_FILE_TOOLS,
 * and search_tool, which finds an MCP tool before Grok calls it, ToolSearch.
 */
function grokTool(name: string): string {
  if (Object.hasOwn(GROK_FILE_TOOLS, name))
    return GROK_FILE_TOOLS[name as keyof typeof GROK_FILE_TOOLS];
  return name === 'search_tool' ? 'ToolSearch' : name;
}

/**
 * The tools one line of Claude Code's stream names, by Claude Code's names,
 * as the floor is told them. Grok streams in the same shape with its own
 * names (`grokTool`), and calls every MCP tool through use_tool, which names
 * it as server__tool: that call shows once, from the whole message, the way
 * Claude Code names one, mcp__server__tool.
 */
export function streamTools(agent: Agent, e: Record<string, unknown>): string[] {
  if (e.type === 'stream_event') {
    const ev = e.event as { type: string; content_block?: { type: string; name?: string } };
    if (
      ev.type !== 'content_block_start' ||
      ev.content_block?.type !== 'tool_use' ||
      ev.content_block.name === 'use_tool'
    )
      return [];
    const name = ev.content_block.name ?? 'a tool';
    return [agent === 'grok' ? grokTool(name) : name];
  }
  if (e.type !== 'assistant') return [];
  const blocks = (e.message as { content?: unknown } | undefined)?.content;
  return (Array.isArray(blocks) ? blocks : []).flatMap((b: unknown) => {
    const block = b as { name?: unknown; input?: { tool_name?: unknown } };
    return block.name === 'use_tool' && typeof block.input?.tool_name === 'string'
      ? [`mcp__${block.input.tool_name}`]
      : [];
  });
}

/**
 * Grok's words when its plan has no usage left: the line its stream ends a
 * run with, and the error code under it (`subscription:free-usage-exhausted`
 * in its log's turn.terminal_failure), both from the walk on 2026-11-04.
 */
const GROK_PLAN_SPENT = /reached your .*usage limit|usage-exhausted/i;

/**
 * Why a run ended without its result, in the tool's own words when it gave
 * any. Grok's own advice for an office Grok home nobody signed in to,
 * `grok login`, would sign in the owner's ~/.grok instead, so that one points
 * to the office's own sign-in, on the page (`GROK_SIGN_IN`). Its plan limit carries
 * an upsell link, so that one is the office's own words (`GROK_PLAN_LIMIT`).
 */
export function endedEarly(agent: Agent, e: Record<string, unknown>): string {
  const said = (Array.isArray(e.errors) ? e.errors : [])
    .filter((x): x is string => typeof x === 'string')
    .join(' ');
  if (agent === 'grok' && /^Not signed in\b/.test(said)) return GROK_SIGN_IN;
  if (agent === 'grok' && GROK_PLAN_SPENT.test(said)) return GROK_PLAN_LIMIT;
  return `The session ended early (${String(e.subtype)})${said ? `: ${said}` : '.'}`;
}
