// The coding tools an Odd can run on, and the systems each is offered on. The
// hire drawer names the one picked, so this file imports nothing: safe to
// import in the browser.

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
 * The systems each is offered on: only where its sandbox was probed on a
 * made-up home and held. Grok's and Codex's were probed on a Mac only, so a
 * Windows office offers Claude Code alone.
 * Gemini's walls are proved against its own policy engine but not yet in a
 * live run, so it is offered nowhere until that run holds on a Mac; then its
 * list gains 'darwin'.
 */
export const AGENT_PLATFORMS: Record<Agent, readonly NodeJS.Platform[]> = {
  claude: ['darwin', 'linux', 'win32'],
  grok: ['darwin'],
  codex: ['darwin'],
  gemini: []
};
/** The tools an Odd may be hired on or moved to on `platform`. */
export const agentsOn = (platform: NodeJS.Platform): Agent[] =>
  AGENTS.filter((a) => AGENT_PLATFORMS[a].includes(platform));
/** `v` when it names a tool offered on `platform`, for a hire or a move the owner asked for. */
export const offeredAgent = (v: unknown, platform: NodeJS.Platform): Agent | undefined =>
  agentsOn(platform).find((a) => a === v);
