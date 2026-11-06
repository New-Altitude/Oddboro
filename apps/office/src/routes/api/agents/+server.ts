// The coding tools this system offers an Odd (`AGENT_PLATFORMS`), whether
// each is installed, and, for each but Claude Code, its sign-in in the
// office (`signInState`): what the "Runs on" picker (`RunsOn.svelte`) on the
// Access tab and in the hire drawer, onboarding's Other AI tools card and the
// Setup window's Other AI tools section show. Installed means `agentCommand`
// finds the tool's command, the one a run starts. Installs and sign-ins
// themselves go to /api/agents/[tool].
import { json } from '@sveltejs/kit';
import { AGENT_NAMES, agentsOn, type Agent } from '@oddboro/ledger';
import {
  computerWord,
  signInState,
  agentCommand,
  type SignInState
} from '#lib/server/agent-sign-in.ts';
import type { RequestHandler } from './$types';

/** One tool as the page gets it. */
export type AgentTool = { id: Agent; name: string; installed: boolean; signIn?: SignInState };

export const GET: RequestHandler = () => {
  const platform = process.platform;
  return json({
    // The picker's word for this computer.
    computer: computerWord(),
    tools: agentsOn(platform).map((id): AgentTool => ({
      id,
      name: AGENT_NAMES[id],
      installed: !!agentCommand(id),
      ...(id === 'claude' ? {} : { signIn: signInState(id) })
    }))
  });
};
