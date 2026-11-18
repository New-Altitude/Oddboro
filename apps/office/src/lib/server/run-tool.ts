// Running an Odd on its AI tool: the access it holds, the run itself and the tool's process.
//
// A Claude Code run gets the office's file tools where `FILES_VIA_OFFICE` says,
// else its own five (Read, Glob, Grep, Write, Edit), and with the owner's switches as its tool takes them (`OwnTools`), Bash in
// Claude Code's sandbox and WebSearch and WebFetch. It may read only its own
// folder, the owner's data folder, on a thread the thread's folder, and the
// folders the owner gave it (see `readable` in run-folders.ts), may write only inside the
// staffer's own folder, its own part of that thread's and the folders the
// owner gave it to change, except its tools' own instructions (`INSTRUCTIONS`
// in files.ts), git's usual places in a folder the owner gave it (hooks, the
// config file, submodules' copies: `REPO_RUNS`, which says what they do not
// stop) and, reading the owner's edit, that file (`deniedEdits`),
// loads no project settings, skills or plugins, and is denied anything not
// pre-approved. It always gets the office server (asks,
// tasks, the ledger), plus whatever access the owner granted: servers at read
// level (the tools the server marks as only reading, `readsOnly`) or at write
// level (every tool), each through the office's gateway (gateway.ts), which
// keeps the keys and sign-ins. Hosted servers get a fresh OAuth token per run.
import {
  accountOf,
  AGENT_NAMES,
  capabilities,
  capped,
  handedOver,
  currentPlatform,
  DATABASE_URL,
  effortFor,
  FILES_SERVER,
  filesViaOffice,
  handsOff,
  heldReach,
  holdNetwork,
  ledStories,
  MANAGER_ROLE,
  modelFor,
  networkHeld,
  OFFICE_ACCOUNT,
  onStories,
  ownerName,
  recordUsage,
  releaseRun,
  reserveRun,
  runCeiling,
  runsGoing,
  setPlanLimits,
  STAFF_SERVER,
  storyOf,
  threadFolder,
  threadPart,
  writesWait,
  type CallPlace,
  type ConnectorRow,
  type Level,
  type StaffRow
} from '@oddboro/ledger';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { floorTool } from '../staff/work.ts';
import { agentCommand } from './agent-sign-in.ts';
import { sourceReady } from './access.ts';
import { lastExchange } from './chat-preface.ts';
import { claudeAccountOf } from './claude.ts';
import { keptAt, plainName } from './chat-files.ts';
import { endedEarly, LAUNCHES, stoppedWhy } from './cli.ts';
import { drive, ownsGroup, type RunEnd, type Sink } from './drive.ts';
import { bus } from './events.ts';
import { deniedEdits } from './files.ts';
import { closeGateway, openGateway } from './gateway.ts';
import { runEndLine } from './health.ts';
import { NOT_SIGNED_IN, SIGN_IN_WHERE, type McpServer } from './launch.ts';
import { personaRun, voiced } from './persona-run.ts';
import { catchUp, NOW, parseSession, saveSession, sectionsOf } from './resume.ts';
import { toolServerEnv } from './run-env-allow.ts';
import { officeEnv } from './run-env.ts';
import { sandboxPaths } from './sandbox-paths.ts';
import { NETWORK_REFUSED, NETWORK_REFUSED_LINE } from './sandbox.ts';
import { updateForChat } from './update.ts';
import { tooOldLine } from './versions.ts';
import { DATA, homeOf, runHomeOf, readable, readsBeyond, unreadable } from './run-folders.ts';
import { prompt, officeNow } from './run-prompt.ts';
import {
  type Run,
  stopped,
  stoppedBy,
  RUN_ENDED,
  type RunOpts,
  type Clock,
  noReply
} from './run-opts.ts';

