// The office's own MCP server: how a staffer reaches the ledger, raises an
// ask, gives the owner a task and finds tools. The office app starts one per staff
// run with STAFF_ID set, so a staffer only ever acts as itself. It offers only
// the tools the owner granted that staffer (tools.ts), so the rest do not exist.
//
//   node packages/ledger/src/mcp.ts      (stdio; the office starts it)
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { McpServer, type ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  AlreadyOnDesk,
  ask,
  asksFor,
  cancelPoke,
  catalog,
  checkFolder,
  folderAskRefused,
  FOLDER_REFUSED,
  shownFolder,
  switchAskRefused,
  switchesOff,
  editOwnJob,
  giveTask,
  GOOGLE,
  googleConnectors,
  grantsFor,
  reconnectTask,
  jobsFor,
  officeActivity,
  ownerName,
  raiseAsk,
  schedulePoke,
  searchLedger,
  setDescription,
  staffer,
  type GoAhead,
  record,
  roster,
  waitingPokes,
  type LedgerRow
} from './office.ts';
import {
  allGoals,
  goal,
  goalDraft,
  goalsFor,
  logProgress,
  updateGoal,
  type GoalView
} from './goals.ts';
import { goalWhen, HEALTH_WORDS, HORIZONS, STATUS_WORDS } from './goal-words.ts';
import {
  accessInRun,
  askAboveLevel,
  capabilities,
  folderLines,
  handsOff,
  officeHeldIn,
  outsideLines,
  ownToolsSaid
} from './capabilities.ts';
import { AGENT_NAMES, commandsOnline } from './agents.ts';
import {
  FOLDER_SAID,
  grantWorks,
  levelAtMost,
  LEVELS,
  NOT_OWN_TOOLS,
  OWN_SWITCHES,
  SETTINGS_TAB,
  SWITCH_NAMES,
  switchesSaid
} from './access-words.ts';
import { handOff } from './hand-offs.ts';
import {
  APPLIES_TO_MAX,
  CITE_FIRST,
  keepLesson,
  QUOTE_MIN_WORDS,
  usedLesson,
  WHY_REPLACED,
  type OwnerWords
} from './lessons.ts';
import {
  HAND_OFF_LIMIT,
  handOffsWord,
  notLed,
  parkThread,
  recentThreads,
  tellLead,
  threadsOn,
  workFile
} from './threads.ts';
import { THREADS_DIR, workName, workPath } from './work-paths.ts';
import { withFooter } from './mail-footer.ts';
import {
  doesSomething,
  filterWords,
  matchesSomething,
  type FilterAction,
  type FilterCriteria
} from './filter-words.ts';
import { goalWork, goalWorkRefused } from './goal-work.ts';
import { FOLDER, heldTools, lacking, toolNames, WEB, type Tool } from './sharing.ts';
import {
  BUILT_IN,
  ensureConnector,
  GITHUB_ADDRESS,
  GITHUB_ID,
  searchRegistry
} from './registry.ts';
import type { GoalPlanItem, HireProposal } from './schema.ts';
import type { OwnSwitch as OwnSwitchName } from './access-words.ts';
import {
  clockTime,
  describe as describeSchedule,
  officeAt,
  officeDay,
  WEEKDAYS,
  zone,
  zoneName
} from './time.ts';
import { hasTool, isGrantable } from './tools.ts';
import { home } from './home.ts';

const ME = process.env.STAFF_ID ?? '';
const me = await staffer(ME);
if (!me) throw new Error(`STAFF_ID "${ME}" names no Odd in this office`);
/** What this office's staff call the owner. */
const OWNER = await ownerName();
/** The office's time zone in words, like "Pacific Time". */
const ZONE = zoneName();
const has = (tool: string) => hasTool(me.tools, tool);
/** This staffer's own folder. Files it names are relative to it. */
const HOME = home('staff', ME);

/**
 * The owner's message, when this run is a chat with them. The office sets it, not
 * the staffer, so a change made "because the owner asked" carries their real words.
 */
const OWNER_SAID = process.env.OWNER_SAID || undefined;
/**
 * The owner's note a follow-up carries out: their reason on an ask, what to
 * change, or their note on a task. Lessons may quote it; it is no go-ahead.
 */
const OWNER_NOTE = process.env.OWNER_NOTE || undefined;
/**
 * The owner's version of a file they edited, when this run reads that edit.
 * Lessons may quote it, as guesses only (`keptAs`); it is no go-ahead.
 */
const OWNER_EDIT = process.env.OWNER_EDIT || undefined;
/** The owner's words this run carries for a lesson. A run carries one of the three at most. */
const OWNER_WORDS: OwnerWords | undefined = OWNER_EDIT
  ? { text: OWNER_EDIT, from: 'edit' }
  : OWNER_SAID
    ? { text: OWNER_SAID, from: 'chat' }
    : OWNER_NOTE
      ? { text: OWNER_NOTE, from: 'note' }
      : undefined;
/** The ask the owner approved that this run carries out, set by the office. No other ask counts. */
const APPROVED_ASK = Number(process.env.APPROVED_ASK) || undefined;
/**
 * Set by the office for a colleague's run on a hand-off: asks and tasks it
 * raises carry it, so the owner's answer goes back, and it cannot hand off.
 */
const HAND_OFF_ID = Number(process.env.HAND_OFF_ID) || undefined;
/**
 * The thread this run works on, either side, set by the office. Asks and tasks
 * it raises carry it. The hub's runs hand off into it and may park it.
 */
const THREAD_ID = Number(process.env.THREAD_ID) || undefined;
/** Set by the office for every run: a thread it puts work on keeps it (`keepRun`, `runsGoing`). */
const RUN_KEY = process.env.RUN_KEY || undefined;
/**
 * Set by the office for a run that only reads the owner's reason or edit for a
 * lesson (`servesNoThread`): it hands nothing on, so it gets no hand_off.
 */
const LESSON_RUN = process.env.LESSON_RUN === '1';
/**
 * Set by the office when a lead's run picks up a colleague's handed-back
 * result: the colleague's id. What the run puts on the desk names them, so
 * the owner sees whose work it came from.
 */
const VIA = process.env.VIA || undefined;
/** What an ask or task raised in this run is part of. */
const RAISED_ON = { handOffId: HAND_OFF_ID, threadId: THREAD_ID };
/** Whether this run gets hand_off, and whether it is told the threads it leads. */
const HANDS_OFF = handsOff(me.tools, {
  thread: THREAD_ID !== undefined,
  handOff: HAND_OFF_ID !== undefined,
  lesson: LESSON_RUN
});

const approvedArg = z
  .number()
  .int()
  .optional()
  .describe(
    `Outside a chat with ${OWNER}: the id of the ask they approved, while you carry it out.`
  );

/** The owner's go-ahead for a change to this staffer, or why there is none. */
async function goAhead(askId?: number): Promise<GoAhead | { problem: string }> {
  if (OWNER_SAID) return { said: OWNER_SAID };
  if (askId) {
    const a = await ask(askId);
    if (a?.staffId !== ME || a.status !== 'approved')
      return { problem: `Ask #${askId} is not an ask of yours that ${OWNER} approved.` };
    // Each yes covers the run that carries it out, and no later one.
    if (askId !== APPROVED_ASK)
      return { problem: `Ask #${askId} is not the approved ask this run is carrying out.` };
    return { askId };
  }
  return {
    problem: `Only when ${OWNER} asks for it in chat, or with the id of an ask they approved. To propose it, raise_ask with the exact change first.`
  };
}

/** An optional link from a new ask to the one the owner sent back. */
const revisesArg = z
  .number()
  .int()
  .optional()
  .describe(`When ${OWNER} sent an ask back to rework, its id. Leave out otherwise.`);

