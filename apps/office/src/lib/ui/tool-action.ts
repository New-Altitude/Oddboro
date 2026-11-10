// The one action each coding tool's row offers for its install and sign-in,
// in the list of what the office runs on (OfficeTools.svelte, on setup's Your
// AI card and in the Setup window) and beside the "Runs on" picker
// (RunsOn.svelte), so every place offers the same one. Sign out is a control of
// its own beside it. Plain TypeScript, so the office's node tests run it.
import type { Agent } from '@oddboro/ledger/agents';
import type { AgentTool } from '../../routes/api/agents/+server.ts';

/**
 * What a row's one button does: install the tool, start the browser sign-in,
 * stop the one waiting, sign in again over a sign-in that may have stopped
 * working, or take an API key. Installing offers nothing, since an install
 * runs to its end. None for Claude Code, whose install and sign-in are the
 * Your computer and Your Claude cards, and for a tool this computer does not
 * offer.
 */
export type ToolAction =
  'install' | 'installing' | 'update' | 'sign-in' | 'cancel' | 'sign-in-again' | 'key' | 'none';

/** The action for one tool from `/api/agents`, or for none when the list does not name it. */
export function toolAction(tool: AgentTool | undefined): ToolAction {
  const s = tool?.signIn;
  // Pi ships with the office; only the office bundle can install or update it.
  if (!tool || tool.id === 'pi') return 'none';
  // Before installed: xAI's installer links grok in well before it ends.
  if (s?.installing) return 'installing';
  // Older than the office runs comes first, Claude Code's too: its runs are refused until then.
  if (tool.installed && tool.tooOld) return 'update';
  if (!s) return 'none';
  if (!tool.installed) return 'install';
  if (s.how === 'key') return 'key';
  if (s.waiting) return 'cancel';
  // Signed in still offers a sign-in: the file can hold a sign-in that stopped working.
  return s.signedIn ? 'sign-in-again' : 'sign-in';
}

/** Whether a newer version is out that the owner can update to in one click, though this one still runs. */
export const offersUpdate = (tool: AgentTool | undefined): boolean =>
  tool?.id !== 'pi' &&
  !!tool?.installed &&
  !!tool.newer &&
  !tool.tooOld &&
  !tool.signIn?.installing;

/**
 * Whether the row shows Sign out beside its action: only for a tool signed in
 * and installed, and never while it installs, since that stops nothing and a
 * sign-in file can be there before the tool is.
 */
export function offersSignOut(tool: AgentTool | undefined): boolean {
  return (
    tool?.id !== 'pi' &&
    !!tool?.signIn?.signedIn &&
    !['install', 'installing', 'update'].includes(toolAction(tool))
  );
}

/** Who makes each tool: a row names them, and a browser tool signs in on their page. */
export const MAKERS: Record<Agent, string> = {
  pi: 'Pi',
  claude: 'Anthropic',
  grok: 'xAI',
  codex: 'OpenAI',
  gemini: 'Google'
};

/** What a tool's installer changes beyond the tool itself, said under its Install. */
export const INSTALL_NOTES: Partial<Record<Agent, string>> = {
  grok: `Installs Grok with ${MAKERS.grok}'s installer. It adds Grok to ~/.grok and to your shell's PATH.`
};
