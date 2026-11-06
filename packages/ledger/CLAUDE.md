# packages/ledger

`@oddboro/ledger`. The office's records in Postgres: the owner's name, the Odds (the
`staff` table), asks, tasks for the owner, the files an Odd attaches to them,
pokes (one-time chat messages an Odd sets for later), reports, connectors and grants, jobs and runs, token usage and the owner's plan
windows, the names the owner gives the rooms, the owner's goals and who serves
them, the lessons the owner teaches the Odds, the app's updates, and the ledger itself.
Drizzle ORM over the `postgres` driver. Server only, except `./time`,
`./tools`, `./agents`, `./goals`, `./update-window` and `./work-paths`, which the page may import.

## Running it

`src/home.ts` says where everything is. `HOME` is the owner's office
(`ODDBORO_HOME`, else `~/.oddboro`): the database, the Odds' folders, sign-ins,
and `data/`, the folder every Odd may read. `CODE` is the code
(`ODDBORO_CODE`, else this repo; the app's `Resources/server` in a release).
`OFFICE_PORT` and `DATABASE_PORT` come from `ODDBORO_PORT` and
`ODDBORO_DB_PORT` (4500 and 54329). `STAFF_SERVER` is `mcp.ts` beside it, or
`mcp.js` in a release. Never write `~/.oddboro` or a port anywhere else.

1. With no `DATABASE_URL` in `.env`, the office keeps its own Postgres:
   PGlite inside the office server, files in `~/.oddboro/db`, with
   pgvector. `src/local-db.ts` starts it and serves it on 127.0.0.1:54329 (`DATABASE_PORT`),
   where every other process reaches it through `DATABASE_URL`, which
   `src/db.ts` fills in. A `DATABASE_URL` in `.env` (Postgres in Docker from
   `npm run db:up`, or hosted) takes its place.
2. The office server brings the tables up to date as it starts
   (`src/upgrade.ts`: pgvector, then `migrations/`). `npm run db:migrate`
   does the same; with the office's own
   database, the office has to be running.
3. After a schema change, `npm run db:generate` writes the next migration.
   Never edit a migration that has run; add one. The chain starts at
   `0000_baseline`, which builds the whole schema at once and ends with the
   change triggers, written by hand. A trigger, function or row that
   `schema.ts` cannot say goes in a migration by hand the same way.
   `0002_hand-offs` is the one exception: it replaced a run of migrations
   that only trial offices ran. Drizzle runs a migration only when its
   journal time is later than the last one the office recorded, so `0002`
   carries the time of the last of them those offices ran, and such an
   office skips it. `0003_simplify-cuts` then takes out what they added that
   the office no longer has, and adds what they lack. An office stopped partway through them fails at
   `0002`, since its tables already exist: run `npm run reset` to start it
   over.
4. Before the app's new version opens the database, `src/backup.ts` copies
   `<home>/db` to `<home>/backups/pre-<version>-<time>/db`. It compares
   `ODDBORO_VERSION` with `<home>/version`, the version that last started, and
   keeps the 3 newest copies. Development (no `ODDBORO_VERSION`) never copies.
5. `npm run reset` starts the office over: it moves `~/.oddboro/db`, the
   Odds' homes, the threads' folders and the office's notes into `~/.oddboro/backups/<time>/`
   and clears the office's keys from `.env`, the owner's answer about
   error reports among them, so the next visit asks again. It never
   touches `data/`.

`ODDBORO_ENV` names another `.env`, to try an office out beside the real
one (with its own `HOME`, so its own `~/.oddboro`). In the app the `.env`
is `<home>/.env`, since every update replaces the app's own folder.

`npm test -w @oddboro/ledger` runs `test/` with `node --test`, and fails any
test that runs past 15 seconds (`--test-timeout=15000`), so a hang fails the
suite instead of stalling it. The slowest test takes under a second alone and
about 5 seconds with three suites running at once, so the cap leaves a busy Mac
three times that. A hang holds the database, so every later test in its file
waits out the cap too: keep it no higher than it needs to be. It covers the update
window, the hold, the install decision, a poke's grace, whether a
lesson's quote is the owner's own words, who a lesson is for, which follow-up
notes are the owner's, what an Odd sees
of an edit, that a replacing lesson says why, how a run's prompt lists a
lesson, a hub's list of its threads, which grants a run holds back and
how an Odd is told about each, what a run below the Odd's level keeps, and
the three questions in every manager's hello (`test/managers.test.ts`).
`test/lessons-db.test.ts` keeps, changes, lists and uses lessons, tells which are news, and starts runs
from the owner's edits and denials; `test/hand-off-limit.test.ts` holds
a round's hand-off limit, the owner's yes or no past it, and continuing a thread; `test/hand-off-news.test.ts`
holds the floor's news of each hand-off and hand-back; `test/thread-access.test.ts`
holds what an Odd sees through a thread; `test/tell-lead.test.ts` holds
the owner's words reaching a thread's lead; `test/pick-ups.test.ts` holds
one run per Odd per thread, results and answers joining one pick-up, and a waiting
result going back only while what it raised is open; and
`test/one-goal-thread.test.ts` walks one goal from plan to end on its one
thread, with each hire as a colleague and only the lead handing on;
`test/goal-thread-no-manager.test.ts` holds that with no manager the first
Odd's thread is the goal's one, and a second Odd's hand-off for it is refused;
`test/owner-tables.test.ts` holds that no table of words the owner reads from
the ledger names a thread or a hand-off, and that work is named by its goal
or its title (`workTitle`), the same whether it finished or a restart cut it off. The tests that drive threads call
`oneThreadPerGoal` (`test/one-thread.ts`) after each test, which fails when a
goal has a second thread or an Odd that serves a goal and has no job leads one. Each runs the office's own code
on an in-memory PGlite with every migration, which `test/pglite.ts` puts in
place of `db.ts` with `mock.module`, hence `--experimental-test-module-mocks`.
`test/hand-off-tool.test.ts` and `test/goal-day-tool.test.ts` run `src/mcp.ts`
in its own process, as the office does for each run, over the office's own
database (`local-db.ts`) in a throwaway folder, which `test/tool-server.ts`
sets up and stops when the file ends, so the suite exits. The first holds
which runs are offered `hand_off`, the run's key reaching the thread, a
hand-off that hands nothing on coming back as an error, and a hand-off's
result naming the work and saying when it starts a new round, `tell_lead` for
a goal hire, the refusal of a goal's work in its chat, a lead naming the
thread an ask is for, and every tool refusing a key it does not take; the second, the office's day in `my_goals`.
`test/owner-words.ts` is the check that a line the owner reads says no thread,
hand-off or number, which ledger tests and the office's format test share.
`test/deliveries.test.ts` holds when the owner decided each ask.

## Files

| File                   | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/schema.ts`        | Every table                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/office.ts`        | Everything the office does with them. The app and the MCP server share it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/offices.ts`       | Office layouts: save one, move in or back, where each Odd works in each, and the art drawn for them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `src/mcp.ts`           | The office MCP server an Odd runs with: ledger, asks, tasks, access                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `src/agents.ts`        | The coding tools an Odd runs on, their names, and the systems each is offered on. No imports, so the page reads it too                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `src/tools.ts`         | The office tools in plain words, which every Odd has, and the starters                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `src/capabilities.ts`  | What an Odd can do: its level, office tools, and each outside tool with whether a run gets it. Runs, `my_access`, `office_report` and the Access tab read it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `src/registry.ts`      | Finding servers in the catalog and the public MCP Registry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `src/embed.ts`         | Vectors from Ollama's `nomic-embed-text`, on this computer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `src/time.ts`          | The office's time zone (`OFFICE_TIME_ZONE`), and a schedule's next run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `src/checks.ts`        | What an install needs, one check each. Imports no db.ts, so it runs before a database exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `src/setup.ts`         | `npm run setup`: asks nothing. Checks the computer, starts the office service, opens the browser                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `src/platform.ts`      | What differs between systems: log folder, login service (launchd, systemd, Task Scheduler), opening a URL or a file, finding Claude Code, and Windows PowerShell for Windows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `src/secrets.ts`       | Secrets in the system's own store, one entry per system: `security` (Mac), `secret-tool` (Linux), the Credential Manager through `@napi-rs/keyring` (Windows)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `src/env.ts`           | `.env` read and written a key at a time, by setup and by the office                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `src/errors.ts`        | `fixedError`, the one way office code says a fixed message an error report may keep                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `src/local-db.ts`      | The office's own Postgres (PGlite), its socket, and NOTIFY from other processes. Starting it gives a stop, which only a test needs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `src/upgrade.ts`       | Brings the tables up to date: pgvector, then migrations. `markBaseline()` moves an install made before the baseline onto it, once, and takes out the Google connector it had                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `src/managers.ts`      | The Office Manager: the four ready-made ones, their job description, and hiring one                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `src/personas.ts`      | An Odd installed from a New Altitude persona: its package type, the hands' job description (`personaDesk`), hiring and updating one, and its quiet reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/goals.ts`         | Goals: set, change, who serves each, progress, each goal's threads for the owner, and approving a goal or a plan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `src/goal-words.ts`    | Goals in plain words (areas, horizons, status, health), for the page and the Odds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `src/hand-offs.ts`     | Odds handing each other work: the hand-off, its result going back, the lines a chat shows, and each side's brief                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `src/hand-off-news.ts` | The news of each hand-off for the floor: who walks over to whom, from the newest row the office told                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `src/threads.ts`       | Threads: opening one, the hand-off limit and the held hand-off, parking and waking, the thread's folder, the cards a chat shows, and each goal's threads                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `src/work-paths.ts`    | How a file in a thread's folder is named when attached (`workPath`), and the bare name the owner sees (`shownPath`). No imports, so the page reads it too                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/lead-brief.ts`    | What a lead is told of the threads it leads: each one's story, what it knows (`threadKnown`), the pick-up's brief (`threadBrief`), and a chat's goals (`ledStories`, `goalsLedBrief`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/goal-work.ts`     | In a chat, a goal's work goes to its lead with `tell_lead`: the backstop that refuses it on `raise_ask`, `give_owner_a_task`, `ask_for_access`, `propose_hire` and a `hand_off` that would open a thread                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `src/sharing.ts`       | What an Odd sees through a thread: what one Odd lacks of others' tools (`lacking`), and what a hand-off tells the colleague                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/usage-window.ts`  | The usage window's guard: new hand-offs wait past `WINDOW_GUARD`, and the one `window` ask                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `src/lessons.ts`       | Lessons: keep one, change one, the live ones a run follows, the Lessons window's list, the news of each kept and used, and whether a quote is the owner's words                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `src/reset.ts`         | `npm run reset`: moves the office aside so the next visit is a new owner's                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `src/updates.ts`       | The `app_update` row: the owner's window, the version ready to install, when it installs, and when the app went down for one and came back                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `src/update-window.ts` | When an update installs, the 15-minute hold, the 20-minute limit for a run, a poke's grace. No database                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `src/backup.ts`        | The copy of the database before a new version opens it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `migrations/`          | Drizzle migrations, from `0000_baseline`. Its last section, the change triggers, is written by hand. `0001_app-update` adds `app_update` and its trigger. `0002_hand-offs` adds `threads`, `lessons` and `lesson_uses` with their triggers, `hand_off`, `thread_id` and `edit` to follow-ups, `hand_off_id` and `thread_id` to asks and tasks, `held` to asks, and `usage.tokens`, and gives every Odd the hand-off tool. `0003_simplify-cuts` takes out what an office that ran the longer form of `0002` still has: `threads.budget`, `threads.budget_why`, `threads.round_at`, `asks.hand_offs`, `asks.share` and `usage.follow_up_id`, and adds `asks.held`, which it lacks. It opens each thread stored as `waiting`, and makes each `share` ask an `approval`. On a fresh office it changes nothing. `0004_agent` adds `staff.agent`, only where it is missing, since a trial office that ran its first form, `0011_agent`, has it. `0005_persona-package` adds `staff.package`, the New Altitude persona an Odd came from, null for every other Odd |

## Rules

- A decision, a finished task, a job run and a hire each write one `ledger`
  row through `record()`, embedded on the way in. Write a row nowhere else.
- The ledger is append-only. Fix a mistake with a new row, never an edit.
- Every table the page shows has a trigger that NOTIFYs `office` with its
  name. A new table the page shows gets one in a migration.
- Text is embedded once, when it is written, never in a loop. With Ollama
  down the row is still written, and search falls back to words.
- `STAFF_ID` is set by the office when it starts `src/mcp.ts`. A tool acts as
  that Odd and no other. In a chat, the office also sets `OWNER_SAID` to
  the owner's message. An Odd changes its own jobs or job description only with
  a go-ahead (`GoAhead`): their words from `OWNER_SAID`, recorded as their decision
  beside the change, or the id of the ask they approved that this run carries
  out, which the office sets as `APPROVED_ASK`. An ask id from a tool argument
  counts only when it matches, so each yes covers one carry-out run. Never take
  the owner's words or an approval from a tool argument alone.
- `deliveries(staffId)` lists every ask, task and report an Odd put on the
  desk, with where each stands; the office shows them in its chat.
  `replyToReport` is the owner's feedback, given as a chat reply: it marks the
  report read and records a decision.
- A follow-up (carry out an approved ask, rework one the owner sent back, pick
  up after a task the owner finished, read why the owner said no, read the
  owner's edit to a file) runs once. Older rows may also be
  `feedback`, from before feedback became a chat reply. `startFollowUp` claims it in the
  database before the run, and `finishFollowUp` records the outcome. An Odd
  runs once at a time on a thread: any follow-up on one but a `hand_off`
  waits while a run of the same Odd there has yet to end (`waitsOnOwnRun`),
  and the claim locks the thread, so two at once cannot both start. A run on
  no thread (a chat, a job, a draft, or a follow-up such as a carry-out)
  counts there once it puts work on the thread: a hand-off, taken or held for
  the owner (past the round's limit, or the usage window), a goal's plan, or an
  ask or task its hub names the thread for (`raiseAsk`, `giveTask`). The
  office gives every run a key (`RUN_KEY`) and keeps it in `runsGoing` while
  the run goes, and the thread keeps the key of its hub's runs only
  (`threads.runs`, `keepRun`): a key holds the hub's pick-ups whoever's run it
  is, so a colleague's would stall the lead. The tool server writes the key, in a process of its own, so it
  goes in the database; which keys still go lives in memory only, so a
  restart frees every hold and no key needs clearing. One
  claimed with no outcome after a restart fails through
  `closeStaleFollowUps`; it never runs again. Any failure that goes back to
  a lead (`handBack`), a restart's included, puts nothing on the owner's
  desk, since the lead picks it up at once; any other still reports.
- An Odd's generated look is `staff.look` (the spec) and
  `staff.portrait_px`. Null keeps hand-drawn art. `hire()` and `setLook()`
  refuse a look another Odd has (`lookTaken`), and save any parts drawn
  for it to `parts`, which joins the repo's library for every later look.
- `staff.agent` is the coding tool an Odd runs on (`AGENT_NAMES`: Claude Code,
  Grok, Codex or Gemini). Only the owner picks it: at hire (`hire()`, before any
  run), and after through `setAgent()`, which also
  removes the Odd's chat session (`chatSession`), since the other tool
  cannot resume it. `AGENT_PLATFORMS` says which systems offer each tool:
  Claude Code on Mac and Linux, Grok and Codex on Mac only, Gemini on none
  until a live run holds its walls (`agentsOn()`, and `offeredAgent()` for a
  hire or a move).
- `usage.staff_id` is null for a run as the office (drafting a job
  description, drawing a look). `usage.tokens` is a generated column, the
  row's one token sum, which a staffer's usage (`usageFor`) adds up.
- An approved access ask with nothing left to connect, or one whose connect
  task the owner finishes, starts a `carry_out` follow-up: the Odd checks the
  tool and does the work that waited on it. Any other task an Odd gave the
  owner, marked done, starts a `task_done` follow-up (`follow_ups.task_id`):
  the Odd reads the answers and attached files, then does what came next,
  like proposing the hire an intake was for. A dropped task starts nothing,
  unless it was given on a hand-off or a thread (below).
  A denied ask with a reason also starts a `denied` follow-up: the Odd reads
  the reason, keeps a lesson if it says how to work from now on, and never
  carries the ask out. It serves no hand-off and joins no thread
  (`servesNoThread`), since the denial itself already went back there, or
  stopped the thread when it was a no to more hand-offs. It runs at Draft at
  most (`atDraft`) and is offered no `hand_off`, so no `continue_work`
  either (`LESSON_RUN`); so is the `edited` run below.
  When the owner saves a change to an Odd's file (`writeStaffFile` in the
  office), `learnFromEdit` starts an `edited` follow-up, with
  `follow_ups.edit` holding the path and the file just before the save. The
  run reads the file as it is then, and keeps a lesson only if the change
  shows how the owner wants such work done, and may not write that file. A
  save while one for that Odd and path has not finished starts none: one yet
  to start reads the newest version, and once one under way ends, the office
  (`readEditAgain`) starts one more from the version it read if the file
  changed since. A file attached to a task (a form the owner fills in) starts
  none, and neither does a save that changed nothing. It too joins no thread.
- A lesson (`keep_lesson`) is for the Odd that heard it or for every Odd:
  `staffId` is always `heardBy` or null, and `lessonsOf` relies on that.
  `appliesTo` says where it applies in a few words ("reports"), null for
  everywhere; the same words for another place are another lesson, which
  replaces the open one with those words as it goes live (unless it names
  another in `replaces`), so narrowing or moving a lesson leaves one place.
  An owner change to the place alone keeps the quote. It
  is `said`, and live at once, only when its quote is in `OWNER_SAID` or
  `OWNER_NOTE`; otherwise it waits for the owner's Keep. Only a `said` lesson
  changes one already there: a guess with the same words and place returns
  that lesson as it is, replacing nothing and counting no miss. An `edited` run
  carries the owner's version of the file as `OWNER_EDIT` instead: the quote
  must be in it, and a
  lesson from it is always a guess for that Odd alone, whatever `how` and
  `scope` the Odd passed (`keptAs` reads where the `OwnerWords` came from). `OWNER_NOTE` is the
  owner's note a follow-up carries out (their reason on an ask, or their note
  on a task), set by the office from `ownerNoteOf` (`NOTE_IS_OWNERS`),
  never on a hand-off or a hand-back, whose notes are not the owner's own,
  or a hub's pick-up, whose note joins the office's lines around each answer
  and `tell_lead`'s words. The owner's words there have their own run: the
  `denied` follow-up, or the colleague's chat that heard them. A lesson may quote it, but it is never a go-ahead. A run with none of the three (a job run, a first day) keeps no lesson:
  `keepLesson` refuses, so guesses cannot fill the cap. A quote counts only
  as `QUOTE_MIN_WORDS` or more whole words in a row. When the owner rewords a
  lesson, the new text is its quote too, since they typed it. `keep_lesson`
  refuses a new lesson once its scope holds `LESSON_CAP` live and waiting
  lessons, unless it replaces one; the owner's own changes
  (who it is for, Keep) are not capped. A guess (a waiting lesson) the owner
  has not kept within `GUESS_DAYS` is dropped: `dropped()` works it out from
  `created_at` as the lesson is read, never on a timer. A dropped guess leaves
  the cap, the count `guessesWaiting` gives each Odd's Lessons tab, and the
  tab itself; `lessonsOf` reads it as `dropped`, and Keep still makes it
  live. An Odd cites a lesson the first `CITE_FIRST` times it changes that
  Odd's work, through `used_lesson`, which
  counts each Odd's uses apart in `lesson_uses`. A lesson that
  replaces another with other words passes `replaces` and `why_replaced`, and only then:
  `missed` when the owner had to say again what the old one covered, which
  adds one to the lesson's `missed` and goes in the ledger, or `refined`
  when they changed what they want. A lesson for one Odd never replaces a
  lesson for every Odd: when the owner narrows one that did, the lesson for
  every Odd comes back. Undo on a lesson brings back the one it replaced,
  unless another open lesson replaces that one; a dropped guess is not open.
  `libraryLessons` lists every open lesson, guesses first, with each Odd's
  uses and the total, for the owner's Lessons window. `lessonMark` and
  `lessonNewsSince` give the office each new lesson row and each new use
  after a mark, for its `lesson` events; the owner's changes write neither.
- A lesson makes an Odd more careful, never more permitted. Nothing here or in
  `keepLesson` touches grants or levels, and a run's rules say so: words
  asking for more than the Odd holds keep only the careful part, and more
  access is the Access tab's job.
- Every manager's hello (`hello` in `MANAGERS`, and `customHello`) asks three
  questions in their own voice, each with the default if skipped: what the
  office should help the owner get done, how much to do without checking with
  them (until they say, the office checks before anything leaves it), and
  everything or only what needs them (until they say, only what needs them,
  plus the daily report). The manager keeps each answer about how the office
  works as a lesson for every Odd, as said. `test/managers.test.ts` holds
  every manager to it.
- A new hire with a job gets a `first_day` follow-up (`startFirstDay`) that
  starts its work right after it says hello, with no ask behind it; its result
  goes on the desk. It is on no thread, and work for a goal the hire serves is
  not in it. A hire with no job gets none: it runs only when handed work. One
  serving a goal gets its first piece from the goal's lead, whom hiring it
  wakes on the goal's thread.
- A hand-off (`hand_off`, in `src/hand-offs.ts`) is a `hand_off` follow-up
  for the colleague, with `follow_ups.hand_off` holding who handed it, the
  title and the brief. `finishFollowUp` hands every outcome back as a
  `handed_back` follow-up for the Odd that handed it, a restart's failure
  included, but for one: the colleague's run that ends waiting goes back
  only while something it raised is still open (`answeredAll`). When the
  owner answered all of it before the run ended, the answer already went
  back, or started a run whose result will. Results that land while the hub
  runs on the thread wait, and the next pick-up takes them all
  (`resultsToJoin`, named in its brief); they end with it. Both runs work at
  Draft at most.
- Every hand-off is a step in a thread (`src/threads.ts`, the `threads`
  table). An Odd's `hand_off` with no goal opens one with that Odd as the hub; with a goal it goes on the goal's thread. One goal is
  one thread (`goalThread`): led by the manager, or by the Odd opening it when
  the office has none, it holds the goal's `goal` planning run, every plan for
  it and every hand-off for it (`hand_off` with `goal`), and counts no
  hand-off as it opens. Only its lead hands on there, so a hire serving the
  goal joins it as a colleague. An Odd that serves a goal and has no job leads
  no thread: `openThread`, the one place a thread is opened, refuses it
  (`LEADS_NONE`), whatever tool or run got there; the manager is never refused.
  A finished goal thread is found as it is, so a goal never gets a second: an
  ask or task raised on it opens it again (`raisedOn`), and so does the lead's
  next hand-off (`takeHandOff`), so a lookup alone, such as a hand-off the
  office refuses, changes nothing. A stopped one stays stopped: a hand-off
  there is refused, and only a new plan for the goal opens it again
  (`raisedOn` with `plan`), since the plan asks the owner afresh. With no
  manager, a second Odd's hand-off for the goal finds the first Odd's thread
  and is refused, since that Odd leads it. The office sets `RUN_KEY` on every run (`runsGoing`), `THREAD_ID` on every run on a thread, either side, and
  `HAND_OFF_ID` on a colleague's, which then gets no `hand_off`: only the
  hub's runs hand on, into the same thread, so it stays hub and spoke and never
  nests. From a run on no thread, such as a chat or a job, the hub may name a
  thread it leads with `continue_work` instead of opening one; such a run's
  system prompt lists its latest threads (`recentThreads`,
  `recentThreadsBrief`), and its `raise_ask` and `give_owner_a_task` take
  `work`, the thread it leads that the item is for, or null (`notLed` refuses
  one it does not lead or that is stopped). Continuing a done or failed thread reopens it with the
  same folder, history, goal and request, for a new round of work; a stopped
  one stays stopped. A round of work takes up to `HAND_OFF_LIMIT` (8)
  hand-offs; continuing an ended thread starts a new one. `handOffsUsed` is
  this round's; every round's are the thread's `hand_off` follow-ups.
  `takeHandOff` holds the limit, and `count` is its one check. The hand-off
  past it waits: `askToKeepGoing` raises one `hand_offs` ask on the thread,
  holding what the lead chose in `asks.held` (the colleague, title and
  brief), and while that ask is open no other hand-off goes. The office raised it, so it
  takes a yes or a no only (`yesOrNo` in `src/tools.ts`). A yes
  (`startHeld`, in the transaction that claims the ask, so a stop between
  them cannot lose it) starts the held hand-off as the first of a new round,
  with what it carries worked out at the yes (`sharing`), so its result
  brings the hub back; the hub hears the yes itself only when
  the owner wrote something with it. A no stops the thread, the held hand-off
  never goes, and the hub wakes to say where the work stands. An ask raised
  before asks held their hand-off wakes the hub to hand on again. The hub moves it on by a colleague finishing, by
  `resume_at` (`parkThread`; the office clock calls `wakeThread`, which starts
  a `resume` follow-up), or by the owner answering an ask or task raised on it
  (`asks.thread_id`, `tasks.thread_id`; `answerThread` when no run follows,
  carrying the ask, so an approved goal plan starts the hub leading its work).
  An answer that comes while the hub's `resume` has yet to start joins it as
  one more line, so hires landing together wake the hub once, and the claim
  returns the row as joined (`startFollowUp`), so the run reads every line.
  Every follow-up on a thread is written through `addFollowUp`, which settles
  the thread's holder and status (`settleThread`, the one place status is
  worked out; `askToKeepGoing` settles it too): the status is open until the
  work ends, and an ask or task raised on it that is still open keeps it
  open, however the hub's last run ended. Whether it waits on the owner is
  never stored: `stageOf` reads it from the desk. Each hub run on its thread gets
  `threadBrief`: the steps, the latest result in full, one "Still waiting on"
  line for what it raised that is still open in any round, the newest plan the
  owner approved on it, part by part, with their answer, the hand-offs left,
  and those still out, so it can go on or wait for them. The plan is the order
  of the work: no stage order is coded. A colleague's brief tells it to say
  what it did and never what comes next (`nextIsLeads`).
  Files cross in `threadFolder(id)` (`~/.oddboro/threads/<id>/`): every run on
  the thread reads all of it and writes only `threadPart(id, odd)`.
  An Odd attaches a file there to an ask or a task by its name from the
  office's folder (`src/work-paths.ts`: `threads/<id>/<odd>/<path>`), never a
  copy and never a full path: `workFile` takes it only while the Odd leads or
  works on that thread (`isOnThread`), with no `..` step and no link anywhere
  under the folder of threads, in whoever's part it is. The owner's viewer
  opens it the same way, by its bare name (`shownPath`), and only to read.
  `waitingOn` lists what threads raised that is still open on the desk, oldest
  first across asks and tasks, so a thread's card and its goal name the same
  item first. `goalThreads` gives every thread with its stage for the Goals
  window (`goalsWindow`): waiting on the owner while anything it raised is
  open, whatever its status, else as its status says, with everything it
  waits on, oldest first. The chat's card (`threadsFor`) has the same stage.
  Neither gives the owner a thread number, a hand-off count or tokens: the
  office shows each by its title. Threads come newest first. The window
  lists a goal's under it, and every thread for no goal still under way or
  waiting as other work.
- New hand-offs to Odds on Claude Code wait while the plan's 5-hour usage window is nearly used up
  (`src/usage-window.ts`). Runs report the share used and the reset time
  (`plan_limits`); the window's size in tokens is not known. Past
  `WINDOW_GUARD` (85%), `holdForWindow` in `takeHandOff` refuses each new
  hand-off to an Odd on Claude Code without counting it (one to an Odd on
  another tool goes), parks its thread until the reset
  (`resume_at`, with `threads.held_by` naming the ask; a finished one opens
  again for a new round) and raises one `window` ask per window, locking
  `plan_limits` so two hand-offs raise one. The ask is office-wide, so it is
  filed under the manager (`manager`), or under the hub that hit the guard
  when the office has none. In an office with Odds on other tools, its why
  names the Odds on Claude Code. A yes (`answerWindow`) lets
  hand-offs run until the reset and wakes the held threads through
  `answerThread`; a no leaves them held. The clock's `wakeThread` wakes each at
  the reset with `WINDOW_RESET`, and takes an ask nobody answered off the desk
  once it holds no thread (`windowWoke`). A hub's own `resume_at` replaces a
  hold. A run already going is never stopped. The office raised the ask, so a
  no starts no `denied` run, and it cannot be sent back.
- What an Odd sees through a thread is no wider than its own access
  (`src/sharing.ts`). Each hand-off is compared with every Odd on the thread,
  the hub and each colleague handed work there, and `lacking` is the one
  place that says what one Odd lacks of others' tools: any grant they hold,
  against the reader's grants in force: those `accessOf` holds nothing back
  from, the same rule `capabilities` gives a run its tools by (`access()` in
  the office's `staff.ts`). A run below the Odd's level (`capped`) holds
  nothing more back: it reads the same tools, only never at write. The office
  never holds a hand-off for sharing: a hub whose work needs a tool's contents
  the colleague lacks is told to `raise_ask` the owner first and hand off after
  the yes, which reaches it as any ask's answer does. The hand-off records
  the tools others on the thread have that the colleague lacks (`withheld`)
  and the colleague's own tools someone on the thread lacks (`kept`); `handOffBrief` and `handOffContext` tell the
  colleague not to expect the first and never to write the second into its
  part or its reply, but to `raise_ask` instead.
- In a chat, a colleague's system prompt lists the latest threads it works
  on and does not lead (`threadsOn`, `threadsOnBrief`): those it was handed
  work on, and those of a goal it serves, before any hand-off. `tell_lead`,
  offered only with `OWNER_SAID` set and such a thread, passes the owner's
  words about one to its lead (`tellLead`). The words must be in `OWNER_SAID`;
  the lead picks the thread up through `answerThread`, joining a `resume` that
  waits. It refuses a thread the Odd leads, one it does not work on, and a
  stopped one. The words the lead wakes to say that the colleague passed the
  owner's words on and does nothing more, so the lead decides and hands on.
  With a goal's thread among them, `raise_ask`, `give_owner_a_task`,
  `ask_for_access`, `propose_hire` and a `hand_off` that would open a thread
  refuse it as an error pointing to `tell_lead` (`goalWork` in
  `src/goal-work.ts`) when the Odd has no job and leads no goal's thread the
  owner has not stopped. An Odd with a job of its own is told the rule and
  trusted with it. A named thread it leads is checked first, so a lead is
  never refused its own goal's work.
- A lead's chat and its pick-ups read the same facts about a thread it leads
  (`threadKnown` in `src/lead-brief.ts`): the steps, the latest result, what
  still waits on the owner, the approved plan and who serves the goal now, from
  the office's records. A chat gets one section per live goal it leads
  (`goalsLedBrief`), a pick-up its thread's `threadBrief`. The office reads
  them once as the run starts (`ledStories`), after any wait for a slot, so a
  run sees what landed while it waited.
- A hand-off that waits on the owner comes home again once they answer. Asks
  and tasks the colleague raises while serving it carry `hand_off_id` (the
  office sets `HAND_OFF_ID` for those runs). `servesHandOff` finds it for the
  follow-up an answer starts, and `finishFollowUp` hands that result back once
  it ends done or failed. With no run to follow (a denial, a dropped task, an
  approved hire), `handBackLater` sends the owner's answer itself.
- A hire ask carries its proposal in `asks.hire`. It is approved only by
  hiring, never by a follow-up run. A proposal may name an intake file, which
  the hire gets a copy of as `notes/intake.md`, and a goal it serves. The
  office approves a hire with `approveHire` (`src/goals.ts`), which links the
  goal in the transaction that approves the ask, so a link that fails leaves
  the proposal open and wakes nobody.
- Goals are the owner's. An Odd never sets one: `propose_goal` raises a
  `goal` ask, and `approveGoal` sets it. Setting one (`addGoal`) starts a
  `goal` follow-up for the Office Manager to plan it, and the first goal makes
  the manager's weekly review job. A `plan` ask (`propose_goal_plan`) holds
  every part of one goal's plan in `asks.plan`, and `raiseAsk` puts it on the
  goal's one thread (`goalThread`), whatever run raised it, and the thread
  keeps that run's key when its raiser leads it (`keepRun`).
  `approvePlan` takes the parts the owner ticked: Odds already here serve the
  goal and get their job at once, each hire becomes its own hire ask on the
  plan's thread, and the owner's steps a task. `approveAsk` does all that
  before the answer goes back, so the hub's run finds it. Hiring one of those
  hires answers its ask on the thread, which brings the hub back again.
- An Odd sees only the goals it serves (`staff_goals`): `my_goals` and its
  prompt read `goalsFor`, never `allGoals`. `log_progress` refuses a goal it
  does not serve. `list_goals` is the Office Manager's.
- A schedule is every n minutes, daily, weekdays, or once a week on a day
  (`{ every: 'week', day: 'Fri', at: '16:00' }`).
- `src/mcp.ts` registers every tool through `tool()`, never
  `server.registerTool` directly: its input refuses a key it does not name and
  lists the ones it does, so an old parameter name in a resumed chat is an
  error, not a call that runs as if it were left out.
- `src/mcp.ts` registers a tool only when `hasTool` says the Odd holds it.
  A new office tool gets a row in `src/tools.ts` and that same check. Gate on
  the grant, never on an Odd's id.
- The owner's name lives in the `owner` table, one row, set per install with
  `setOwnerName()` and read with `ownerName()` ("the owner" until one is set).
  Odd prompts use it, so each install's Odds call the owner by name. Never
  write a name into the code or the docs.
- Secrets never land here. A connector names its secrets; the values live in
  the system's own secret store (`src/secrets.ts`): the Keychain on a Mac, the
  Secret Service keyring on Linux through secret-tool, and the Credential
  Manager on Windows through `@napi-rs/keyring`, in pieces of 2,048 bytes,
  since one credential holds at most 2,560.
- Start Claude Code through `claudeCommand()` in `src/platform.ts`, never as
  a bare `claude`: on Windows an npm install is a `.cmd` Node will not start,
  so the shim's script runs under this Node instead.
- On Windows, reach the system through `powershell()` or `powershellSync()`
  with values passed as `env`, never pasted into the script, so nothing needs
  quoting.