const attachArg = z
  .array(z.string())
  .max(5)
  .optional()
  .describe(
    `Files that go with it: one in your folder, e.g. ['notes/intake.md'], or one in the folder of a goal or work you are on, by its path from ${THREADS_DIR}/, e.g. ['${workName(12, 'paige/index.html')}']. Attach the file itself, never a copy. ${OWNER} sees them on their desk and edits a Markdown one from your folder right there, so do not tell them where to find it.`
  );

/**
 * The attachments as names the owner's viewer opens (`workPath` for a file in
 * a thread's folder, else a path inside this staffer's folder), or why one is
 * not. Never a full path, and never a file reached through a link out.
 */
async function attachable(
  paths: string[] = []
): Promise<{ paths: string[] } | { problem: string }> {
  const out: string[] = [];
  for (const p of paths) {
    const name = isAbsolute(p)
      ? undefined
      : workPath(p)
        ? (await workFile(ME, p)) && p
        : ownFile(p);
    if (!name)
      return {
        problem: `No file at ${p} that you can attach. Name a file in your folder by its path inside it, e.g. notes/intake.md, or one in the folder of a goal or work you are on from ${THREADS_DIR}/, e.g. ${workName(12, 'paige/index.html')}, never by its full path. Write it first if it is not there.`
      };
    out.push(name);
  }
  return { paths: [...new Set(out)] };
}

const atArg = z.string().regex(/^\d\d:\d\d$/);
const scheduleArg = z.discriminatedUnion('every', [
  z.object({ every: z.literal('minutes'), n: z.number().int().min(15) }),
  z.object({ every: z.literal('day'), at: atArg }),
  z.object({ every: z.literal('weekday'), at: atArg }),
  z
    .object({ every: z.literal('week'), day: z.enum(WEEKDAYS), at: atArg })
    .describe('Once a week, e.g. { every: "week", day: "Fri", at: "16:00" }.')
]);

/**
 * A file in this staffer's folder, as the path inside it to its real path, or
 * undefined when there is none. A link out of the folder is not in it.
 */
function ownFile(path: string): string | undefined {
  try {
    const root = realpathSync(HOME);
    const file = realpathSync(resolve(root, path));
    return file.startsWith(root + sep) && statSync(file).isFile()
      ? relative(root, file)
      : undefined;
  } catch {
    // Nothing at that path.
    return undefined;
  }
}

/** What propose_hire and propose_goal_plan both take to describe one hire. */
const hireFields = {
  name: z.string().max(40).describe('A first name for the Odd.'),
  role: z.string().max(60),
  remit: z.string().max(200).describe('One line for the card: what it is for.'),
  job_description_file: z
    .string()
    .describe('The job description, a file in your folder, e.g. notes/jd-mail-clerk.md.'),
  permission: z
    .enum(LEVELS)
    .describe('read reads and reports, draft prepares drafts for their yes, act acts alone.'),
  room: z
    .string()
    .optional()
    .describe('Where it works: workspace, workspace-east, mail-room, library or lobby.'),
  office_tools: z
    .array(z.string())
    .optional()
    .describe(
      'Office tools beyond the ones every Odd has: search_ledger, give_owner_a_task, find_connectors, ask_for_access, edit_my_job, edit_my_description, hand_off, poke_owner, propose_hire, office_report. Leave out for the usual starters.'
    ),
  appearance: z
    .string()
    .max(600)
    .optional()
    .describe(
      'What the person looks like, in a sentence or two: hair, build of clothes, colours, glasses or a beard. The office draws them from it.'
    ),
  first_job: z
    .object({
      name: z.string(),
      instructions: z.string(),
      schedule: scheduleArg,
      report: z
        .boolean()
        .optional()
        .describe(
          `Put each result on ${OWNER}'s desk as a report. True when the job makes something for them to read.`
        )
    })
    .optional(),
  intake_file: z
    .string()
    .optional()
    .describe(
      `An intake ${OWNER} filled in for this hire, a file in your folder. The new Odd gets a copy as notes/intake.md and reads their answers first-hand.`
    )
};
const hireShape = z.object(hireFields);
type HireArgs = z.infer<typeof hireShape>;

/** One hire as a proposal, or why the files it names are not there. */
function hireFrom(a: HireArgs): HireProposal | string {
  const jd = ownFile(a.job_description_file);
  if (!jd) return `No file at ${a.job_description_file} in your folder. Write it first.`;
  const intake = a.intake_file ? ownFile(a.intake_file) : undefined;
  if (a.intake_file && !intake) return `No file at ${a.intake_file} in your folder.`;
  return {
    name: a.name,
    role: a.role,
    remit: a.remit,
    room: a.room,
    permission: a.permission,
    jobDescriptionFile: jd,
    tools: a.office_tools?.filter(isGrantable),
    appearance: a.appearance,
    job: a.first_job,
    intakeFile: intake
  };
}

/** A goal for a staffer to read: what it is, why, what done looks like, and how it is going. */
function goalText(g: GoalView & { part?: string }, others = true): string {
  const head = `## Goal #${g.id}: ${g.title}\n${STATUS_WORDS[g.status]}, ${goalWhen(g)}, ${g.area}`;
  return [
    head,
    g.why && `Why it matters: ${g.why}`,
    g.doneWhen && `Done when: ${g.doneWhen}`,
    g.part && `Your part: ${g.part}`,
    others &&
      (g.staff.length
        ? `Served by: ${g.staff.map((s) => `${s.name} (${s.part})`).join('; ')}`
        : 'Nobody serves it yet.'),
    g.progress.length
      ? `Progress, newest first:\n${g.progress.map((p) => `- ${day(p.createdAt)} ${p.name}: ${HEALTH_WORDS[p.health]}. ${p.note}`).join('\n')}`
      : 'No progress logged yet.'
  ]
    .filter(Boolean)
    .join('\n');
}

const goalFields = {
  title: z
    .string()
    .max(140)
    .describe('The goal in their words, one line: "Answer every client email within a day".'),
  why: z.string().max(1000).optional().describe('Why it matters to them.'),
  done_when: z
    .string()
    .max(1000)
    .optional()
    .describe(
      'What done looks like, measurable when it can be: "a reply to every client email within a day, for a month".'
    ),
  horizon: z.enum(HORIZONS.map((h) => h.id) as [string, ...string[]]),
  due: z.string().optional().describe('YYYY-MM-DD, when horizon is "date".'),
  area: z
    .string()
    .max(40)
    .describe('work, family, health, money, learning or fun, or another word.')
};

const server = new McpServer({ name: 'office', version: '1.0.0' });
/**
 * Registers an office tool that refuses any argument its input does not name.
 * The SDK builds a plain object from a raw shape, which drops an unknown key
 * and runs the tool as if it were left out: an Odd whose chat still uses a
 * renamed parameter would start new work when it meant to continue old work.
 * The refusal lists the keys the tool takes instead of echoing the unknown
 * one, since an old name may say a word the Odd never reads.
 */