/**
 * The servers and tool permissions one run gets: the outside tools
 * `capabilities` says it holds. A run the office starts on its own
 * (`atDraft`), and any run that serves a colleague's hand-off, works at Draft
 * at most (`ceiling`), so a colleague's words never stand in for the owner's
 * yes. Only the carry-out of an approval ask, the owner's yes to that exact
 * action, keeps the Odd's level, and so does every run that serves a
 * hand-off when the owner lets the Odd act on its own on work from
 * colleagues (`actsOnHandOffs`). Its
 * caps come down to the ceiling too (`capped`), so its prompt lists what it loads.
 * Every outside tool reaches the run through the office's gateway
 * (gateway.ts), which keeps the keys and passes on only the tools the grant
 * reaches; `gate` is the run's token, closed when the run ends. The tool's own
 * allow list names the same tools, so either one alone holds. A write grant
 * at Draft lists every tool, and the gateway holds each change for the
 * owner's yes (`writesWait`), on the desk where `place` says, but for the
 * tools the owner lets the Odd use without asking (`standing`), in any run
 * with a place but one a colleague's words reach (`handed`: one that serves a
 * colleague's hand-off, or a lead's pick-up of a result) while the owner keeps
 * such work to ask first (`handedOver`); a run with no place (a
 * lesson run) changes nothing. At Act it holds only calls to the tools the
 * owner set to ask first (`askFirst`).
 */
async function access(
  who: StaffRow,
  ceiling: Level,
  ms: number,
  place: CallPlace | undefined,
  handed: boolean
) {
  const office: McpServer = {
    type: 'stdio',
    command: process.execPath,
    args: [STAFF_SERVER],
    // What the server reads as it starts, by name (`TOOL_SERVER_ENV`): the
    // run's own environment, which the tool passes on, holds little of the office's.
    env: { ...toolServerEnv(), STAFF_ID: who.id, DATABASE_URL }
  };
  const servers: Record<string, McpServer> = { office };
  const allowed = ['mcp__office'];
  const held = capped(await capabilities(who), ceiling);
  const caps = handed ? handedOver(held) : held;
  const reach: {
    connector: ConnectorRow;
    level: Level;
    waits: boolean;
    standing: string[];
    askFirst: string[];
  }[] = [];
  for (const a of caps.outside) {
    if (a.heldBack) continue;
    const c = a.connector;
    if (!(await sourceReady(c))) {
      a.heldBack = 'sign-in ran out';
      continue;
    }
    reach.push({
      connector: c,
      level: a.level,
      waits: writesWait(a.level, caps.level),
      standing: a.standing,
      askFirst: a.askFirst
    });
    if (a.level === 'act') allowed.push(`mcp__${c.id}`);
    else allowed.push(...c.readTools.map((t) => `mcp__${c.id}__${t}`));
  }
  const { token: gate, servers: outside } = openGateway(reach, ms, place, who.id);
  Object.assign(servers, outside);
  return { servers, office, allowed, caps, gate };
}

type Window = { utilization?: number; resetsAt?: number };

/** Every run reports the owner's plan windows it has news of, often only one. Keep the latest of each. */
export async function notePlan(info: unknown): Promise<void> {
  const w = (info as { unifiedWindows?: Record<string, Window> } | undefined)?.unifiedWindows;
  const five = w?.five_hour;
  const week = w?.seven_day;
  const when = (s?: number) => (s ? new Date(s * 1000) : null);
  const news = {
    ...(typeof five?.utilization === 'number'
      ? { fiveHour: five.utilization, fiveHourResetsAt: when(five.resetsAt) }
      : {}),
    ...(typeof week?.utilization === 'number'
      ? { sevenDay: week.utilization, sevenDayResetsAt: when(week.resetsAt) }
      : {})
  };
  if (Object.keys(news).length) await setPlanLimits(news).catch(() => {});
}

