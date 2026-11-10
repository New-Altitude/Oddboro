// Tools for an Odd's access: what it holds, finding tools, and asking for more.
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import {
  asksFor,
  catalog,
  checkFolder,
  folderAskRefused,
  FOLDER_REFUSED,
  shownFolder,
  switchAskRefused,
  switchesOff,
  GOOGLE,
  googleConnectors,
  grantsFor,
  reconnectTask,
  raiseAsk,
  staffer
} from './office.ts';
import { accessInRun, askAboveLevel, capabilities } from './capabilities.ts';
import { commandsOnline } from './agents.ts';
import { currentPlatform } from './platform.ts';
import {
  FOLDER_SAID,
  grantWorks,
  NOT_OWN_TOOLS,
  OWN_SWITCHES,
  SETTINGS_TAB,
  SWITCH_NAMES,
  switchesSaid
} from './access-words.ts';
import {
  BUILT_IN,
  ensureConnector,
  GITHUB_ADDRESS,
  GITHUB_ID,
  searchRegistry
} from './registry.ts';
import type { OwnSwitch as OwnSwitchName } from './access-words.ts';
import { ME, me, OWNER, has, VIA, revisesArg, tool, text, json, line, refused } from './mcp-run.ts';
import { raisedNote, placed } from './mcp-desk.ts';
import './mcp-mail.ts';

tool(
  'my_access',
  {
    description: `Your level, the tool your runs go through and what its own tools reach, the folders ${OWNER} gave you, and each outside tool ${OWNER} gave you: what it reaches, or why a run leaves it out for now.`,
    inputSchema: {}
  },
  async () => text(accessInRun(await capabilities(me), OWNER, process.env))
);

if (has('find_connectors'))
  tool(
    'find_connectors',
    {
      description: `Find MCP servers that would give you a tool you need: the office's own catalog first, then the public MCP Registry. Then call ask_for_access with the id or registry name. ${NOT_OWN_TOOLS}`,
      inputSchema: {
        need: z.string().describe('The service or job, e.g. "Trello cards" or "Notion pages".')
      }
    },
    async ({ need }) => {
      const words = need.toLowerCase().split(/\W+/).filter(Boolean);
      const added = await catalog();
      // The tools the office connects itself count as its own before anyone asks for one.
      const own = [
        ...added,
        ...BUILT_IN.filter((b) => !added.some((c) => c.id === b.id)).map((b) => ({
          ...b,
          readyAt: null
        }))
      ].filter((c) => words.some((w) => `${c.name} ${c.description}`.toLowerCase().includes(w)));
      let found: Awaited<ReturnType<typeof searchRegistry>> = [];
      let note = '';
      try {
        found = await searchRegistry(need);
      } catch (e) {
        note = `\nThe MCP Registry did not answer: ${e instanceof Error ? e.message : e}`;
      }
      return json({
        catalog: own.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          ready: !!c.readyAt
        })),
        registry: found.map((c) => ({
          registry: c.registry,
          description: c.description,
          repository: c.repository,
          runsAs: c.kind ?? null,
          needs: [...(c.config?.secrets ?? []), ...(c.config?.headers ?? [])],
          unsupported: c.unsupported
        })),
        note: note || undefined
      });
    }
  );