function tool<Shape extends z.ZodRawShape>(
  name: string,
  { description, inputSchema }: { description: string; inputSchema: Shape },
  run: ToolCallback<Shape>
) {
  const keys = Object.keys(inputSchema);
  const takes = keys.length ? `takes only ${keys.join(', ')}` : 'takes no arguments';
  const strict = z.strictObject(inputSchema, {
    error: (issue) =>
      issue.code === 'unrecognized_keys'
        ? `${name} ${takes}. Nothing was done. Call it again with those.`
        : undefined
  });
  // `run` is typed by the raw shape, as the SDK types one: the strict object
  // parses to the same arguments, and reads a shape spread from a union
  // (raisedArgs) as unknown fields. Named here because inference picks the raw
  // shape; the first is the output schema, which no office tool has.
  // The ledger refuses a repeat on the owner's desk (`AlreadyOnDesk`): the
  // Odd reads why as a tool error, never as a crash.
  const guarded = (async (...args: unknown[]) => {
    try {
      return await (run as (...a: unknown[]) => unknown)(...args);
    } catch (e) {
      if (e instanceof AlreadyOnDesk) return refused(e.message);
      throw e;
    }
  }) as ToolCallback<Shape>;
  server.registerTool<z.ZodRawShape, typeof strict>(
    name,
    { description, inputSchema: strict },
    guarded
  );
}
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
/**
 * A hand_off that handed nothing on: refused, or held for the owner's answer.
 * An error, so the Odd cannot read it as the work being handed over.
 */
const notHanded = (why: string) => ({
  ...text(`Nothing was handed off yet. ${why}`),
  isError: true
});
const json = (v: unknown) => text(JSON.stringify(v, null, 2));
const day = (d: Date | string) => officeDay(new Date(d));
/** "Oct 30", in the office's time zone. */
const shortDay = (d: Date) =>
  d.toLocaleDateString('en-US', { timeZone: zone(), month: 'short', day: 'numeric' });
const line = (r: LedgerRow) =>
  `- ${day(r.createdAt)} [${r.kind}] ${r.actor}: ${r.title}${r.reason ? ` (reason: ${r.reason})` : r.kind === 'decision' ? ' (no reason given)' : ''}`;

if (has('search_ledger'))
  tool(
    'search_ledger',
    {
      description: `Search the office ledger: every decision ${OWNER} made, all work done by Odds or by ${OWNER}, and reports. Search by meaning. Check it before raising an ask, so you know how ${OWNER} decided similar things.`,
      inputSchema: {
        query: z
          .string()
          .describe('What you are looking for, in plain words. Empty for the newest rows.'),
        kind: z.enum(['decision', 'work', 'report', 'hire', 'access']).optional(),
        who: z.string().optional().describe('An Odd\'s id, or "owner".'),
        limit: z.number().int().min(1).max(50).optional()
      }
    },
    async ({ query, kind, who, limit }) => {
      const rows = await searchLedger(query, { kind, actor: who, limit });
      return text(
        rows.length
          ? rows.map((r) => `${line(r)}\n  ${r.body.slice(0, 400)}`).join('\n')
          : 'Nothing found.'
      );
    }
  );

// In a chat, the threads this Odd works on and does not lead (`threadsOn`):
// what the owner asks there about one goes to its lead with tell_lead.
const said = OWNER_SAID;
const workingOn = said && has('tell_lead') ? await threadsOn(ME) : [];
const goalRule = await goalWork(ME, workingOn);
// A hub in a run on no thread, such as a chat or a job, names the thread an ask
// or task is for, or null, so what it raises about a thread lands there.
const leading = HANDS_OFF.leads ? await recentThreads(ME) : [];
/** The arguments raise_ask and give_owner_a_task take for where what they raise goes. */
const raisedArgs = {
  ...(leading.length
    ? {
        work: z
          .number()
          .int()
          .nullable()
          .describe(
            `The number of work you lead, as your instructions number it, when this is for it: it goes on that work, and ${OWNER}'s answer brings you back there. null when it is for none of them.`
          )
      }
    : {})
};
/** What each tool `placed` checks for an ask or task adds to its description, in a chat that offers tell_lead. */
const raisedNote = !workingOn.length
  ? ''
  : goalRule
    ? ` Not in this chat: you have no job of your own, so what ${OWNER} asks of you here is a goal's work, which goes to ${goalRule.leads.join(' or ')} with tell_lead.`
    : ` Never for work another Odd leads that you are on: pass ${OWNER}'s words to its lead with tell_lead.`;
/** A tool call that put nothing on the desk. An error, so the Odd cannot read it as done. */
const refused = (why: string) => ({
  ...text(`Nothing went on ${OWNER}'s desk. ${why}`),
  isError: true
});
/**
 * Where an ask or task this run raises goes, from its arguments, or why it may
 * not go at all, so a goal's work goes to its lead. raise_ask,
 * give_owner_a_task, ask_for_access and propose_hire check it, and hand_off
 * when it would open a thread. Three tools that reach the desk do not, since
 * none can carry a goal's work off its thread: reconnect_access restores a
 * tool the owner already gave this Odd, which all its work needs; propose_goal
 * offers a new goal, which nobody leads yet; and propose_goal_plan always goes
 * on its goal's one thread (`raiseAsk`).
 */
async function placed(a: {
  work?: number | null;
}): Promise<{ problem: string } | { handOffId?: number; threadId?: number; run?: string }> {
  // A thread it leads is its own work, never a colleague's goal work.
  if (a.work !== undefined && a.work !== null) {
    const problem = await notLed({ hubId: ME, threadId: a.work, owner: OWNER });
    // Only a lead's run naming its thread keeps its key there: a colleague's run
    // on a thread must never hold the lead's pick-ups (`waitsOnOwnRun`).
    return problem ? { problem } : { threadId: a.work, run: RUN_KEY };
  }
  if (goalRule) return { problem: goalWorkRefused(goalRule, OWNER) };
  return RAISED_ON;
}

tool(
  'raise_ask',
  {
    description: `Ask ${OWNER} to approve something. It lands on their desk and they approve, deny, or send it back with what to change, maybe with a reason. Use it for anything that needs their yes. One decision per ask, worded as the exact action: if they approve, you carry it out at once in a new run, with only the ask to go on. The reply lists their closest past decisions: if one matches and gave no reason, tell ${OWNER} that a reason would let Odds handle these without asking next time. For an outside tool, use ask_for_access; for a folder on this computer, ask_for_folder; for ${SWITCH_NAMES.commands} or ${SWITCH_NAMES.web}, see my_access; and for a new Odd, use propose_hire.${raisedNote}`,
    inputSchema: {
      title: z
        .string()
        .max(140)
        .describe(
          'What you want, as one short line: "Unsubscribe you from the airline sale emails".'
        ),
      why: z.string().describe('Why, in one to three plain sentences.'),
      if_approved: z.string().describe('What happens next if they say yes.'),
      attach: attachArg,
      revises: revisesArg,
      ...raisedArgs
    }
  },
  async ({ title, why, if_approved, attach, revises, ...where }) => {
    const on = await placed(where);
    if ('problem' in on) return refused(on.problem);
    const files = await attachable(attach);
    if ('problem' in files) return text(files.problem);
    const { ask, precedent } = await raiseAsk(ME, {
      ...on,
      title,
      why,
      ifApproved: if_approved,
      revises,
      via: VIA,
      attach: files.paths
    });
    return text(
      `Ask ${ask.id} is on ${OWNER}'s desk. Check my_asks later for their decision.\n` +
        (precedent.length
          ? `\n${OWNER}'s closest past decisions:\n${precedent.map(line).join('\n')}`
          : `\n${OWNER} has decided nothing like this before.`)
    );
  }
);

tool(
  'my_asks',
  {
    description: `Your asks and how ${OWNER} decided each, with their reason when they gave one.`,
    inputSchema: {}
  },
  async () => {
    const rows = await asksFor(ME);
    if (!rows.length) return text('You have raised no asks.');
    return text(
      rows
        .map(
          (a) =>
            `- #${a.id} ${a.status === 'revise' ? 'SENT BACK' : a.status.toUpperCase()}: ${a.title}${a.reason ? ` (${a.status === 'revise' ? 'change' : 'reason'}: ${a.reason})` : a.status === 'open' ? '' : ' (no reason given)'}`
        )
        .join('\n')
    );
  }
);

