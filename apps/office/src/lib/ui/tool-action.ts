// Which coding tools get a row for their install and sign-in, and the one
// action each row offers, in Other AI tools (ToolRows.svelte, on onboarding's
// card and in the Setup window) and beside the "Runs on" picker
// (RunsOn.svelte), so every place offers the same one. Sign out is a control of
// its own beside it. Plain TypeScript, so the office's node tests run it.
import type { Agent } from '@oddboro/ledger/agents';
import type { AgentTool } from '../../routes/api/agents/+server.ts';

/** One row of Other AI tools: a tool that signs in here, with its sign-in. */
export type SignInRow = { tool: AgentTool; signIn: NonNullable<AgentTool['signIn']> };

/**
 * The rows of Other AI tools: each tool in `/api/agents` that signs in here,
 * so every one but Claude Code, and none the list leaves out (Gemini until it
 * names this system).
 */
export function signInRows(tools: readonly AgentTool[]): SignInRow[] {
  return tools.flatMap((tool) => (tool.signIn ? [{ tool, signIn: tool.signIn }] : []));
}

/**
 * Whether Other AI tools shows at all, as onboarding's card and the Setup
 * window's section: only when it has a row, so never where Claude Code is the
 * one tool offered.
 */
export function offersOtherTools(tools: readonly AgentTool[]): boolean {
  return signInRows(tools).length > 0;
}

/**
 * What a row's one button does: install the tool, start the browser sign-in,
 * stop the one waiting, sign in again over a sign-in that may have stopped
 * working, or take an API key. Installing offers nothing, since an install
 * runs to its end. None for Claude Code, whose install and sign-in are the
 * Your computer and Your Claude cards, and for a tool this computer does not
 * offer.
 */
export type ToolAction =
  'install' | 'installing' | 'sign-in' | 'cancel' | 'sign-in-again' | 'key' | 'none';

/** The action for one tool from `/api/agents`, or for none when the list does not name it. */
export function toolAction(tool: AgentTool | undefined): ToolAction {
  const s = tool?.signIn;
  if (!tool || !s) return 'none';
  // Before installed: xAI's installer links grok in well before it ends.
  if (s.installing) return 'installing';
  if (!tool.installed) return 'install';
  if (s.how === 'key') return 'key';
  if (s.waiting) return 'cancel';
  // Signed in still offers a sign-in: the file can hold a sign-in that stopped working.
  return s.signedIn ? 'sign-in-again' : 'sign-in';
}

/**
 * Whether the row shows Sign out beside its action: only for a tool signed in
 * and installed, and never while it installs, since that stops nothing and a
 * sign-in file can be there before the tool is.
 */
export function offersSignOut(tool: AgentTool | undefined): boolean {
  return !!tool?.signIn?.signedIn && !['install', 'installing'].includes(toolAction(tool));
}

/** Who makes each tool: a row names them, and a browser tool signs in on their page. */
export const MAKERS: Record<Agent, string> = {
  claude: 'Anthropic',
  grok: 'xAI',
  codex: 'OpenAI',
  gemini: 'Google'
};

/** What a tool's installer changes beyond the tool itself, said under its Install. */
export const INSTALL_NOTES: Partial<Record<Agent, string>> = {
  grok: `Installs Grok with ${MAKERS.grok}'s installer. It adds Grok to ~/.grok and to your shell's PATH.`
};
