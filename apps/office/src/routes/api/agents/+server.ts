// The coding tools this system offers an Odd (`AGENT_PLATFORMS`), whether
// each is installed, and each one's Office account sign-in (`signInState`,
// Claude Code's `claudeSignInState`), with the accounts the owner added and
// theirs (`accounts`): what the "Runs on" picker (`RunsOn.svelte`) on the
// Settings tab and in the hire drawer, setup's Your AI card and the Setup
// window show. Installed means `agentCommand` finds the tool's command, the
// one a run starts. `office` is the tool the office runs on, and `later` the
// tools this system does not offer yet, which setup shows greyed out with
// why. `drawsLooks` says whether the office's tool, on its model, draws an
// Odd's look; when it does not, the hire offers building one from parts. Each installed tool says its version, a newer one when its maker has
// one out, and the oldest the office runs when it is older (versions.ts).
// Each tool says how it takes Run commands on this system (`commandsHow`), so
// the hire drawer names that switch only where the owner can move it, and the
// model an Odd with none of its own runs on it (`officeModel`).
// PUT picks the office's tool. Installs and sign-ins themselves go to
// /api/agents/[tool].
import { error, json } from '@sveltejs/kit';
import {
  AGENT_NAMES,
  AGENTS,
  agentsOn,
  commandsHow,
  type CommandsHow,
  listAccounts,
  notOfferedWhy,
  officeAgent,
  offeredAgent,
  type Agent
} from '@oddboro/ledger';
import { writeEnv } from '@oddboro/ledger/env';
import {
  claudeSignInState,
  computerWord,
  signInState,
  agentCommand,
  type SignInState
} from '#lib/server/agent-sign-in.ts';
import { claudeAccount, claudeSettings } from '#lib/server/claude.ts';
import { officeDrawsLooks } from '#lib/server/claude.ts';
import { runsActive } from '#lib/server/staff.ts';
import { magpieRunConnection } from '#lib/server/magpie.ts';
import { officeModel } from '#lib/server/profile.ts';
import { versionState, type VersionState } from '#lib/server/versions.ts';
import type { RequestHandler } from './$types';

/** One tool as the page gets it. */
export type AgentTool = {
  id: Agent;
  name: string;
  installed: boolean;
  signIn?: SignInState;
  commandsHow: CommandsHow;
  magpieReady?: boolean;
  /** The model an Odd with none of its own runs on this tool, for the Office default card. */
  officeModel?: string;
} & VersionState;
/** A tool this system does not offer yet, with why, for setup's greyed row. */
export type LaterTool = { id: Agent; name: string; why: string };
/** An account the owner added, with its sign-in, for the Model tab's cards. */
export type AccountState = { id: string; agent: Agent; label: string; signIn: SignInState };

/** One account's sign-in: Claude Code's read with its own folder, the rest from their files. */
const stateOf = (tool: Agent, account?: string): Promise<SignInState> | SignInState =>
  tool === 'pi'
    ? { how: 'key', installing: false, signedIn: false }
    : tool === 'claude'
      ? claudeSignInState(
          account,
          // Only the Office account on the Claude plan falls back to the owner's own login.
          !account && claudeSettings().auth === 'plan' ? () => claudeAccount() : undefined
        )
      : signInState(tool, account);