if (has('give_owner_a_task'))
  tool(
    'give_owner_a_task',
    {
      description: `Give ${OWNER}, the human operator, a task: something only they can do. Steps are numbered and each is one action, written so anyone can follow them without guessing: name the button, the place, the exact thing. When a step opens a page, give its full address (https://mail.google.com/...), which the owner clicks; when they type or paste something, put exactly that in \`backticks\`, which the owner copies with one click (In the From box, type \`dmarc@example.com\`). If they must choose, pass choices and the task ends with them, e.g. for 'Should this kind of email reach you?' pass ['Yes, keep sending these', 'No, filter these out']. When they must fill in or read a file, write it in your folder and attach it: a step says 'Answer each question in intake.md below', never where the file lives. Never write steps to connect or reconnect a tool: ask_for_access and reconnect_access give the office's own.${raisedNote}`,
      inputSchema: {
        title: z.string().max(140),
        why: z.string().describe('One or two sentences on why this is theirs to do.'),
        steps: z
          .array(z.string())
          .min(1)
          .max(12)
          .describe(
            'One action per step. No "and then". A page to open as its full address; anything to type or paste in `backticks`.'
          ),
        choices: z.array(z.string()).min(2).max(4).optional(),
        attach: attachArg,
        ...raisedArgs
      }
    },
    async ({ title, why, steps, choices, attach, ...where }) => {
      const on = await placed(where);
      if ('problem' in on) return refused(on.problem);
      const files = await attachable(attach);
      if ('problem' in files) return text(files.problem);
      const all = [
        ...steps.map((s) => ({ text: s, done: false })),
        ...(choices
          ? [
              {
                text: 'Choose one.',
                done: false,
                action: { kind: 'choice' as const, options: choices }
              }
            ]
          : [])
      ];
      const t = await giveTask(ME, {
        title,
        why,
        steps: all,
        attach: files.paths,
        via: VIA,
        ...on
      });
      return text(`Task ${t.id} is on ${OWNER}'s desk. The ledger records it when they finish it.`);
    }
  );

// An email reply waits on the owner's desk, one per ask: they edit it, then the
// office sends it or saves it to Gmail drafts. Only for an Odd that holds
// Gmail at any level, since it answers mail the Odd read there.
const gmailId = z.string().regex(/^[\w-]+$/, 'A Gmail id holds only letters, digits, _ and -.');
const address = z
  .string()
  .min(3)
  .max(320)
  .regex(/^[^\r\n,;]+$/, 'One address each, on one line.');
// Each Gmail account is a connector of its own. With more than one, the Odd
// names the one the email came to, and the reply goes out from it.
const mailboxes = (await grantsFor(ME))
  .filter((g) => g.connector.config.google === 'gmail')
  .map((g) => ({ id: g.connectorId, account: g.connector.config.account }));
const mailboxIds = mailboxes.map((m) => m.id) as [string, ...string[]];
const mailboxArg = mailboxes.length
  ? (() => {
      const listed = mailboxes
        .map((m) => `${m.id}${m.account ? ` (${m.account})` : ''}`)
        .join(', ');
      const arg = z.enum(mailboxIds);
      return mailboxes.length > 1
        ? arg.describe(
            `The Gmail account the email came to, by id: ${listed}. Required, since you hold more than one.`
          )
        : arg
            .optional()
            .describe(`The Gmail account, by id: ${listed}. Leave out for your only one.`);
    })()
  : z.never().optional();
/** The Gmail account a reply or filter goes through: the one named, or the Odd's only one. */
function mailbox(
  named: string | undefined
): { connector: string; account?: string } | { problem: string } {
  const m = named ? mailboxes.find((x) => x.id === named) : mailboxes[0];
  if (!m) return { problem: `You do not hold a Gmail account called ${named}.` };
  if (!named && mailboxes.length > 1)
    return {
      problem: `You hold more than one Gmail account. Pass account: one of ${mailboxIds.join(', ')}.`
    };
  return { connector: m.id, account: m.account };
}

if (has('propose_reply') && mailboxes.length)
  tool(
    'propose_reply',
    {
      description: `Put one email reply on ${OWNER}'s desk, ready to send. One reply per call: for three emails, call it three times. ${OWNER} reads your summary and the email it answers, may edit the recipients, subject and body, then sends it or saves it to Gmail drafts. Nothing is sent until ${OWNER} sends it. Never put reply drafts in a file for ${OWNER}, and never leave brackets for them to fill in: write the whole reply, and if a fact only they know is missing, say so in why. The office ends the body with a line "Sent from Oddboro", which ${OWNER} may delete: never write it yourself. To rework one ${OWNER} sent back, pass its id as revises.${raisedNote}`,
      inputSchema: {
        gmail_thread_id: gmailId
          .optional()
          .describe('The Gmail thread it answers, from search_threads. Leave out for a new email.'),
        in_reply_to: gmailId
          .optional()
          .describe(
            "The Gmail message id it answers. Leave out to answer the thread's latest message."
          ),
        to: z.array(address).min(1).max(20).describe('Each address, e.g. "Ada <ada@example.com>".'),
        cc: z.array(address).max(20).optional(),
        subject: z.string().min(1).max(200),
        body: z.string().min(1).max(20_000).describe('The reply as plain text, ready to send.'),
        summary: z
          .string()
          .max(400)
          .describe('One or two lines on the email it answers: who wrote and what they want.'),
        why: z.string().max(1000).describe('Why this reply, in one or two plain sentences.'),
        account: mailboxArg,
        revises: revisesArg,
        ...raisedArgs
      }
    },
    async ({
      account,
      gmail_thread_id,
      in_reply_to,
      to,
      cc = [],
      subject,
      body,
      summary,
      why,
      revises,
      ...where
    }) => {
      const box = mailbox(account);
      if ('problem' in box) return refused(box.problem);
      const on = await placed(where);
      if ('problem' in on) return refused(on.problem);
      const more = to.length > 1 ? ` and ${to.length - 1} more` : '';
      const { ask } = await raiseAsk(ME, {
        ...on,
        kind: 'reply',
        title: `${gmail_thread_id ? 'Reply' : 'Email'} to ${to[0]}${more}: ${subject}`.slice(
          0,
          140
        ),
        why,
        ifApproved: `You send it, or save it to Gmail drafts, with any changes you make. Nothing goes before you click.`,
        reply: {
          gmailThreadId: gmail_thread_id,
          inReplyTo: in_reply_to,
          to,
          cc,
          subject,
          // The footer goes in now, where the owner sees it and may delete it.
          body: withFooter(body),
          summary,
          ...box
        },
        revises,
        via: VIA
      });
      return text(
        `Reply ${ask.id} is on ${OWNER}'s desk. Nothing is sent until they send it. Check my_asks later for what they did.`
      );
    }
  );