if (has('ask_for_access'))
  tool(
    'ask_for_access',
    {
      description: `Ask ${OWNER} to connect a tool for you. Pass a catalog id or registry name from find_connectors, or the https address of a hosted MCP server. Ask for the lowest level that does the job: read to look, write to change things in the tool (needs Draft or Act; at Draft each change waits for ${OWNER}'s yes). For a second Google account of Gmail or Google Drive, pass that connector with another_account. If they approve, they get numbered steps to connect it, and it shows up in my_access when done. ${NOT_OWN_TOOLS}${raisedNote}`,
      inputSchema: {
        connector: z.string(),
        level: z
          .enum(['read', 'write'])
          .describe('read to look, write to change things in the tool.'),
        why: z.string().describe('What job this access is for, in one or two sentences.'),
        key_header: z
          .string()
          .max(64)
          .optional()
          .describe(
            `Only for an https address that takes a key instead of a sign-in: the name of the header the key goes in, as the server's docs or ${OWNER} give it, e.g. x-api-key or Authorization. ${OWNER} pastes the key on their desk. Never ask for the key itself. Never for GitHub, which signs in (catalog id ${GITHUB_ID}).`
          ),
        another_account: z
          .boolean()
          .optional()
          .describe(
            `Only for Gmail or Google Drive, for each Google account beyond the first. When ${OWNER} uses more than one, ask for all of them in one run: the first without another_account, then one ask with it for each further account. ${OWNER} signs in to each as a tool of its own.`
          ),
        revises: revisesArg
      }
    },
    async ({ connector: wanted, level: asked, why, key_header, another_account, revises }) => {
      const on = await placed({});
      if ('problem' in on) return refused(on.problem);
      const level = asked === 'write' ? 'act' : 'read';
      if (!grantWorks(level, me.permission))
        return text(askAboveLevel(me.permission, asked, OWNER));
      // Any address on GitHub's server is the catalog's GitHub, which signs in:
      // an Odd's key header there would have the owner make a token.
      const github = GITHUB_ADDRESS.test(wanted.trim());
      const found = await ensureConnector(
        github ? GITHUB_ID : wanted,
        key_header && !github ? { keyHeader: key_header.trim() } : undefined
      );
      if (!found.connector) return text(`${found.problem} Use find_connectors.`);
      const conn = found.connector;
      const product = conn.config.google;
      if (another_account && !product)
        return refused(`another_account is only for Gmail and Google Drive.`);
      // Another account only beside a first one: connected, or on its way (this
      // Odd's open ask for it, or a grant still being connected). So an Odd that
      // needs two mailboxes can ask for both at once, on its first day.
      const firstOnItsWay = async (p: NonNullable<typeof product>) => {
        const ids = new Set((await googleConnectors(p)).map((c) => c.id));
        const asking = (await asksFor(ME)).some(
          (a) =>
            a.kind === 'access' &&
            a.status === 'open' &&
            !!a.access &&
            ids.has(a.access.connector) &&
            !a.access.another
        );
        return asking || (await grantsFor(ME)).some((g) => ids.has(g.connectorId));
      };
      const another =
        another_account &&
        product &&
        ((await googleConnectors(product)).some((c) => c.readyAt) || (await firstOnItsWay(product)))
          ? product
          : undefined;
      if (another_account && !another)
        return refused(
          `Ask for ${GOOGLE[product!].id} without another_account first. Then ask again with another_account for each further account, in the same run if you need them all.`
        );
      const plain = another ? GOOGLE[another].name : conn.name;
      const title = another
        ? `Connect another ${plain} account (${asked})`
        : `Connect ${conn.name} (${asked})`;
      const { ask, precedent } = await raiseAsk(ME, {
        ...on,
        title,
        why,
        ifApproved: another
          ? `You get numbered steps to sign in to another Google account for ${plain}, for ${me.name}.`
          : conn.readyAt
            ? `${me.name} can use ${conn.name} at once: you connected it already, so there are no steps.`
            : `You get numbered steps to connect ${conn.name} for ${me.name}.`,
        revises,
        access: { connector: conn.id, level, ...(another ? { another } : {}) }
      });
      return text(
        `Ask ${ask.id} is on ${OWNER}'s desk.` +
          (precedent.length
            ? `\n${OWNER}'s closest past decisions:\n${precedent.map(line).join('\n')}`
            : '')
      );
    }
  );

// A folder on this computer, outside the office: only the owner gives one,
// from this ask's card or the Settings tab. Checked here with the Settings
// tab's rules, so a folder they could not give never reaches the desk.
tool(
  'ask_for_folder',
  {
    description: `Ask ${OWNER} for a folder on this computer, outside the office, to read or to read and change. Ask with this instead of giving ${OWNER} steps for your ${SETTINGS_TAB} tab: they give it with one click, or a narrower one. Ask for the narrowest folder and the lowest level the work needs: read to look, write only to change files there. You reach it from your next run, which starts when they give it. my_access lists the folders you have.${raisedNote}`,
    inputSchema: {
      path: z
        .string()
        .trim()
        .min(1)
        .max(1000)
        .describe(
          'The folder\'s full path, starting with /, ~ or a drive letter, e.g. "~/Documents/Taxes".'
        ),
      level: z.enum(['read', 'write']).describe('read to look, write to change files there.'),
      why: z.string().max(1000).describe('What work needs it, in one or two plain sentences.'),
      revises: revisesArg
    }
  },
  async ({ path, level, why, revises }) => {
    const on = await placed({});
    if ('problem' in on) return refused(on.problem);
    if (!isAbsolute(path) && !/^~(?=$|[\\/])/.test(path))
      return refused("Give the folder's full path, starting with /, ~ or a drive letter.");
    const checked = checkFolder(path);
    if ('refused' in checked) return refused(checked.refused);
    if ('warning' in checked) return refused(FOLDER_REFUSED.broad);
    const held = folderAskRefused((await staffer(ME)) ?? me, checked.real, level);
    if (held) return refused(held);
    const shown = shownFolder(checked.real);
    const { ask } = await raiseAsk(ME, {
      ...on,
      kind: 'folder',
      title: `${level === 'write' ? 'Read and change' : 'Read'} ${shown}`,
      why,
      ifApproved: `The office gives ${me.name} ${shown} (${FOLDER_SAID[level]}), or the folder and level you pick, and ${me.name} picks up the work with it.`,
      folder: { path: checked.real, level },
      revises,
      via: VIA
    });
    return text(
      `Ask ${ask.id} is on ${OWNER}'s desk. When they give the folder, a new run of yours picks up the work with it. Check my_asks later for their decision.`
    );
  }
);