/**
 * One run of an Odd. A persona Odd's chat, job or follow-up goes on from its
 * coding tool to its persona on New Altitude (`personaRun`); every other run
 * is the coding tool's alone.
 *
 * It ends by its time limit even when something it waits on before its tool
 * starts never answers, so no chat stays "still replying" and no slot stays
 * busy. A run still getting ready then never starts its tool (`runTool`).
 */
export async function run(who: StaffRow, message: string, opts: RunOpts): Promise<Run> {
  const own = !opts.runId;
  const live = opts.runId
    ? runsGoing.get(opts.runId)
    : reserveRun({ staffId: who.id, kind: opts.kind });
  if (!live) throw new Error('The run is no longer registered.');
  if (live.stop.signal.aborted) return stopped();
  const kind = opts.kind;
  const clock: Clock = {
    deadline: Date.now() + opts.timeoutMs,
    step: 'getting ready',
    over: false,
    going: false
  };
  const input = { ...opts, runId: live.key, signal: live.stop.signal, clock };
  // Before its tool starts, `run` ends it: at its time limit, or at once on
  // Stop or the Odd leaving. Once its tool runs (`going`), `runTool` does.
  const ended = Promise.withResolvers<Run>();
  const timer = setTimeout(() => {
    if (clock.going) return;
    clock.over = true;
    console.error(
      `${who.name}'s ${kind} run stopped after ${opts.timeoutMs / 60_000} minutes, ${clock.step}.`
    );
    const r = noReply(opts.timeoutMs);
    opts.onEvent?.({ type: 'error', message: r.text });
    ended.resolve(r);
  }, opts.timeoutMs);
  const interrupted = () => {
    if (clock.going) return;
    const r = stoppedBy(who, live.stop.signal);
    if (!r.interrupted) opts.onEvent?.({ type: 'error', message: r.text });
    ended.resolve(r);
  };
  live.stop.signal.addEventListener('abort', interrupted, { once: true });
  try {
    const r = await Promise.race([
      who.package && voiced(kind) && !opts.lessonRun
        ? personaRun(who, message, { ...input, kind }, runTool)
        : runTool(who, message, input),
      ended.promise
    ]);
    // stderr: the shell routes only stdout, so an error's words can never reach it as a request.
    if (!r.ok) console.error(runEndLine(who.name, kind, r));
    return r;
  } finally {
    clearTimeout(timer);
    live.stop.signal.removeEventListener('abort', interrupted);
    if (own) {
      releaseRun(live);
      bus.emit(RUN_ENDED);
    }
  }
}

/**
 * One headless run on the Odd's coding tool. `session` resumes a saved session
 * file, or starts fresh. A tool that will not start fails the run, naming the
 * tool: no run falls back to another.
 */