// A Gmail filter waits on the owner's desk, one per ask: they may change it,
// then the office creates it in Gmail. Only for an Odd that holds Gmail at any
// level, since it files mail the Odd read there.
const filterText = z.string().trim().max(500).optional();
if (has('propose_filter') && mailboxes.length)
  tool(
    'propose_filter',
    {
      description: `Put one Gmail filter on ${OWNER}'s desk, ready to create. One filter per call: for three kinds of mail, call it three times. Call list_filters first, so you never propose a filter ${OWNER} already has. Say plainly in summary what mail it matches and what it does to it. ${OWNER} sees how many emails it matches today, may change it, then creates it, and may tidy the mail it already matches the same way. Nothing changes in Gmail until ${OWNER} clicks Create filter. A filter only files mail: it skips the inbox, marks read, adds a label or stars, never deletes or forwards. Never put filter settings in a task or steps for ${OWNER} to copy. To rework one ${OWNER} sent back, pass its id as revises.${raisedNote}`,
      inputSchema: {
        from: filterText.describe('Mail from this sender, e.g. "news@shop.example.com".'),
        to: filterText.describe('Mail to this address.'),
        subject: filterText.describe('Words in the subject.'),
        query: filterText.describe(
          'Gmail search words the mail has, as typed in Gmail, e.g. "unsubscribe".'
        ),
        negated_query: filterText.describe('Gmail search words the mail does not have.'),
        has_attachment: z.boolean().optional(),
        skip_inbox: z.boolean().optional().describe('Archive it: it skips the inbox.'),
        mark_read: z.boolean().optional(),
        add_label: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .describe(
            "A label's name. The office makes it when the filter is created, if it is missing."
          ),
        star: z.boolean().optional(),
        summary: z
          .string()
          .min(1)
          .max(400)
          .describe('One or two plain lines: what mail it matches and what it does to it.'),
        why: z.string().max(1000).describe('Why this filter, in one or two plain sentences.'),
        account: mailboxArg,
        revises: revisesArg,
        ...raisedArgs
      }
    },
    async ({
      account,
      from,
      to,
      subject,
      query,
      negated_query,
      has_attachment,
      skip_inbox,
      mark_read,
      add_label,
      star,
      summary,
      why,
      revises,
      ...where
    }) => {
      const criteria: FilterCriteria = {
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(subject ? { subject } : {}),
        ...(query ? { query } : {}),
        ...(negated_query ? { negatedQuery: negated_query } : {}),
        ...(has_attachment ? { hasAttachment: true } : {})
      };
      const action: FilterAction = {
        ...(skip_inbox ? { skipInbox: true } : {}),
        ...(mark_read ? { markRead: true } : {}),
        ...(add_label ? { addLabel: add_label } : {}),
        ...(star ? { star: true } : {})
      };
      if (!matchesSomething(criteria))
        return refused('Say which mail it matches: from, to, subject, query or has_attachment.');
      if (!doesSomething(action))
        return refused('Say what it does: skip_inbox, mark_read, add_label or star.');
      const box = mailbox(account);
      if ('problem' in box) return refused(box.problem);
      const on = await placed(where);
      if ('problem' in on) return refused(on.problem);
      const { ask } = await raiseAsk(ME, {
        ...on,
        kind: 'filter',
        title: `Gmail filter: ${filterWords({ criteria, action })}`.slice(0, 140),
        why,
        ifApproved: `The office creates it in your Gmail, with any changes you make, and tidies the mail it already matches if you tick that. Nothing changes before you click.`,
        filter: { criteria, action, summary, ...box },
        revises,
        via: VIA
      });
      return text(
        `Filter ${ask.id} is on ${OWNER}'s desk. Nothing changes in Gmail until they create it. Check my_asks later for what they did.`
      );
    }
  );

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
    const online = commandsOnline(now.agent, process.platform, {
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
    description: `A tool ${OWNER} already gave you stopped working: its tools fail to load, or it turns down its key or sign-in. This puts the office's own steps to connect it again on ${OWNER}'s desk, with a box for the new key and a Connect button, and no ask, since they said yes once. Never write those steps yourself with give_owner_a_task. Pass get_key only when the tool takes a key: how to get a new one, one action per step, naming the exact page and button.`,
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
    return text(
      r.already
        ? `Task ${r.task.id} to connect it is already on ${OWNER}'s desk. Point them to it.`
        : `Task ${r.task.id} is on ${OWNER}'s desk. You hear when they finish it.`
    );
  }
);

tool(
  'my_jobs',
  {
    description: `Your own jobs: name, schedule in ${ZONE}, and the steps each run follows.`,
    inputSchema: {}
  },
  async () => {
    const rows = await jobsFor(ME);
    if (!rows.length) return text('You have no jobs.');
    return text(
      rows
        .map(
          (j) =>
            `## ${j.name}\n${describeSchedule(j.schedule)}${j.enabled ? '' : ', paused'}${j.report ? `, reports to ${OWNER}` : ''}\n\n${j.instructions}`
        )
        .join('\n\n')
    );
  }
);

tool(
  'my_goals',
  {
    description: `The goals ${OWNER} set that you serve: why each matters, what done looks like, your part, and how it is going. Work toward them. You see only these.`,
    inputSchema: {}
  },
  async () => {
    const rows = (await goalsFor(ME)).filter((g) => g.status === 'active' || g.status === 'paused');
    return text(
      rows.length ? rows.map((g) => goalText(g)).join('\n\n') : 'You serve no goals yet.'
    );
  }
);

tool(
  'log_progress',
  {
    description: `Say how a goal you serve is going, once per run that moves it or shows it slipping. One line of evidence, with a number when there is one: "inbox at 14 on Friday, down from 40; a deadline pushed Tuesday's sort to Wednesday". ${OWNER}'s daily report reads these.`,
    inputSchema: {
      goal_id: z.number().int(),
      health: z
        .enum(['on_track', 'slipping', 'blocked'])
        .describe('blocked means it cannot move without something from someone.'),
      note: z.string().min(1).max(300)
    }
  },
  async ({ goal_id, health, note }) => {
    const r = await logProgress(ME, goal_id, health, note);
    return text(typeof r === 'string' ? r : `Logged on goal #${goal_id}.`);
  }
);

if (has('list_goals'))
  tool(
    'list_goals',
    {
      description: `Every goal ${OWNER} set, active first: why, done when, who serves each and their part, and the latest progress.`,
      inputSchema: {}
    },
    async () => {
      const rows = await allGoals();
      return text(rows.length ? rows.map((g) => goalText(g)).join('\n\n') : 'No goals yet.');
    }
  );

if (has('propose_goal'))
  tool(
    'propose_goal',
    {
      description: `Offer ${OWNER} a goal you heard from them, for their yes. It lands on their desk; approving sets it, and then you plan it. One goal per ask, in their words. Never treat a goal as set before they approve it.`,
      inputSchema: {
        ...goalFields,
        heard: z.string().max(600).describe(`What ${OWNER} said that this comes from.`),
        revises: revisesArg
      }
    },
    async (a) => {
      const d = goalDraft({
        title: a.title,
        why: a.why,
        doneWhen: a.done_when,
        horizon: a.horizon,
        due: a.due,
        area: a.area
      });
      if (typeof d === 'string') return text(d);
      const { ask } = await raiseAsk(ME, {
        ...RAISED_ON,
        kind: 'goal',
        title: `Set a goal: ${d.title}`,
        why: a.heard,
        ifApproved: 'The goal is set. I plan who does what and bring you the plan.',
        goal: d,
        revises: a.revises
      });
      return text(`Ask ${ask.id} is on ${OWNER}'s desk.`);
    }
  );

