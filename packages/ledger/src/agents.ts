// The coding tools an Odd can run on, the systems each is offered on, and
// whether each may run commands. The hire drawer and the Settings tab read it,
// so this file imports only access-words.ts, which imports nothing: safe to
// import in the browser.
import { officeSection, SWITCH_NAMES } from './access-words.ts';

/** The coding tools an Odd can run on. Each is also the command the office starts. */
export const AGENTS = ['claude', 'grok', 'codex', 'gemini'] as const;
export type Agent = (typeof AGENTS)[number];
/** What the owner reads for each. */
export const AGENT_NAMES: Record<Agent, string> = {
  claude: 'Claude Code',
  grok: 'Grok',
  codex: 'Codex',
  gemini: 'Gemini'
};
/**
 * Per tool, the systems it is offered on (`runs`), the systems where its Run
 * commands switch follows the owner (`commands`: only where its sandbox held
 * commands to the Odd's folders, probed on a made-up home full of decoys), and
 * the systems where its commands may reach the internet when Browse the web is
 * on (`networkWithWeb`: only where its walls were measured holding with the
 * network open, the office's own ports on this Mac among them). `commands` and
 * `networkWithWeb` lie within `runs`. Where the office carries a tool's files
 * (`FILES_VIA_OFFICE`), the office's own file tools hold its files on every
 * system, so it runs where it starts. Codex's sandbox held commands on a Mac
 * and on Linux (Fedora 45, Codex 0.166.0, once it may read its own install);
 * on Windows it opened every Odd's folder to reads, so its commands stay off
 * there. Gemini's walls are proved against its own policy engine but not yet
 * in a live run, so it is offered nowhere until that run holds on a Mac; then
 * its `runs` gains 'darwin'. Claude Code 2.1.318's sandbox refuses the
 * office's own addresses, so its commands may go online on a Mac. Codex
 * 0.166's commands, with its network on, reached the office's own API and
 * database here, and no Codex setting was measured to shut them, so they stay
 * off. Grok and Gemini run no commands.
 */
export const AGENT_PLATFORMS: Record<
  Agent,
  {
    runs: readonly NodeJS.Platform[];
    commands: readonly NodeJS.Platform[];
    networkWithWeb: readonly NodeJS.Platform[];
  }
> = {
  claude: { runs: ['darwin', 'linux', 'win32'], commands: ['darwin'], networkWithWeb: ['darwin'] },
  grok: { runs: ['darwin', 'linux', 'win32'], commands: [], networkWithWeb: [] },
  codex: { runs: ['darwin', 'linux', 'win32'], commands: ['darwin', 'linux'], networkWithWeb: [] },
  gemini: { runs: [], commands: [], networkWithWeb: [] }
};
/**
 * Per tool, the systems where the office carries its files: its own file
 * tools are off, and it reads and changes files only through the office's
 * (files-server.ts in the ledger), which hold its folders the same way on
 * every system and do not change when a tool's own do. Grok through them
 * took about 1.8 times as long on the same tasks (48 runs on a Mac,
 * 2026-11-06), since it reaches an MCP tool only through search_tool and
 * use_tool; the owner chose the same walls everywhere over that speed.
 */
export const FILES_VIA_OFFICE: Record<Agent, readonly NodeJS.Platform[]> = {
  claude: ['darwin', 'linux', 'win32'],
  codex: ['darwin', 'linux', 'win32'],
  grok: ['darwin', 'linux', 'win32'],
  gemini: []
};
/** Whether the office carries the files of a run on `agent` on `platform`. */
export const filesViaOffice = (agent: Agent, platform: NodeJS.Platform): boolean =>
  FILES_VIA_OFFICE[agent].includes(platform);
/**
 * Each tool's own files: the instruction files it loads from a run's folder
 * (`instructions`), and its home folders under the owner's home (`homes`).
 * The office's lists keep their own order, so they are not built from this:
 * a test holds every name here in INSTRUCTIONS (the office's files.ts) and
 * SECRET_STORES (office-folders.ts), so a new tool's files are walled off before it
 * runs.
 */
export const AGENT_FILES: Record<
  Agent,
  { instructions: readonly string[]; homes: readonly string[] }