async function runTool(who: StaffRow, message: string, opts: RunOpts): Promise<Run> {
  if (opts.signal?.aborted) return stopped();
  const clock = opts.clock ?? {
    deadline: Date.now() + opts.timeoutMs,
    step: 'getting ready',
    over: false,
    going: false
  };
  const step = (now: string) => void (clock.step = now);
  const dir = homeOf(who.id);
  step('reading its account');
  // The account its tool signs in with, and that account's folder. A session
  // saved in another folder (the Odd moved accounts) cannot resume here.
  const account = await accountOf(who);
  const toolDir = await runHomeOf(who);
  const read =
    opts.sessionFile && existsSync(opts.sessionFile)
      ? parseSession(readFileSync(opts.sessionFile, 'utf8'))
      : undefined;
  const saved = read && (read.home ?? '') === toolDir ? read : undefined;
  /** Claude Code's folder for this run: the account's, or ~/.claude for the owner's own login. */
  const claudeDir = toolDir || join(homedir(), '.claude');
  const ceiling = runCeiling(who.permission, opts.draftOnly);
  // Every run gets a key: a thread it hands off on keeps it, and holds the
  // Odd's pick-ups there until it ends (`runsGoing`), even when it is a
  // follow-up on no thread. A call the gateway holds for the owner carries it too.
  const key = opts.runId!; // run() reserves it before preparation.
  step("opening its tools' gateway");
  const { servers, office, allowed, caps, gate } = await access(
    who,
    ceiling,
    opts.timeoutMs,
    opts.lessonRun
      ? undefined
      : {
          staffId: who.id,
          run: key,
          handOffId: opts.handOffId,
          threadId: opts.threadId,
          via: opts.via
        },
    !!opts.fromColleague
  );
  // A source can sign out between the check of both jobs and this run.
  const unavailable = caps.outside.filter(
    (a) => a.heldBack && opts.jobFiles?.sources?.includes(a.connector.id)
  );
  if (unavailable.length) {
    await closeGateway(gate);
    return {
      ok: false,
      text: unavailable
        .map(
          (a) =>
            `${who.name} needs ${a.connector.name} for the scheduled file. Ask in ${who.name}'s chat to reconnect it (${a.heldBack}).`
        )
        .join('\n')
    };
  }
  // Prompts name the owner as {owner}: each install's staff use its own name.
  step('writing its brief');
  const owner = await ownerName();
  const say = (s: string) => s.replaceAll('{owner}', owner);
  // Claude Code keeps a session's first system prompt on --resume, so a
  // resumed run's message carries the time and the sections that changed.
  const prior = saved?.sessionId;
  const time = officeNow();
  const inChat = opts.kind === 'chat';
  // A Claude Code chat reads stream-json and keeps its stdin open until its
  // result, so Send now can add the owner's words to the turn (`addToReply`).
  // A persona's chat stays closed: its persona hears only the first message.
  const streamed = inChat && who.agent === 'claude' && !who.package;
  // What the Odd knows of the work it leads and the work it is on, read now,
  // as the run starts.
  const led = opts.threadId
    ? await ledStories(who.id, { thread: opts.threadId })
    : inChat
      ? await ledStories(who.id, 'chat')
      : [];
  const on = inChat
    ? await onStories(who.id)
    : opts.threadId && !led.length
      ? await storyOf(opts.threadId)
      : [];
  // A chat reads the folder of all that work, even a story too long to be told
  // there. A folder not made yet stays out: each tool would be started with a
  // path that does not exist. A run on a thread reads that one folder.
  const reads = opts.threadId
    ? [opts.threadId]
    : [...led, ...on].map((s) => s.thread.id).filter((id) => existsSync(threadFolder(id)));
  // The owner's switches and folders as this run's tool takes them (the
  // ledger's `ownTools`, which `capabilities` worked out once), less a network
  // this office holds back after Claude Code refused the open one. Read once,
  // so the run, its prompt and its tool server agree.
  const officeHeld = networkHeld();
  const own = heldReach(who.agent, caps.own, officeHeld);
  const extraReads = own.granted.map((f) => f.path);
  const extraWrites = own.granted.filter((f) => f.write).map((f) => f.path);
  // From the facts officeEnv hands the tool server, so the prompt lists the
  // threads a run leads, and who it may hand work to, only when that run is offered hand_off.
  const hands = handsOff(who.tools, {
    thread: !!opts.threadId,
    handOff: !!opts.handOffId,
    lesson: !!opts.lessonRun
  });
  const system = say(
    (await prompt(who, {
      dir,
      caps,
      owner,
      thread: opts.threadId,
      chat: inChat,
      led,
      on,
      shown: opts.shown,
      own,
      officeHeld,
      hands
    })) + (opts.extra ?? '')
  );
  const sections = sectionsOf(system, say(who.desk));
  const preface = prior ? catchUp(saved?.seen, sections, time) : '';
  // In a chat, the office tools get the owner's own words, so a change the owner asks for
  // there is recorded as their decision without an ask.
  Object.assign(
    office.env,
    officeEnv({
      key,
      ownerSaid: opts.ownerSaid,
      update: opts.ownerSaid ? await updateForChat() : undefined,
      chatExchange: opts.chatBefore && lastExchange(opts.chatBefore, { owner, odd: who.name }),
      ownerFiles: opts.ownerFiles?.map((f) => ({
        tag: f.tag,
        path: keptAt(f.name),
        name: plainName(f.name)
      })),
      approvedAsk: opts.approvedAsk,
      signedOut: caps.outside
        .filter((a) => a.heldBack === 'sign-in ran out')
        .map((a) => a.connector.id),
      ownerNote: opts.ownerNote,
      ownerEdit: opts.ownerEdit?.text,
      ceiling: ceiling !== who.permission ? ceiling : undefined,
      handOffId: opts.handOffId,
      threadId: opts.threadId,
      via: opts.via,
      fromColleague: opts.fromColleague,
      lessonRun: !!opts.lessonRun,
      // Every run while held, whatever its own tool or switches: its
      // office_report speaks of other Odds too.
      networkHeld: officeHeld
    })
  );
  // On a thread, the run writes only its own part of the thread's folder.
  const fileThread = opts.threadId ?? opts.jobFiles?.thread;
  const part = fileThread ? threadPart(fileThread, who.id) : undefined;
  if (part) mkdirSync(part, { recursive: true });
  const writes = [dir, ...(part ? [part] : []), ...extraWrites];
  const denied = deniedEdits({
    dir,
    writes,
    granted: extraWrites,
    edited: opts.ownerEdit?.path
  });
  // Where the office carries the run's files (`FILES_VIA_OFFICE`), its tool's
  // own file tools are off and the office's file server is its one way to
  // files, holding the same folders on every system: it reads what the run
  // reads, writes what it writes, and never writes what `deniedEdits` names.
  const officeFiles = filesViaOffice(who.agent, currentPlatform());
  if (officeFiles) {
    servers.files = {
      type: 'stdio',
      command: process.execPath,
      args: [FILES_SERVER],
      env: {
        ODDBORO_FILES: JSON.stringify({
          cwd: dir,
          reads: readsBeyond(dir, reads, extraReads, claudeDir),
          input: opts.jobFiles?.input,
          writes,
          noWrite: denied
        }),
        ...(opts.jobFiles ? { ODDBORO_FILE_CHECK: JSON.stringify(opts.jobFiles) } : {})
      }
    };
    allowed.push('mcp__files');
  }
  // Bash writes in every folder Claude Code works in (the cwd and each
  // --add-dir), whatever the Edit rules say. So with commands, only the
  // folders the run writes are added, and the sandbox's denyWrite, which beats
  // them, holds the data folder and what `deniedEdits` names: never a folder the
  // run only reads, since one may hold a folder it writes (measured on Claude
  // Code 2.1.318). A data folder that is not there is left out: it sits in
  // the office's home, which is neither the cwd nor added, so nothing in the
  // run can make it.
  const data = existsSync(DATA) ? [DATA] : [];
  // Commands get a temp folder of their own: short, since a long one falls
  // back to the folder every run shares (measured), under this system's temp
  // root (`SANDBOX_PATHS`).
  const tmp = own.commands ? join(sandboxPaths().tmpRoot, `ob-${key.slice(0, 8)}`) : undefined;
  // The temp folder comes last: npm keeps its cache there (`shellEnv`), and
  // without it in --add-dir the sandbox refuses npm's writes (measured).
  const workIn = tmp
    ? [...data, ...(part ? [part] : []), ...extraWrites, tmp]
    : readsBeyond(dir, reads, extraReads, claudeDir);
  // The owner's pick for this Odd, or Medium; never below Medium for the Office Manager.
  const model = modelFor(who.agent, who.model);
  const effort = effortFor(who.agent, who.effort, who.role === MANAGER_ROLE, model);
  const input = preface + say(message) + (opts.literal === undefined ? '' : `\n\n${opts.literal}`);
  step(`checking ${AGENT_NAMES[who.agent]}'s sign-in and version`);
  // An added Claude account nobody signed in to: say where to sign in, rather than Claude Code's own advice.
  if (who.agent === 'claude' && account !== OFFICE_ACCOUNT && !(await claudeAccountOf(account))) {
    const line = `Claude Code ${NOT_SIGNED_IN}`;
    await closeGateway(gate);
    opts.onEvent?.({ type: 'error', message: line });
    return { ok: false, text: line };
  }
  // A tool older than the office runs fails on a switch it does not know, so it never starts.
  const tooOld = await tooOldLine(who.agent, SIGN_IN_WHERE);
  if (tooOld) {
    await closeGateway(gate);
    opts.onEvent?.({ type: 'error', message: tooOld });
    return { ok: false, text: tooOld };
  }
  step(`starting ${AGENT_NAMES[who.agent]}`);
  const allReads = readable(dir, reads, extraReads, claudeDir);
  const launch = await LAUNCHES[who.agent]({
    key,
    staffId: who.id,
    dir,
    reads: [
      ...readsBeyond(dir, reads, extraReads, claudeDir),
      ...(opts.jobFiles?.input ? [opts.jobFiles.input] : [])
    ],
    part,
    writes,
    granted: extraWrites,
    edited: opts.ownerEdit?.path,
    system: system.replaceAll(NOW, time),
    input,
    resume: prior,
    servers,
    allowed,
    timeoutMs: opts.timeoutMs,
    web: own.web,
    commands: own.commands,
    network: own.network,
    effort,
    model,
    account,
    // Claude Code, Grok and Gemini open a picture with their file tools;
    // Codex has no such tool (`view_image` is off), so it gets them with the message.
    ...(opts.images?.length ? { images: opts.images } : {}),
    // What only Claude Code reads (`ClaudeRun`).
    toolDir,
    streamed,
    officeFiles,
    tmp,
    workIn,
    data,
    denied,
    readable: allReads,
    // Working these out lists folders, so only a run whose tool reads them does it.
    ...(who.agent === 'claude'
      ? { unreadable: unreadable(who.id, dir, reads, extraReads, claudeDir) }
      : {}),
    sandboxReads: allReads.filter((p) => p !== DATA || data.length)
  });
  // Stopped while it got ready: `run` has ended it, so it starts nothing now.
  if (opts.signal?.aborted) {
    if (!('refused' in launch)) launch.done();
    await closeGateway(gate);
    return stopped();
  }
  if ('refused' in launch) {
    await closeGateway(gate);
    opts.onEvent?.({ type: 'error', message: launch.refused });
    return { ok: false, text: launch.refused };
  }
  const tool = AGENT_NAMES[who.agent];
  step(`waiting on ${tool}`);
  clock.going = true;
  // The command the page counts as installed, such as a Grok only in xAI's
  // install folder or an npm Claude Code on Windows; by name when there is
  // none, so the run fails naming it.
  const [cmd, before] = agentCommand(who.agent) ?? [who.agent, []];
  /** Codex's and Gemini's whole messages, as the chat shows them. */
  let said = '';
  const sink: Sink = {
    event: (e) => {
      switch (e.type) {
        case 'session':
          // The end carries it.
          break;
        case 'tool':
          opts.onEvent?.({ type: 'tool', name: floorTool(e.name) });
          break;
        case 'delta':
          opts.onEvent?.({ type: 'delta', text: e.text });
          break;
        // Only Codex's and Gemini's readers send whole messages. Claude Code's
        // and Grok's send their text as deltas alone, so no reply shows twice.
        case 'message': {
          const text = (said ? '\n\n' : '') + e.text;
          said += text;
          opts.onEvent?.({ type: 'delta', text });
          break;
        }
        case 'usage':
          void recordUsage(who.id, opts.kind, e.usage, e.session).catch(() => {});
          break;
        case 'plan':
          void notePlan(e.info);
          break;
        default: {
          // The type check fails here until a new kind of event has its case.
          const unheard: never = e;
          console.error(`${who.name}'s run has no case for ${JSON.stringify(unheard)}`);
        }
      }
    }
  };
  let started = false;
  const end = await drive(
    () => {
      started = true;
      return spawn(cmd, [...before, ...launch.args], {
        cwd: dir,
        env: launch.env,
        detached: ownsGroup(launch),
        windowsHide: true
      });
    },
    launch,
    sink,
    {
      deadline: clock.deadline,
      signal: opts.signal ?? new AbortController().signal,
      live: runsGoing.get(key)
    }
  );
  clock.going = false;
  const ended = toolEnded(who, end, opts);
  const stderr = end.outcome === 'done' ? '' : end.stderr;
  // A Claude Code that refuses the open network fails this run: the owner
  // is told plainly, and from now on this office's Claude Code runs keep
  // their commands off the internet (`holdNetwork`).
  const refused =
    !ended.ok &&
    who.agent === 'claude' &&
    own.network &&
    NETWORK_REFUSED.test(`${ended.text}\n${stderr}`);
  if (refused)
    void holdNetwork().catch((e: unknown) =>
      console.error("Could not record that Odds' commands stay off the internet:", e)
    );
  // Keyed on the owner's message, not the kind: a new hire's hello is a
  // chat run the owner sent nothing to.
  const line = NETWORK_REFUSED_LINE[opts.ownerSaid === undefined ? 'unsent' : 'sent'];
  const r = refused ? { ok: false, text: line.replaceAll('{name}', who.name) } : ended;
  // Saved however the run ended: once the tool names a session, it holds the message.
  const kept = !!(end.session && opts.sessionFile);
  // The run ends whatever a step here throws: a throw that skipped its end
  // left the chat "still replying" until the office restarted.
  try {
    void closeGateway(gate);
    if (end.session && opts.sessionFile)
      saveSession(opts.sessionFile, { sessionId: end.session, seen: sections, home: toolDir });
    // The time limit passed while it got ready, so the driver started nothing.
    if (end.outcome === 'timeout' && !started)
      console.error(
        `${who.name}'s ${opts.kind} run was ready only after its time limit, so ${tool} never started.`
      );
    // `over` says `run` already told the owner the run hit its time limit, so they hear it once.
    if (!clock.over && !r.interrupted)
      opts.onEvent?.(r.ok ? { type: 'done', text: r.text } : { type: 'error', message: r.text });
  } catch (e) {
    console.error(`${who.name}'s run ended, but tidying up after it failed:`, e);
  }
  return kept ? { ...r, saved: true } : r;
}

/** What an Odd's run says when its tool's run ends (`drive`). */
function toolEnded(who: StaffRow, end: RunEnd, opts: RunOpts): Run {
  switch (end.outcome) {
    // The result's text, else the text streamed, else the last whole message.
    case 'done':
      return { ok: true, text: (end.text ?? end.spoken).trim() };
    case 'failed': {
      const { why } = end;
      // A result that ended early, or one that says it erred, fails the run.
      if ('result' in why)
        return {
          ok: false,
          text:
            why.result.subtype !== 'success'
              ? endedEarly(who.agent, why.result)
              : (why.result.text ?? 'The run failed.')
        };
      if ('tool' in why) return { ok: false, text: why.tool };
      if ('exit' in why) return { ok: false, text: stoppedWhy(who.agent, why.exit, end.stderr) };
      return { ok: false, text: `Could not start ${AGENT_NAMES[who.agent]}: ${why.start}` };
    }
    case 'timeout':
      return noReply(opts.timeoutMs);
    // The run's signal says which: the owner's Stop, or the Odd leaving.
    case 'stopped':
    case 'left':
      return stoppedBy(who, opts.signal);
    default: {
      // The type check fails here until a new way to end has its words.
      const unworded: never = end;
      return unworded;
    }
  }
}