export const GET: RequestHandler = async () => {
  const platform = process.platform;
  const magpieModel = process.env.OFFICE_MAGPIE_MODEL
    ? `magpie:${process.env.OFFICE_MAGPIE_MODEL}`
    : null;
  let gatewayReady = false;
  if (magpieModel) {
    try {
      await magpieRunConnection(magpieModel.slice(7));
      gatewayReady = true;
    } catch {
      /* Shown as unavailable. */
    }
  }
  return json({
    officeModel: magpieModel,
    // The picker's word for this computer.
    computer: computerWord(),
    office: officeAgent(),
    officeConfigured: !!process.env.OFFICE_AGENT,
    drawsLooks: officeDrawsLooks(),
    tools: await Promise.all(
      agentsOn(platform).map(async (id): Promise<AgentTool> => {
        const installed = !!agentCommand(id);
        const version = installed ? await versionState(id) : {};
        return {
          id,
          name: AGENT_NAMES[id],
          installed,
          signIn:
            id === 'pi'
              ? { how: 'key', installing: false, signedIn: gatewayReady }
              : await stateOf(id),
          commandsHow: commandsHow(id, platform),
          magpieReady:
            installed &&
            !version.tooOld &&
            gatewayReady &&
            (id === 'pi' || id === 'claude' || id === 'codex'),
          officeModel: officeModel(id),
          ...version
        };
      })
    ),
    accounts: await Promise.all(
      (await listAccounts())
        .filter((a) => agentsOn(platform).includes(a.agent))
        .map(async (a): Promise<AccountState> => ({
          id: a.id,
          agent: a.agent,
          label: a.label,
          signIn: await stateOf(a.agent, a.id)
        }))
    ),
    later: AGENTS.flatMap((id): LaterTool[] => {
      const why = notOfferedWhy(id, platform);
      return why ? [{ id, name: AGENT_NAMES[id], why }] : [];
    })
  });
};

/** Pick the tool the office runs on. It applies to the next office run and the next hire. */
export const PUT: RequestHandler = async ({ request }) => {
  const b = (await request.json().catch(() => ({}))) as { office?: unknown; magpieModel?: unknown };
  if (b.magpieModel !== undefined) {
    if (runsActive()) error(409, 'Wait for current runs to finish, then switch the office model.');
    if (
      b.magpieModel !== null &&
      (typeof b.magpieModel !== 'string' || !b.magpieModel.startsWith('magpie:'))
    )
      error(400, 'Pick a Magpie model');
    const model = b.magpieModel === null ? '' : (b.magpieModel as string).slice(7);
    if (b.magpieModel !== null && !model) error(400, 'Pick a Magpie model');
    const freshMagpie = !process.env.OFFICE_AGENT && !process.env.OFFICE_MAGPIE_MODEL && !!model;
    const chosen =
      b.office === undefined
        ? freshMagpie
          ? 'pi'
          : officeAgent()
        : offeredAgent(b.office, process.platform);
    if (!chosen) error(400, `Pick ${agentsOn(process.platform).join(' or ')}`);
    if (!model && chosen === 'pi')
      error(400, 'Pick another tool before turning off the office Magpie model.');
    if (model) {
      if (chosen !== 'pi' && chosen !== 'claude' && chosen !== 'codex')
        error(400, 'Pick Pi, Claude Code or Codex before using Magpie.');
      try {
        await magpieRunConnection(model);
      } catch (e) {
        error(400, e instanceof Error ? e.message : 'Magpie is unavailable.');
      }
    }
    writeEnv({
      OFFICE_MAGPIE_MODEL: model,
      ...(b.office !== undefined || freshMagpie ? { OFFICE_AGENT: chosen } : {})
    });
    process.env.OFFICE_MAGPIE_MODEL = model;
    if (b.office !== undefined || freshMagpie) process.env.OFFICE_AGENT = chosen;
    return json({ officeModel: model ? `magpie:${model}` : null });
  }
  if (runsActive()) error(409, 'Wait for current runs to finish, then switch the office tool.');
  const agent = offeredAgent(b.office, process.platform);
  if (!agent) error(400, `Pick ${agentsOn(process.platform).join(' or ')}`);
  if (process.env.OFFICE_MAGPIE_MODEL && agent !== 'pi' && agent !== 'claude' && agent !== 'codex')
    error(400, 'Turn off the office Magpie model before picking this tool.');
  writeEnv({ OFFICE_AGENT: agent });
  process.env.OFFICE_AGENT = agent;
  return json({ office: agent });
};