> = {
  claude: {
    instructions: ['CLAUDE.md', 'CLAUDE.local.md', '.claude', '.mcp.json'],
    homes: ['.claude', '.claude.json']
  },
  grok: { instructions: ['.grok'], homes: ['.grok'] },
  codex: {
    instructions: ['AGENTS.md', 'AGENTS.override.md', '.codex', '.agents'],
    homes: ['.codex']
  },
  gemini: { instructions: ['GEMINI.md', '.gemini'], homes: ['.gemini'] }
};

/**
 * The setting naming the model the office's own runs, and an Odd with none of
 * its own, use on each tool. Claude Code's holds setup's `opus` or `sonnet`;
 * the others hold a model id, or nothing for the tool's default.
 */
export const OFFICE_MODEL_VAR: Record<Agent, string> = {
  claude: 'OFFICE_MODEL',
  codex: 'OFFICE_CODEX_MODEL',
  grok: 'OFFICE_GROK_MODEL',
  gemini: 'OFFICE_GEMINI_MODEL'
};

/** The tools an Odd may be hired on or moved to on `platform`. */
export const agentsOn = (platform: NodeJS.Platform): Agent[] =>
  AGENTS.filter((a) => AGENT_PLATFORMS[a].runs.includes(platform));
/** `v` when it names a tool offered on `platform`, for a hire or a move the owner asked for. */
export const offeredAgent = (v: unknown, platform: NodeJS.Platform): Agent | undefined =>
  agentsOn(platform).find((a) => a === v);

/**
 * The oldest version of each tool the office runs: the one its switches,
 * sandbox and prompts were measured on. An older one fails a run on a switch
 * it does not know (Codex 0.149 had no `features.sleep_tool`, seen
 * 2026-11-05), so the office refuses it and offers Update instead. Raise one
 * when the office starts to rely on something newer.
 */
export const MIN_VERSIONS: Record<Agent, string> = {
  claude: '2.1.318',
  codex: '0.166.0',
  // Grok's runs read their message, and pictures as content blocks, from a
  // --prompt-file, and the system prompt from an agent file with
  // prompt_mode: extend; measured on 1.0.77.
  grok: '1.0.77',
  gemini: '0.66.0'
};

/** Whether version `a` (like 0.149.1) is older than `b`, by its numbers; a missing number counts as 0. */
export function olderThan(a: string, b: string): boolean {
  const [x, y] = [a, b].map((v) =>
    v
      .split(/[.+-]/)
      .slice(0, 3)
      .map((n) => parseInt(n, 10) || 0)
  );
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
}

/**
 * The tool the office runs on (`OFFICE_AGENT` in `.env`), picked at setup:
 * its own runs (drafting a job description, drawing a look, designing an
 * office) and every new hire. A tool this system does not offer, or none,
 * is Claude Code, the one offered everywhere.
 */
export const officeAgentOf = (v: unknown, platform: NodeJS.Platform): Agent =>
  offeredAgent(v, platform) ?? 'claude';

/** Every tool's first account, the one each Odd starts on and setup signs in. */
export const OFFICE_ACCOUNT = 'office';

/** How hard a run thinks, least to most, as the tools name it. */
export const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
export type Effort = (typeof EFFORT_ORDER)[number];
/** What the owner reads for each. */
export const EFFORT_NAMES: Record<Effort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
  ultra: 'Ultra'
};
/**
 * The levels each tool takes for an Odd's run, on the model it runs. Claude
 * Code's `--effort` lists low to max. Codex's Sol lists low to ultra in its
 * model list. Grok's menu for its default model is not published anywhere the
 * office can read, so it offers the levels seen to work. Gemini is offered
 * nowhere yet.
 */
export const EFFORTS: Record<Agent, readonly Effort[]> = {
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  codex: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  grok: ['low', 'medium', 'high'],
  gemini: []
};
/** A model an Odd may run on, and the levels it takes when they differ from its tool's. */
export type ModelChoice = { id: string; name: string; efforts?: readonly Effort[] };
const UP_TO_MAX: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
/**
 * The models each tool offers an Odd, the tool's default first where it has
 * one. An Odd with none picked runs the office's: Claude Code's Opus or
 * Sonnet from setup, else the model `OFFICE_MODEL_VAR` names, else the tool's
 * own default. Codex's list and its levels are the ones its model
 * list shows (Luna stops at Max); Grok's are the models it lists.
 */