if (has('propose_goal_plan'))
  tool(
    'propose_goal_plan',
    {
      description: [
        `Bring ${OWNER} the plan for one goal, in one ask: Odds already here who take on a part (with a new job or a change to one), new hires for work nobody here fits, and the steps only ${OWNER} can do. They tick the parts to go ahead with; each hire then opens in the hire window. Prefer Odds already here. Write each hire's job description to a file in your folder first.`,
        // A plan always goes on its goal's thread, with the raiser as hub (raiseAsk).
        `Once they approve it, you pick up on the goal and lead the work: you hand each piece to the Odd who does it, and you pick up there again as each hire joins.`
      ].join(' '),
      inputSchema: {
        goal_id: z.number().int(),
        why: z
          .string()
          .describe('The plan in two or three plain sentences: who does what, and why this way.'),
        assign: z
          .array(
            z.object({
              staff: z.string().describe("An Odd's id from office_report."),
              part: z.string().max(400).describe('What this Odd does for the goal, one line.'),
              new_job: z
                .object({
                  name: z.string(),
                  instructions: z.string(),
                  schedule: scheduleArg,
                  report: z.boolean().optional()
                })
                .optional(),
              change_job: z
                .object({
                  name: z.string().describe('The job name, exactly as it is now.'),
                  instructions: z.string().optional(),
                  schedule: scheduleArg.optional()
                })
                .optional()
            })
          )
          .max(6)
          .optional(),
        hires: z
          .array(
            z.object({
              ...hireFields,
              part: z.string().max(400).describe('What this hire does for the goal, one line.')
            })
          )
          .max(4)
          .optional(),
        owner_steps: z
          .array(z.string())
          .max(8)
          .optional()
          .describe(
            `What only ${OWNER} can do, one action per step, such as signing in to a tool or a choice that is theirs. Never a step that passes work or a request to an Odd: you hand work on with hand_off. They get these as a task.`
          ),
        attach: attachArg,
        revises: revisesArg
      }
    },
    async (a) => {
      const g = await goal(a.goal_id);
      if (!g) return text(`No goal #${a.goal_id}. Check list_goals.`);
      const here = new Set((await roster()).map((s) => s.id));
      const items: GoalPlanItem[] = [];
      for (const x of a.assign ?? []) {
        if (!here.has(x.staff)) return text(`No Odd "${x.staff}". Check office_report.`);
        items.push({
          kind: 'assign',
          staff: x.staff,
          part: x.part,
          job: x.new_job,
          editJob: x.change_job
        });
      }
      for (const h of a.hires ?? []) {
        const hire = hireFrom(h);
        if (typeof hire === 'string') return text(hire);
        items.push({ kind: 'hire', hire, part: h.part });
      }
      if (!items.length) return text('A plan needs at least one Odd or hire.');
      const files = await attachable(a.attach);
      if ('problem' in files) return text(files.problem);
      const { ask } = await raiseAsk(ME, {
        ...RAISED_ON,
        kind: 'plan',
        title: `Plan for: ${g.title}`,
        why: a.why,
        ifApproved:
          'Odds already here take on their part at once. Each hire opens in the hire window, and your steps land on your desk.',
        plan: { goalId: g.id, items, ownerSteps: a.owner_steps },
        revises: a.revises,
        attach: files.paths,
        run: RUN_KEY
      });
      return text(`Ask ${ask.id} is on ${OWNER}'s desk.`);
    }
  );

tool(
  'keep_lesson',
  {
    description: `Remember a correction from ${OWNER}, so they never give it twice. Call it once when they correct your work or say how they want something done from now on, in chat, in a reason on an ask, or in feedback on a report: "too long", "always copy Sam", "never book before 9". It works only in a chat, a run carrying ${OWNER}'s note on an ask or a task, or a run reading their edit to one of your files; in any other run it refuses, so tell them in your reply instead. Not for an instruction about this one piece of work only. ${OWNER} sees it in your chat as "I'll remember: ..." with Undo, so do not repeat it to them. It goes live in every later run at once when they said it; a lesson you inferred waits for their Keep.`,
    inputSchema: {
      lesson: z
        .string()
        .min(1)
        .max(240)
        .describe(
          'One plain sentence, written as what you will do: "Keep reports to three lines."'
        ),
      quote: z
        .string()
        .min(1)
        .max(400)
        .describe(
          `${OWNER}'s exact words it comes from, copied, not reworded: at least ${QUOTE_MIN_WORDS} words in a row.`
        ),
      how: z
        .enum(['said', 'inferred'])
        .describe(
          `said: their words state it as a rule. inferred: you are reading a rule into a one-off fix.`
        ),
      scope: z
        .enum(['me', 'everyone'])
        .default('me')
        .describe(
          `me, unless their words say it is for every Odd ("all of you", "everyone", "the whole office"), or they are saying how the office should work for them (how much to do without checking, what to hear about): those are for every Odd.`
        ),
      applies_to: z
        .string()
        .max(APPLIES_TO_MAX)
        .optional()
        .describe(
          `Where it applies, in a few plain words: "reports", "team emails", "family plans". Set it whenever their words or what they were correcting limit the lesson: said about a report, about emails, about family plans. Leave it out only when they meant everything you write.`
        ),
      replaces: z
        .number()
        .int()
        .optional()
        .describe('The id of a lesson of yours this one changes or corrects.'),
      why_replaced: z
        .enum(WHY_REPLACED)
        .optional()
        .describe(
          `Needed with replaces, and only then. missed: ${OWNER} corrected something the old lesson already covered, so they had to say it again. refined: ${OWNER} changed or narrowed what they want.`
        )
    }
  },
  async (a) => {
    const kept = await keepLesson(ME, {
      text: a.lesson,
      quote: a.quote,
      how: a.how,
      scope: a.scope,
      appliesTo: a.applies_to,
      replaces: a.replaces,
      whyReplaced: a.why_replaced,
      ownerWords: OWNER_WORDS
    });
    if ('problem' in kept) return text(kept.problem);
    const missed =
      a.why_replaced === 'missed'
        ? ` In your reply, say in one line that ${OWNER} told you this before and you missed it.`
        : '';
    return text(
      kept.status === 'live'
        ? `Lesson #${kept.id} is live from now on.${missed}`
        : `Lesson #${kept.id} waits for ${OWNER}'s Keep in your chat${OWNER_WORDS?.from === 'edit' ? `, as every lesson read from an edit does, and it is for you only` : a.how === 'said' ? `: the quote is not ${QUOTE_MIN_WORDS} or more of their words, word for word, from this run, so it counts as inferred` : ''}. Until they keep it, do not tell them you will do it from now on.${missed} Carry on with the work.`
    );
  }
);

tool(
  'used_lesson',
  {
    description: `Tell the office a lesson from "What ${OWNER} has taught you" changed this run's work. Call it once per lesson per run, only when the work would have come out different without it.`,
    inputSchema: { id: z.number().int() }
  },
  async ({ id }) => {
    const l = await usedLesson(id, ME);
    if (!l) return text(`Lesson #${id} is not a live lesson of yours.`);
    return text(
      l.uses <= CITE_FIRST
        ? `Noted. Say so in your reply, in one line, naming what you did and when ${OWNER} asked, like "Kept it to three lines, as you asked on ${shortDay(l.createdAt)}."`
        : 'Noted. No need to mention it.'
    );
  }
);

if (has('update_goal'))
  tool(
    'update_goal',
    {
      description: `Change a goal: mark it met, paused, dropped or active again, or reword it. When ${OWNER} asks in chat, do it at once. Outside a chat, only to carry out an ask they approved, passing its id. To propose it, raise_ask first.`,
      inputSchema: {
        goal_id: z.number().int(),
        status: z.enum(['active', 'paused', 'met', 'dropped']).optional(),
        title: goalFields.title.optional(),
        why: goalFields.why,
        done_when: goalFields.done_when,
        horizon: goalFields.horizon.optional(),
        due: goalFields.due,
        approved_ask: approvedArg
      }
    },
    async (a) => {
      const go = await goAhead(a.approved_ask);
      if ('problem' in go) return text(go.problem);
      const g = await goal(a.goal_id);
      if (!g) return text(`No goal #${a.goal_id}.`);
      const patch = Object.fromEntries(
        Object.entries({
          status: a.status,
          title: a.title,
          why: a.why,
          doneWhen: a.done_when,
          horizon: a.horizon,
          due: a.due
        }).filter(([, v]) => v !== undefined)
      );
      if (!Object.keys(patch).length) return text('Say what to change.');
      if ('said' in go)
        await record({
          kind: 'decision',
          actor: 'owner',
          title: `Asked ${me.name} in chat: change the goal "${g.title}"`,
          body: go.said
        });
      await updateGoal(g.id, patch, { staffId: ME, askId: 'askId' in go ? go.askId : undefined });
      return text(`Goal #${g.id} is changed.`);
    }
  );