// Run commands or Browse the web: only the owner turns one on, from this ask's
// card or the Settings tab. Checked here as the Settings tab checks it, so a
// switch they could not turn on never reaches the desk.
tool(
  'ask_for_switch',
  {
    description: `Ask ${OWNER} to turn on ${SWITCH_NAMES.commands} (a shell, to run commands like git, npm or a script) or ${SWITCH_NAMES.web} (search and read web pages) for you, or both. Ask with this instead of giving ${OWNER} steps for your ${SETTINGS_TAB} tab: they turn it on with one click. Ask only for what the work needs; work that downloads, such as git clone or npm install, needs both. You have it from your next run, which starts when they say yes. my_access says which you have.${raisedNote}`,
    inputSchema: {
      switches: z
        .array(z.enum(OWN_SWITCHES as [OwnSwitchName, ...OwnSwitchName[]]))
        .min(1)
        .max(2)
        .describe(`commands for ${SWITCH_NAMES.commands}, web for ${SWITCH_NAMES.web}.`),
      why: z.string().max(1000).describe('What work needs it, in one or two plain sentences.'),
      revises: revisesArg
    }
  },
  async ({ switches, why, revises }) => {
    const on = await placed({});
    if ('problem' in on) return refused(on.problem);
    const now = (await staffer(ME)) ?? me;
    const held = switchAskRefused(now, switches);
    if (held) return refused(held);
    const off = switchesOff(now, switches);
    const online = commandsOnline(now.agent, currentPlatform(), {
      commands: now.commands || off.includes('commands'),
      web: now.web || off.includes('web')
    });
    const { ask } = await raiseAsk(ME, {
      ...on,
      kind: 'switch',
      title: `Turn on ${switchesSaid(off)}`,
      why,
      ifApproved: `The office turns on ${switchesSaid(off)} for ${me.name}, as the ${SETTINGS_TAB} tab does, and ${me.name} picks up the work with it.${online ? ` With both on, ${me.name}'s commands can reach the internet.` : ''}`,
      switches: off,
      revises,
      via: VIA
    });
    return text(
      `Ask ${ask.id} is on ${OWNER}'s desk. When they turn it on, a new run of yours picks up the work with it. Check my_asks later for their decision.`
    );
  }
);

tool(
  'reconnect_access',
  {
    description: `A tool ${OWNER} already gave you stopped working: its tools fail to load, or it turns down its key or sign-in. This puts the office's own steps to connect it again on ${OWNER}'s desk, with a box for the new key or a Sign in button, then a Connect button, and no ask, since they said yes once. Never write those steps yourself with give_owner_a_task. Pass get_key only when the tool takes a key: how to get a new one, one action per step, naming the exact page and button.`,
    inputSchema: {
      connector: z.string().describe('The id my_access lists.'),
      problem: z
        .string()
        .max(300)
        .describe('What went wrong and since when, in one or two sentences, with the error.'),
      get_key: z
        .array(z.string().max(200))
        .max(4)
        .optional()
        .describe(
          'How to get a new key, e.g. ["Open https://console.apify.com/settings/integrations.", "Copy your Personal API token. It starts with apify_api_."]'
        )
    }
  },
  async ({ connector: id, problem, get_key = [] }) => {
    const r = await reconnectTask(ME, id, problem, get_key);
    if ('problem' in r) return text(r.problem);
    if (r.already)
      return text(
        `Task ${r.task.id} to connect it is already on ${OWNER}'s desk. Point them to it.`
      );
    return text(
      `Task ${r.task.id} is on ${OWNER}'s desk. You hear when they finish it.${r.keptOut ? ` ${id} takes no key, so your get_key steps were left out. Never tell ${OWNER} to paste a key for it.` : ''}`
    );
  }
);