export const MODELS: Record<Agent, readonly ModelChoice[]> = {
  claude: [
    { id: 'claude-opus-5-5', name: 'Opus 5.5' },
    { id: 'claude-fable-5-2', name: 'Fable 5.2' },
    { id: 'claude-fable-5-1', name: 'Fable 5.1' },
    { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5' },
    { id: 'claude-haiku-5-5', name: 'Haiku 5.5' }
  ],
  codex: [
    { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' },
    { id: 'gpt-6-astra', name: 'GPT-6 Astra' },
    { id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra' },
    { id: 'gpt-6-sol', name: 'GPT-6 Sol' },
    { id: 'gpt-6-luna', name: 'GPT-6 Luna', efforts: UP_TO_MAX },
    { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
    { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
    { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', efforts: UP_TO_MAX }
  ],
  grok: [
    { id: 'grok-4.7', name: 'Grok 4.7' },
    { id: 'grok-4.7-build-fast', name: 'Grok 4.7 Build Fast' },
    { id: 'grok-4.6', name: 'Grok 4.6' },
    { id: 'grok-4.5', name: 'Grok 4.5' }
  ],
  gemini: []
};
/** The Odd's own model on `agent`, or nothing for the office's: a model kept from another tool does not carry over. */
export const modelFor = (agent: Agent, picked: string | null | undefined): string | undefined =>
  MODELS[agent].find((m) => m.id === picked)?.id;
/** The levels a run on `agent` takes, on the Odd's model when it has one. */
export const effortsOf = (agent: Agent, model?: string | null): readonly Effort[] =>
  MODELS[agent].find((m) => m.id === model)?.efforts ?? EFFORTS[agent];

/** Every Odd thinks at this until the owner picks another. */
export const DEFAULT_EFFORT: Effort = 'medium';
/** The Office Manager runs the floor, so it never thinks below this. */
export const MANAGER_EFFORT_FLOOR: Effort = 'medium';
const rank = (e: Effort) => EFFORT_ORDER.indexOf(e);
/**
 * The level an Odd's runs use on `agent` and its model: the one the owner picked, or
 * Medium when none; a level this tool or model does not take becomes the nearest one
 * below it it does. The Office Manager's is never below Medium. Undefined on a
 * tool that takes none.
 */
export function effortFor(
  agent: Agent,
  picked: string | null | undefined,
  manager: boolean,
  model?: string | null
): Effort | undefined {
  const menu = effortsOf(agent, model);
  if (!menu.length) return undefined;
  const want = EFFORT_ORDER.find((e) => e === picked) ?? DEFAULT_EFFORT;
  const fits = menu.filter((e) => rank(e) <= rank(want));
  let e = fits.at(-1) ?? menu[0];
  if (manager && rank(e) < rank(MANAGER_EFFORT_FLOOR))
    e = menu.find((m) => rank(m) >= rank(MANAGER_EFFORT_FLOOR)) ?? e;
  return e;
}

/**
 * Whether the office's tool, on `model`, draws an Odd's look from words or a
 * headshot: Claude Code on Opus or Fable, Codex on Sol or Astra. With no
 * model named, each runs its default, Opus and Sol. Every other tool and
 * model builds a look from parts, which needs no drawing at all.
 */
export function drawsLooks(agent: Agent, model: string | undefined): boolean {
  if (agent === 'claude') return /opus|fable/i.test(model ?? 'opus');
  if (agent === 'codex') return /sol|astra/i.test(model ?? 'sol');
  return false;
}

/**
 * Why setup shows a tool it does not offer on `platform`, greyed out, or
 * nothing when it is offered. Every tool has a row on every system, so the
 * owner sees what the office can run on and what is coming.
 */
export function notOfferedWhy(agent: Agent, platform: NodeJS.Platform): string | undefined {
  if (AGENT_PLATFORMS[agent].runs.includes(platform)) return undefined;
  if (!AGENT_PLATFORMS[agent].runs.length) return 'Coming soon. We are still testing it.';
  return 'Mac only for now.';
}

/**
 * How the Run commands switch reaches each coding tool, on this system:
 * `switch` follows the owner's choice, and `never` is off whatever it says. `why` is the line the page shows under a
 * switch the owner cannot move. Under a switch locked off, `offer` is the tool
 * on this system that follows it, when there is one.
 */
export type CommandsHow = { state: 'switch' } | { state: 'never'; why: string; offer?: Agent };

/** Why each tool's Run commands is fixed, as the owner reads it. */
export const COMMANDS_WHY: Record<Agent, string> = {
  // Claude Code's sandbox was measured on a Mac only.
  claude: 'Not tested on this system yet.',
  // Codex's Windows sandbox gave every Odd's folder to reads (2026-11-06).
  codex: 'Not safe on Windows yet: Codex cannot keep commands in this Odd’s folders here.',
  // Grok's sandbox blocks a command's network on Linux only, so its sign-in could leave the Mac.
  // Grok's sandbox keeps a command off the network on Linux only, and Windows has none.
  grok: "Not with Grok yet: its sandbox can't keep commands off the internet on every system.",
  gemini: 'Not tested with Gemini yet.'
};

/**
 * Whether an Odd on `agent` may run commands on `platform`. A tool follows the
 * switch where `AGENT_PLATFORMS` says its commands do: Claude Code on a Mac,
 * Codex on a Mac and Linux, where their sandboxes held commands to the Odd's
 * folders. Grok and Gemini never do. The offer is read from the table, never
 * from this function, so it ends after one pass.
 */
export function commandsHow(agent: Agent, platform: NodeJS.Platform): CommandsHow {
  if (AGENT_PLATFORMS[agent].commands.includes(platform)) return { state: 'switch' };
  const offer = agentsOn(platform).find(
    (a) => a !== agent && AGENT_PLATFORMS[a].commands.includes(platform)
  );
  return { state: 'never', why: COMMANDS_WHY[agent], ...(offer ? { offer } : {}) };
}

/**
 * The hire drawer's line on a new Odd's own tools, by how its tool takes Run
 * commands (`commandsHow(...).state`): it names that switch only where the
 * owner can move it. Unknown until the page has the tools, so it names Browse
 * the web alone.
 */
export function hireToolsLine(state?: CommandsHow['state']): string {
  const switches =
    state === 'switch' ? `${SWITCH_NAMES.commands} or ${SWITCH_NAMES.web}` : SWITCH_NAMES.web;
  return `Optional. You can give tools and switch on ${switches} on ${officeSection('their')}, later. They'll ask you when a job needs one.`;
}

/** Whether a run gets a shell: the owner's stored switch, as its tool takes it. */
export function runsCommands(agent: Agent, platform: NodeJS.Platform, stored: boolean): boolean {
  const how = commandsHow(agent, platform);
  return how.state === 'switch' && stored;
}

/** Whether `agent`'s commands may reach the internet with Browse the web on, on `platform`. */
const reachesWeb = (agent: Agent, platform: NodeJS.Platform) =>
  AGENT_PLATFORMS[agent].networkWithWeb.includes(platform);

/** Whether a run's commands reach the internet: commands, Browse the web, and a tool that holds its walls open. */
export function commandsOnline(
  agent: Agent,
  platform: NodeJS.Platform,
  s: { commands: boolean; web: boolean }
): boolean {
  return runsCommands(agent, platform, s.commands) && s.web && reachesWeb(agent, platform);
}

/**
 * Whether a tool's web reads pages as well as searching. Codex's web search is
 * on or off, with no page fetch beside it, so its Odds are told web search only.
 */
export const FETCHES_PAGES: Record<Agent, boolean> = {
  claude: true,
  grok: true,
  codex: false,
  gemini: true
};

/**
 * The line under Browse the web, by what its commands do with it. `held`: this
 * office met a Claude Code that refused the open network, so its commands
 * stay off the internet until the office restarts.
 */
export function webLine(agent: Agent, platform: NodeJS.Platform, held: boolean): string {
  const how = commandsHow(agent, platform).state;
  const web = FETCHES_PAGES[agent] ? 'Search and read web pages.' : 'Search the web.';
  if (how === 'never') return web;
  if (held) return `${web} This version of Claude Code keeps its commands off the internet.`;
  if (!reachesWeb(agent, platform))
    return `${web} ${AGENT_NAMES[agent]}'s commands stay off the internet.`;
  return `${web} With ${SWITCH_NAMES.commands} on, its commands can reach the internet too.`;
}

/** A folder outside the office the owner lets an Odd read, or read and change (`write`), by its real path. */
export type GrantedFolder = { path: string; write: boolean };
