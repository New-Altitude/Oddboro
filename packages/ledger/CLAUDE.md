# packages/ledger

`@oddboro/ledger`. The office's records in Postgres: the owner's name, the Odds (the
`staff` table), asks, tasks for the owner, the files an Odd attaches to them,
pokes (one-time chat messages an Odd sets for later), reports, connectors and grants, jobs and runs, token usage and the owner's plan
windows, the names the owner gives the rooms, the owner's goals and who serves
them, the app's updates, and the ledger itself.
Drizzle ORM over the `postgres` driver. Server only, except `./time`,
`./tools`, `./goals` and `./update-window`, which the page may import.

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
4. Before the app's new version opens the database, `src/backup.ts` copies
   `<home>/db` to `<home>/backups/pre-<version>-<time>/db`. It compares
   `ODDBORO_VERSION` with `<home>/version`, the version that last started, and
   keeps the 3 newest copies. Development (no `ODDBORO_VERSION`) never copies.
5. `npm run reset` starts the office over: it moves `~/.oddboro/db`, the
   Odds' homes and the office's notes into `~/.oddboro/backups/<time>/`
   and clears the office's keys from `.env`, the owner's answer about
   error reports among them, so the next visit asks again. It never
   touches `data/`.

`ODDBORO_ENV` names another `.env`, to try an office out beside the real
one (with its own `HOME`, so its own `~/.oddboro`). In the app the `.env`
is `<home>/.env`, since every update replaces the app's own folder.

`npm test -w @oddboro/ledger` runs `test/` with `node --test`: the update
window, the hold, the install decision and a poke's grace.

## Files

| File                   | What it holds                                                                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/schema.ts`        | Every table                                                                                                                                                                  |
| `src/office.ts`        | Everything the office does with them. The app and the MCP server share it                                                                                                    |
| `src/offices.ts`       | Office layouts: save one, move in or back, where each Odd works in each, and the art drawn for them                                                                          |
| `src/mcp.ts`           | The office MCP server an Odd runs with: ledger, asks, tasks, access                                                                                                          |
| `src/tools.ts`         | The office tools in plain words, which every Odd has, and the starters                                                                                                       |
| `src/capabilities.ts`  | What an Odd can do: its level, office tools, and each outside tool with whether a run gets it. Runs, `my_access`, `office_report` and the Access tab read it                 |
| `src/registry.ts`      | Finding servers in the catalog and the public MCP Registry                                                                                                                   |
| `src/embed.ts`         | Vectors from Ollama's `nomic-embed-text`, on this computer                                                                                                                   |
| `src/time.ts`          | The office's time zone (`OFFICE_TIME_ZONE`), and a schedule's next run                                                                                                       |
| `src/checks.ts`        | What an install needs, one check each. Imports no db.ts, so it runs before a database exists                                                                                 |
| `src/setup.ts`         | `npm run setup`: asks nothing. Checks the computer, starts the office service, opens the browser                                                                             |
| `src/platform.ts`      | What differs between systems: log folder, login service (launchd, systemd, Task Scheduler), opening a URL, finding Claude Code, and Windows PowerShell for Windows           |
| `src/secrets.ts`       | Secrets in the system's own store, one entry per system: `security` (Mac), `secret-tool` (Linux), the Credential Manager through `@napi-rs/keyring` (Windows)                |
| `src/env.ts`           | `.env` read and written a key at a time, by setup and by the office                                                                                                          |
| `src/errors.ts`        | `fixedError`, the one way office code says a fixed message an error report may keep                                                                                          |
| `src/local-db.ts`      | The office's own Postgres (PGlite), its socket, and NOTIFY from other processes                                                                                              |
| `src/upgrade.ts`       | Brings the tables up to date: pgvector, then migrations. `markBaseline()` moves an install made before the baseline onto it, once, and takes out the Google connector it had |
| `src/managers.ts`      | The Office Manager: the four ready-made ones, their job description, and hiring one                                                                                          |
| `src/goals.ts`         | Goals: set, change, who serves each, progress, and approving a goal or a plan                                                                                                |
| `src/goal-words.ts`    | Goals in plain words (areas, horizons, status, health), for the page and the Odds                                                                                            |
| `src/reset.ts`         | `npm run reset`: moves the office aside so the next visit is a new owner's                                                                                                   |
| `src/updates.ts`       | The `app_update` row: the owner's window, the version ready to install, when it installs, and when the app went down for one and came back                                   |
| `src/update-window.ts` | When an update installs, the 15-minute hold, the 20-minute limit for a run, a poke's grace. No database                                                                      |
| `src/backup.ts`        | The copy of the database before a new version opens it                                                                                                                       |
| `migrations/`          | Drizzle migrations, from `0000_baseline`. Its last section, the change triggers, is written by hand. `0001_app-update` adds `app_update` and its trigger                     |

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
  up after a task the owner finished) runs once. Older rows may also be
  `feedback`, from before feedback became a chat reply. `startFollowUp` claims it in the
  database before the run, and `finishFollowUp` records the outcome. One
  claimed with no outcome after a restart fails through
  `closeStaleFollowUps`; it never runs again.
- An Odd's generated look is `staff.look` (the spec) and
  `staff.portrait_px`. Null keeps hand-drawn art. `hire()` and `setLook()`
  refuse a look another Odd has (`lookTaken`), and save any parts drawn
  for it to `parts`, which joins the repo's library for every later look.
- `usage.staff_id` is null for a run as the office (drafting a job
  description, drawing a look).
- An approved access ask with nothing left to connect, or one whose connect
  task the owner finishes, starts a `carry_out` follow-up: the Odd checks the
  tool and does the work that waited on it. Any other task an Odd gave the
  owner, marked done, starts a `task_done` follow-up (`follow_ups.task_id`):
  the Odd reads the answers and attached files, then does what came next,
  like proposing the hire an intake was for. A dropped task starts nothing.
- A new hire's `first_day` follow-up (`startFirstDay`) starts its work right
  after it says hello, with no ask behind it; its result goes on the desk.
- A hire ask carries its proposal in `asks.hire`. It is approved only by
  hiring, never by a follow-up run. A proposal may name an intake file, which
  the hire gets a copy of as `notes/intake.md`, and a goal it serves.
- Goals are the owner's. An Odd never sets one: `propose_goal` raises a
  `goal` ask, and `approveGoal` sets it. Setting one (`addGoal`) starts a
  `goal` follow-up for the Office Manager to plan it, and the first goal makes
  the manager's weekly review job. A `plan` ask (`propose_goal_plan`) holds
  every part of one goal's plan in `asks.plan`; `approvePlan` takes the parts
  the owner ticked: Odds already here serve the goal and get their job at
  once, each hire becomes its own hire ask, and the owner's steps a task.
- An Odd sees only the goals it serves (`staff_goals`): `my_goals` and its
  prompt read `goalsFor`, never `allGoals`. `log_progress` refuses a goal it
  does not serve. `list_goals` is the Office Manager's.
- A schedule is every n minutes, daily, weekdays, or once a week on a day
  (`{ every: 'week', day: 'Fri', at: '16:00' }`).
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
