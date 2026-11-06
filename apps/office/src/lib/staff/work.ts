// A staffer's work in progress, as the office tools track it and the page
// shows it: a job, a follow-up (an approved ask, a rework, feedback) or a
// draft. Safe to import in the browser.

export type Work = {
  /** Unique while the office runs. */
  id: number;
  kind: 'job' | 'follow-up' | 'draft';
  /** The job's name or the ask's title. */
  label: string;
  /** What kind of work it is, in a few words: "Carrying out ask #20". */
  detail: string;
  /** When it started, or joined the line for a slot. */
  since: string;
  /** True while it waits for a free slot. */
  queued: boolean;
  askId?: number;
  /** The tool the staffer is using now, as Claude Code names it. */
  doing?: string;
  /** Tool calls so far. */
  steps: number;
};

/** Claude Code's file tools, which Grok's and Gemini's stand for. */
type FileTool = 'Read' | 'Glob' | 'Grep' | 'Edit' | 'Write';

/**
 * Every tool a run's own tools are named by, in plain words: the one place the
 * owner reads a tool's name from, on the In progress tab and in chat. Each
 * tool's reader gives the floor Claude Code's names (codex.ts, gemini.ts,
 * `streamTools` in cli.ts for Grok).
 */
const TOOL_WORDS: Record<FileTool | 'Bash' | 'ToolSearch', string> = {
  Read: 'Reading files',
  Glob: 'Looking for files',
  Grep: 'Searching files',
  Edit: 'Editing files',
  Write: 'Writing a file',
  /** Codex's shell. */
  Bash: 'Running a command',
  /** Grok finds an MCP tool before it calls one. */
  ToolSearch: 'Looking for a tool'
};

/** Grok's names for the same five tools: what a Grok run gets (grok.ts), and Claude Code's name for each. */
export const GROK_FILE_TOOLS = {
  read_file: 'Read',
  list_dir: 'Glob',
  grep: 'Grep',
  write: 'Write',
  search_replace: 'Edit'
} as const satisfies Record<string, FileTool>;

/**
 * Gemini's built-in file tools, the only ones a Gemini run may call, and
 * Claude Code's name for each, which its reader gives the floor (gemini.ts).
 */
export const GEMINI_FILE_TOOLS = {
  read_file: 'Read',
  read_many_files: 'Read',
  list_directory: 'Glob',
  glob: 'Glob',
  grep_search: 'Grep',
  write_file: 'Write',
  replace: 'Edit'
} as const satisfies Record<string, FileTool>;

/** A tool's name, as Claude Code names it, in plain words. */
export function toolWords(name: string): string {
  if (Object.hasOwn(TOOL_WORDS, name)) return TOOL_WORDS[name as keyof typeof TOOL_WORDS];
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  return m ? `${m[2].replace(/_/g, ' ')} (${m[1]})` : name;
}