if (has('edit_my_job'))
  tool(
    'edit_my_job',
    {
      description: `Change one of your own jobs: its steps, its schedule, or whether it reports to ${OWNER}. When ${OWNER} asks for a change in chat, make it at once, worded the way they asked, then tell them what changed. Outside a chat, only to carry out an ask they approved, passing its id. To propose a change, raise_ask with the exact new steps first.`,
      inputSchema: {
        job: z.string().describe('The job name, exactly as my_jobs lists it.'),
        instructions: z.string().optional().describe('The full new steps, numbered.'),
        schedule: scheduleArg.optional(),
        report: z.boolean().optional(),
        approved_ask: approvedArg
      }
    },
    async ({ job, instructions, schedule, report, approved_ask }) => {
      const go = await goAhead(approved_ask);
      if ('problem' in go) return text(go.problem);
      const j = await editOwnJob(ME, job, { instructions, schedule, report }, go);
      return text(j ? `Changed "${job}".` : `You have no job named "${job}". Check my_jobs.`);
    }
  );

if (has('edit_my_description'))
  tool(
    'edit_my_description',
    {
      description: `Rewrite your own job description: the text that tells you who you are and how you work, which every run starts from. When ${OWNER} asks for a change in chat, make it at once, then tell them what changed. Outside a chat, only to carry out an ask they approved, passing its id. Pass the whole new description, keeping every part they did not ask to change. It takes effect from your next run.`,
      inputSchema: {
        description: z.string().min(1).max(20_000).describe('The full new job description.'),
        approved_ask: approvedArg
      }
    },
    async ({ description, approved_ask }) => {
      const go = await goAhead(approved_ask);
      if ('problem' in go) return text(go.problem);
      return text(
        (await setDescription(ME, description, { go }))
          ? 'Your job description is changed. It applies from your next run.'
          : 'That is your job description already. Nothing changed.'
      );
    }
  );

if (HANDS_OFF.tool) {
  const colleagues = (await roster()).filter((s) => s.id !== ME);
  const serving = await goalsFor(ME);
  const held = await heldTools([ME, ...colleagues.map((c) => c.id)]);
  /** One of this Odd's tools as its colleague line names it: "the web", "your folder ~/x", "your Gmail". */
  const yours = (t: Tool) =>
    t.id === WEB ? t.name : t.id.startsWith(FOLDER) ? `your folder ${t.name}` : `your ${t.name}`;
  /** Each colleague's line, with the tools of this Odd's it lacks. */
  const lines = colleagues.map((c) => {
    const lacks = lacking(held, c.id, [ME]);
    return `- ${c.id}: ${c.name}, ${c.role}. ${c.remit}${lacks.length ? ` Lacks ${toolNames(lacks.map(yours))}.` : ''}`;
  });
  tool(
    'hand_off',
    {
      description: [
        `Hand a colleague a piece of work their job covers. They start on it at once, in a run of their own, and when they finish, you pick up in a fresh run with their result. Do not wait for it: finish this run.`,
        THREAD_ID
          ? `It goes on work ${THREAD_ID}, the work this run is on.`
          : `A hand-off starts work you lead: each time work comes back you pick the next step in a fresh run, and you may hand on again in it, set a time to pick it back up, or ask ${OWNER}. Those runs see the work, not this conversation, so put what ${OWNER} asked for in request, with every later step and condition. For more of the same as work you lead, even finished work, set continue_work instead: it keeps that work's folder, files and history, and finished work reopens for a new round.`,
        `A round of work takes up to ${HAND_OFF_LIMIT} hand-offs. The one after that waits: the office asks ${OWNER} whether the work keeps going. A yes starts that hand-off as you wrote it, the first of another round, and a no stops the work.`,
        `Write the brief for them: what to do, why, and what to send back. Give them everything they need and nothing more: pass on details about ${OWNER}'s family, or anything from a goal they do not serve, only when their job covers it.`,
        `Describe the work and the result you need, never which tools to use: each colleague may run on another coding tool, with tools of its own.`,
        `Never copy anything from a tool the colleague lacks (the list below says which of yours) into the brief or the folder without ${OWNER}'s yes. If the work needs it, raise_ask first, naming the tool and what goes to whom, and hand off once they say yes.`,
        `Their run works at Draft at most and cannot hand on, so they can prepare, research and draft, but anything outward goes to ${OWNER} as an ask. Your pick-up works at Draft at most too.`,
        colleagues.length ? `Your colleagues:\n${lines.join('\n')}` : 'You have no colleagues yet.'
      ].join('\n\n'),
      inputSchema: {
        to: z.string().describe("The colleague's id, from the list."),
        title: z.string().min(1).max(120).describe('This piece of the work, in one line.'),
        brief: z
          .string()
          .min(1)
          .max(4000)
          .describe('What to do, why, and what to send back, with full paths to any files.'),
        request: z
          .string()
          .min(1)
          .max(600)
          .optional()
          .describe(
            `When this starts new work: what ${OWNER} asked for, in full, with any later steps or conditions (a pause, who checks it). Your later runs on the work see this. Defaults to title.`
          ),
        goal: z
          .number()
          .int()
          .optional()
          .describe(
            'When this starts new work: the id of a goal you serve that it is for, if any.'
          ),
        // A run on a thread hands on in it, so only a run on none may name one, or open one.
        ...(THREAD_ID
          ? {}
          : {
              continue_work: z
                .number()
                .int()
                .optional()
                .describe(
                  `The number of work you lead, as your instructions number it, when this is more of it. Leave out request and goal: it keeps its own. Leave this out for new work.`
                )
            })
      }
    },
    async ({ to, title, brief, request, goal, continue_work }) => {
      if (continue_work !== undefined && (request !== undefined || goal !== undefined))
        return notHanded(
          `Work ${continue_work} keeps its own request and goal. Leave out request and goal, put what is new in the brief, and call hand_off again.`
        );
      if (goal !== undefined && !serving.some((g) => g.id === goal))
        return notHanded(
          `Goal #${goal} is not one you serve. Leave goal out, or name one you serve, and call hand_off again.`
        );
      const on = THREAD_ID ?? continue_work;
      if (on === undefined) {
        const opens = await placed({});
        if ('problem' in opens) return notHanded(opens.problem);
      }
      const r = await handOff({
        from: ME,
        to,
        work: { title, brief },
        thread: on !== undefined ? { id: on } : { title: request ?? title, goalId: goal },
        run: RUN_KEY
      });
      if ('problem' in r) return notHanded(r.problem);
      const name = colleagues.find((c) => c.id === to)?.name ?? to;
      // Held, not refused: the ask keeps it, so the lead must not hand it on again.
      if ('asked' in r)
        return text(
          `This round of work ${r.thread} has taken its ${HAND_OFF_LIMIT} hand-offs, so "${title}" waits on ${OWNER}'s answer to ask #${r.asked}. On a yes it goes to ${name} exactly as you wrote it, as the first hand-off of a new round, and you pick up in a fresh run when they finish. On a no the work stops, and you hear so. There is nothing more for you to do for it: do not hand it on again. Say so, and finish this run.`
        );
      // Named by colleague and title, as the thread's steps are: a follow-up's id
      // means nothing to the Odd or to the owner.
      return text(
        [
          `Handed "${title}" to ${name}, on work ${r.thread}. They start now. You pick up in a fresh run when they finish.`,
          `${handOffsWord(r.left)} left this round.`
        ].join('\n')
      );
    }
  );

  if (THREAD_ID)
    tool(
      'resume_at',
      {
        description: `Pick work ${THREAD_ID} back up at a time you set: the office starts a fresh run of yours on it then, with its history. Use it when the next step has to wait for a time, not for a colleague or for ${OWNER}. A new time replaces the old. Then finish this run.`,
        inputSchema: {
          at: z.string().optional().describe(`${ZONE}: "18:50" for today, or "2026-11-02 18:50".`),
          in_minutes: z
            .number()
            .int()
            .min(1)
            .max(10_080)
            .optional()
            .describe('Instead of at: how many minutes from now.')
        }
      },
      async ({ at, in_minutes }) => {
        const when =
          in_minutes !== undefined
            ? new Date(Date.now() + in_minutes * 60_000)
            : at
              ? officeAt(at)
              : undefined;
        if (!when)
          return text(`Say when: at as "HH:MM" or "YYYY-MM-DD HH:MM" in ${ZONE}, or in_minutes.`);
        if (when.getTime() <= Date.now()) return text('That time has passed. Pick a later one.');
        const set = await parkThread(ME, THREAD_ID, when);
        return text(
          set
            ? `Work ${THREAD_ID} picks back up at ${clockTime(set)} ${ZONE}.`
            : `Work ${THREAD_ID} has ended, or is not work you lead.`
        );
      }
    );
}

// Only in a chat, where the office set the owner's words, and only for threads
// this Odd works on and does not lead: their words reach the lead, not its own.
if (said && workingOn.length)
  tool(
    'tell_lead',
    {
      description: `Pass what ${OWNER} just told you about work you are on to the Odd who leads it, which picks it back up with their words. Copy the part of their message about that work exactly: it goes as theirs. Then tell ${OWNER} you passed it on. The work you are on:\n${workingOn.map((t) => `- ${t.id}: ${t.title}, led by ${t.lead}`).join('\n')}`,
      inputSchema: {
        work: z.number().int().describe('The number of the work, from the list.'),
        words: z
          .string()
          .min(1)
          .max(4000)
          .describe(`The part of ${OWNER}'s message about this work, copied exactly.`)
      }
    },
    async ({ work, words }) => {
      const r = await tellLead({ staffId: ME, threadId: work, owner: OWNER, said, words });
      return text(
        'problem' in r
          ? r.problem
          : `Passed to ${r.lead}, who picks work ${work} back up with ${OWNER}'s words.`
      );
    }
  );

if (has('poke_owner')) {
  tool(
    'poke_owner',
    {
      description: `Send ${OWNER} a chat message later, once: a check-in after something they planned, or a nudge before it. Write the exact message now, in your voice, short; the office delivers it at that time as a chat from you, with a notification on their Mac. Use it when ${OWNER} asks ("check in on me in an hour"), or when your job says to; in_minutes 0 sends it now. One poke per minute: a new one at the same time replaces the old. Not for anything that needs their yes; that is raise_ask.`,
      inputSchema: {
        message: z.string().min(1).max(500).describe(`Exactly what ${OWNER} reads.`),
        at: z.string().optional().describe(`${ZONE}: "18:50" for today, or "2026-11-02 18:50".`),
        in_minutes: z
          .number()
          .int()
          .min(0)
          .max(10_080)
          .optional()
          .describe('Instead of at: how many minutes from now. 0 is now.')
      }
    },
    async ({ message, at, in_minutes }) => {
      const when =
        in_minutes !== undefined
          ? new Date(Date.now() + in_minutes * 60_000)
          : at
            ? officeAt(at)
            : undefined;
      if (!when)
        return text(`Say when: at as "HH:MM" or "YYYY-MM-DD HH:MM" in ${ZONE}, or in_minutes.`);
      try {
        const p = await schedulePoke(ME, when, message);
        return text(`Poke ${p.id} is set for ${clockTime(p.at)} ${ZONE}.`);
      } catch (e) {
        return text(e instanceof Error ? e.message : String(e));
      }
    }
  );

  tool(
    'my_pokes',
    {
      description: 'Your pokes still to come, with their ids, times and messages.',
      inputSchema: {}
    },
    async () => {
      const rows = await waitingPokes(ME);
      return text(
        rows.length
          ? rows.map((p) => `- #${p.id} ${clockTime(p.at)}: ${p.message}`).join('\n')
          : 'No pokes waiting.'
      );
    }
  );

  tool(
    'cancel_poke',
    {
      description: 'Cancel one of your pokes still to come, by its id from my_pokes.',
      inputSchema: { id: z.number().int() }
    },
    async ({ id }) =>
      text(
        (await cancelPoke(id, ME)) ? `Poke ${id} is cancelled.` : `No waiting poke #${id} of yours.`
      )
  );
}

if (has('propose_hire'))
  tool(
    'propose_hire',
    {
      description: `Propose a new Odd to ${OWNER}. Write the job description to a file in your folder first, then pass its path. It lands on their desk as an ask; approving it opens the hire window filled in with this, and they hire from there. They may edit the file before they hire, so the window reads it then. One hire per ask. For a hire that serves a goal, use propose_goal_plan instead.${raisedNote}`,
      inputSchema: {
        ...hireFields,
        why: z.string().describe('Why this hire, in one to three sentences.'),
        revises: revisesArg
      }
    },
    async (a) => {
      const on = await placed({});
      if ('problem' in on) return refused(on.problem);
      const hire = hireFrom(a);
      if (typeof hire === 'string') return text(hire);
      const { ask } = await raiseAsk(ME, {
        ...on,
        title: `Hire ${a.name}, ${a.role}`,
        why: a.why,
        ifApproved: 'The hire window opens with this filled in. You hire from there.',
        revises: a.revises,
        hire
      });
      return text(`Ask ${ask.id} is on ${OWNER}'s desk.`);
    }
  );

if (has('office_report'))
  tool(
    'office_report',
    {
      description: `Everything the office did in a window: each Odd with its remit, its level (read, draft or act), its tool and what its own tools reach, its folders, the office tools it holds beyond the ones every Odd has, its outside tools (each with what it reaches, or why a run leaves it out), and its jobs and runs, asks open and decided, and tasks for ${OWNER} open and done. For the daily report. followUps is the work owed after ${OWNER} answered: carrying out an approved ask, reworking one they sent back, acting on their feedback on a report, or picking up after a task they finished, each with its outcome (done, failed, waiting on ${OWNER}, or null while still to do). Each run has a trigger: 'schedule' means its timer started it, 'manual' means ${OWNER} pressed Run now. Judge a job's timing by its schedule runs only; a manual run at any hour is expected. Every time is ${ZONE}, like the schedules.`,
      inputSchema: { hours: z.number().int().min(1).max(168).default(24) }
    },
    async ({ hours }) => {
      const activity = await officeActivity(new Date(Date.now() - hours * 3_600_000));
      const people = new Map((await roster()).map((p) => [p.id, p]));
      const staff = await Promise.all(
        activity.staff.map(async (s) => {
          const who = people.get(s.id);
          if (!who) return s;
          const caps = await capabilities(who);
          return {
            ...s,
            remit: caps.remit,
            level: caps.level,
            runsOn: AGENT_NAMES[caps.agent],
            // As the Odd's own my_access says it, the office's held network included.
            // Another Odd reads it, so it names whose tools, folders and Settings tab.
            ownTools: ownToolsSaid(caps.agent, caps.own, officeHeldIn(process.env), who.name)
              .join(' ')
              .replaceAll('{owner}', OWNER),
            folders: folderLines(caps.own),
            officeTools: caps.office,
            outsideTools: outsideLines(caps, OWNER, who.name)
          };
        })
      );
      return json({ ...activity, staff });
    }
  );

await server.connect(new StdioServerTransport());
// The database pool would keep the process alive after Claude Code hangs up.
process.stdin.on('end', () => process.exit(0));
