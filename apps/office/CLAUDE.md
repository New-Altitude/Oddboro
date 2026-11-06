# apps/office

The floor the owner watches, and the desk they work from. SvelteKit 3 with Svelte 5
runes, PixiJS for the pixel-art floor, Tailwind for the page around it, and
Postgres through `@oddboro/ledger`. Port 4500 on 127.0.0.1, or `ODDBORO_PORT`.

`vite build` leaves `@oddboro/*` out of the server build (a Rolldown external
in `vite.config.ts`), so each package finds its own files beside its code and
the app ships them whole (`apps/desktop/scripts/stage.ts`). In the app
(`ODDBORO_APP=1`) `hooks.server.ts` quits on SIGTERM and when stdin closes.

## How it works

1. `src/routes/+page.server.ts` composes the office the owner moved into, or
   the sample Main Street plan until they have one (`currentOffice()` in
   `src/lib/server/space.ts`), and loads the Odds and the owner's desk from
   Postgres (`@oddboro/ledger`). Room names are kept per office: `main-street`
   for the sample, `office-<id>` for a layout.
2. `/atlas/atlas.png` and `/atlas/atlas.json` serve the compiled atlas from
   `packages/sprites/dist/`.
3. The page builds a `Floor` (`src/lib/floor/engine.ts`): sprites by draw
   pass, sky behind windows, and sun shafts and dust by day. At night every
   sprite wears a tint by the hour, emissive pixels ride on top of their own
   sprite at full brightness, and each lamp adds a glow cut to its room.
   Doors open only for an Odd stepping through them. The hour is always
   the office's time zone, which the page gets from the server and sets with
   `setZone` before it shows a time.
4. Each Odd is a `StaffActor` (`src/lib/floor/staff.ts`). It walks to a
   free spot for its activity, preferring its own `room` for work, intake and
   reading. Where it stands is real state: an open ask or task from it puts
   it outside the owner's door (`wait`), a running job puts it to work in its room,
   and so does a thread of its own a colleague holds (its tag reads "Waiting on
   <colleague>"; `wantOf` in the page), and otherwise it wanders between work and breaks. A free Odd's own
   clock starts when it arrives, for a random stay that depends on the
   activity (`STAY` in the page), so Odds never all get up at once. An
   Odd on a job stays at it until the job ends. While an Odd walks, its
   tag reads "→ Room", or "→ <colleague>" on a visit: handing work on, or
   bringing a result back, it walks over, stays about 2 s and goes back to
   the spot it holds (`visit`). It goes after a colleague who moved on while
   it walked up to three times, then stays where it got to. An Odd on a
   thread's work, and its lead while running, show the thread's title and who
   else is on it (`src/lib/staff/thread-tags.ts`). Odds never go home.
   A spot holds one Odd at a time, from the moment one sets off for it:
   every move (the schedule, the Send tab, a chat) skips held spots. A chat
   brings an Odd to the owner's desk, or outside the owner's door when someone is
   already at the desk. The Send tab shows a full place as taken, by whom.
5. `/api/events` is the page's one live line: Postgres NOTIFY (fired by
   triggers on every table, whichever process wrote the row) plus who is
   running a job (`src/lib/server/events.ts`). The page refetches
   `/api/office` on a change. It also carries a `lesson` event (`LessonEvent`)
   for each lesson an Odd keeps (`staff` is the Odd that heard it) and each
   use an Odd makes of one, and a `hand-off` event (`HandOffEvent`) for each
   piece of work an Odd hands a colleague and each result going back, which
   sends `from` over to `to`. On a `lessons` or `lesson_uses` change, or a
   `follow_ups` one, the server reads the rows newer than the last it told
   (`lessonNewsSince`, `handOffNewsSince`), from the newest there when it
   started, so a restart tells nothing again. The owner's Keep, Undo and edits
   are no news, nor is a hand-back that carries the owner's answer. A kept
   lesson plays a notebook once over the Odd that heard it, and a used one a
   note (`pop` on `StaffActor`, art in `fx-pop`). One that arrives while
   another plays is dropped. While it plays, the Odd's name tag rises over it
   (`tagLift`, read in `onRender`) and settles after. Nothing polls.
6. Two full-height panels flank the floor (`src/lib/ui/SidePanel.svelte`).
   Each resizes by dragging its inner edge (or the arrow keys on it), and
   remembers its width per viewer. The start side is the office plate (name,
   the clock, Setup, and the Odds, Desk, Goals, Lessons, Ledger, Hire and
   Office buttons), which opens into a bar of windows
   (`src/lib/ui/windows.svelte.ts`): the Odds list, the Desk, the Goals, the
   Lessons, the Ledger, each hire and each open file is a tab.
   The Odds list (`src/lib/ui/AgentsPanel.svelte`) is every Odd, one per
   row, with a search over name, role and remit; the office opens on it when
   the screen has room beside the floor. Cmd+K (Ctrl+K) opens it from anywhere
   with the cursor in the search; the arrow keys pick a row and Enter opens a
   chat with that Odd (`chatAbout(id, '')`, which takes the cursor and
   leaves any unsent draft alone). D opens the Desk. An Odd with work in progress has
   an "In progress" badge that opens its card on the **In progress** tab
   (`src/lib/ui/WorkTab.svelte`): each piece of work, what the owner approved for
   it, and the tool in use. Every open window stays
   mounted, so a drawing keeps going while the owner works another. ✕ folds the
   bar away with its windows still open; closing a window with unsaved edits
   or a drawing in progress asks first. The end side is the selected
   Odd, and collapses to a rail. The camera centres on the floor left
   between them, and the Desk pill moves to stay clear. The floor opens on
   the whole building and stays where the owner drags it. While an Odd's
   panel is open, the camera follows that Odd; a drag lets go until the
   owner selects someone or reopens the panel.
7. **The Desk** (`src/lib/ui/DeskDrawer.svelte`) is everything waiting on the owner:
   open asks, open tasks, unread reports. The pill at the top shows the count,
   the tab title carries it, a waiting Odd's tag turns ember, and a Mac
   notification is one switch away. An open item starts with who sent it:
   portrait, name, role and remit, and a click opens that Odd's card. An ask takes Deny, Iterate or Approve,
   with a reason that is optional except to iterate. Approving starts the
   Odd on it; a Deny with a reason starts the Odd reading it, to keep any
   lesson in it; Iterate sends it back with the owner's words and the new version
   arrives linked to the old. An ask the office raised itself, to keep work
   going past a round's hand-offs or the usage window's, takes no Iterate
   (`yesOrNo` in the ledger's `tools.ts`). The usage window's ask takes Pause it or Let
   it carry on instead, and no Odd reads a no to it; a task an Odd gave them, marked done, goes back to that Odd to
   pick up from (an intake becomes the hire it was for). A report has Reply and
   Read: feedback is a reply in its writer's chat, not a form on the desk. Opening
   any item selects it in its sender's chat on the end side. Selecting text in a report offers Chat (`src/lib/ui/SelectToChat.svelte`):
   the owner picks any Odd, and its chat opens with the passage quoted as a
   draft (`chat-about.svelte.ts` carries it to `ChatPanel`). Each of those is a follow-up (`src/lib/server/follow-ups.ts`,
   started from `hooks.server.ts`, woken by changes to `follow_ups` and by any run ending). Its reply
   ends in an outcome line; every outcome goes in the ledger, a failure always
   goes on the desk, and a success only when the owner ticked "Report when done". A
   restart mid-run marks it failed rather than run it twice. A proposed hire
   has "Open hire window" in place of Approve; hiring from it approves it,
   copies the owner's intake into the hire's `notes/intake.md` and links it to
   the goal it was proposed for. Every hire then gets going alone (`firstDay`):
   its first job, if it has one, comes with the hire, its panel opens on Chat
   while it walks in, and it says hello there in the session later chats
   resume. What the hello says, and whether a first day follows, come from
   `firstDayOf` in `src/lib/server/first-day.ts`. A hire with a job then gets a
   `first_day` follow-up that starts its work at once: questions the intake left open go on the desk as a
   task, missing tools as an access ask, otherwise the first real piece of
   work, whose result goes on the desk. A hire with no job starts nothing: it
   runs only when handed work. One serving a goal joins the goal's thread as a
   colleague, and the hire route links it to the goal before it approves the
   hire ask, since that answer wakes the goal's lead to hand it its first piece. A goal ask (the manager heard one
   in chat) has "Set the goal". A plan ask lists its parts, each ticked: Odds
   already here taking a part, with a new job or a change to one, and hires.
   Approving takes the ticked parts (`approvePlan`): Odds already here start at
   once, each hire becomes a hire ask the page opens in its own hire window,
   and the owner's steps land as a task. Every plan goes on its goal's thread,
   whatever run raised it, and once those parts exist the answer brings the
   manager back there (`answerThread`), told to lead the work by handing each
   piece on; a denied one, told not to start it. The plan's hire asks go on
   that thread too, so hiring one brings the manager back again, to hand the
   hire its first piece.
   A task's steps can carry an action: a hosted server's sign-in, a secret that goes in
   the keychain (`src/lib/server/keychain.ts`), a tool list to confirm, or a
   choice. Any ticked step can be undone (`untickStep`): a checkbox unticks, and an action step has Undo, which opens its action again (a wrong key gets pasted again). A bare key saved for an `Authorization` header goes
   out as `Bearer <key>` (`headerSecret`); a value with a scheme goes as it is. Steps without one tick by hand, and "Tick all" ticks every one of
   those at once. Ticking keeps the task open: the drawer opens an item only
   when its `focus` changes, never because the desk reloaded. Finishing a task records it in the ledger as the owner's work.
8. **The Ledger** (`src/lib/ui/LedgerPanel.svelte`) searches every decision and
   piece of work by meaning. **Goals** (`src/lib/ui/GoalsPanel.svelte`) are what
   the owner wants more of, grouped by area: each with why it matters, what
   done looks like, when, who serves it and their part, and the progress Odds
   log. The owner sets, rewords, pauses, marks met or drops one, and adds or
   takes off Odds (`/api/goals`). Setting one starts the Office Manager
   planning it (a `goal` follow-up), and the plan comes back as one ask.
   An open goal lists its work, newest first, and keeps an ended one
   (`goalsWindow`), each row its title and one line on where it stands
   (`workLine` in `src/lib/ui/format.ts`): who has it, when its lead picks it
   up, paused for the plan's window, waiting on you, done, failed or stopped.
   No row says thread, a number, a hand-off count or tokens. A reopened thread
   is still one row. Under the goals, Other work lists every thread for no goal
   still under way or waiting on the owner, newest first, in the same rows,
   with what each waits on, oldest first. A click on one opens
   the oldest thing it waits on, on the Desk, else its hub's chat, where it
   shows as a card. The list reloads when goals or threads change (`version`).
   **Lessons** (`src/lib/ui/LessonsLibrary.svelte`) is what the office knows
   about the owner: every open lesson (`GET /api/lessons`, `libraryLessons`).
   It opens on About you, the lessons for every Odd; a filter per Odd shows
   what that Odd follows (its own and every Odd's), and All shows every one.
   Guesses waiting for Keep come first, apart from the kept ones, each naming
   the Odd that heard it, with the same controls as on a Lessons tab
   (`Lesson.svelte`). Uses count that Odd's under its filter, else every
   Odd's together. The search box filters by a lesson's words, quote and where
   it applies, on the page. `openLessons(filter)` opens the one window on that
   filter (About you when none is given; `{ staff }` for one Odd, `'all'` for
   the floor's library shelf), and switches an open one to it. It reloads
   when lessons change (`version`).
9. The Odd's panel has **Chat, Card, In progress, Jobs, Lessons and Access** tabs,
   and opens on Chat. Send is a button on the card. The chat stays mounted
   while the panel is open, so a
   reply survives switching tabs or collapsing. The chat shows every ask, task
   and report the Odd put on the desk, where it landed (`chatLog` merges
   `deliveries()` into `chat.jsonl`), with where each stands now, and every
   hand-off it gave or got (`handOffsFor`). A hand-off it gave sits on the card
   of its thread (`threadsFor`), where the thread began, even once it is
   continued: its title, when it began, where it stands in the same words as
   the Goals window (`workLine`) and anything waiting on the owner, with each
   step on Open. A click on a desk item opens
   it on the start side: on the Desk while it waits, else a report in its own
   window (`ReportView.svelte`). Reply under one sends the next message about
   it: the run gets the item in full, and a reply about a report marks it read
   and goes in the ledger as the owner's feedback (`replyToReport`). A
   colleague's chat also lists the threads it works on and does not lead,
   those it was handed work on and those of a goal it serves, and `tell_lead`
   passes what the owner says there about one to its lead, who decides the
   next step. Raising a goal's work there itself is refused, pointing to
   `tell_lead`. Each
   message also tells the session what no run of it wrote (`chatPreface` in
   `src/lib/server/chat-preface.ts`): what the Odd delivered, and the asks
   the owner decided, since it last replied, and the pokes delivered and the lines the office said in the Odd's
   name (`told`, from `sayInChat`, like a new manager's hello) since the owner
   last wrote. The owner's line is stamped when sent,
   so what lands during a reply sits between the two. Its input grows with the text
   up to 60% of the chat, and the bar above it drags it taller; that height is
   remembered per viewer. Every run's system prompt opens with "Who you work
   for" (`whoFor` in `staff.ts`): the owner, `data/people.json` when it
   exists, the Odd's own `notes/intake.md` when it has one, and the active
   goals it serves with its part and the latest progress. An Odd sees only
   the goals it serves. Every run's "How the office works" (`house` in
   `src/lib/server/house.ts`) holds the rules every run keeps, whatever it is
   for: only its reply and what a tool call put on the desk or in chat reach
   the owner, so it never says it sent, gave, brought or handed something no
   tool call in that run did, it never promises the owner a later step that no
   tool call in the run set up, and it speaks of the owner by name or as
   "they" unless told otherwise. A rule for every run goes there, never in
   one run's brief. After it comes "What {owner} has taught you"
   (`taught` in `staff.ts`): the live lessons for this Odd and for every
   Odd, each with where it applies when it says (`lessonLine`), and the rules:
   how the whole office should work (how much to do without checking, how
   the owner wants to hear how things go) is a lesson for every Odd, a vague
   answer gets one follow-up question or nothing kept, a lesson never widens
   the Odd's level or tools (more access is the Access tab's job), and a
   lesson about writing to the owner covers what they read, not ask and task
   titles. An Odd keeps one from the owner's words in a chat or on an ask or a
   task, or from their edit to one of its files (item 13), which is always a
   guess for that Odd alone. The chat shows each lesson where the Odd kept
   it, and the Lessons
   tab every open one, guesses waiting for the owner's Keep first, each with
   Keep, Undo, Edit and who it is for, and a line when the owner had to say it
   again. A lesson that applies in one place says "Only in: ..." under it, and
   Edit changes its words and where it applies. The tab's label counts those guesses (`guesses` on the profile,
   reloaded with `/api/office` on a `lessons` change). A guess not kept within
   7 days is dropped: it leaves the tab and the count, and its chat line says
   so, with Keep after all. Prompts never name the owner: they say `{owner}`, and
   `run()` in `staff.ts` and `runAsOffice` fill in `ownerName()` for this
   install. `src/lib/server/staff.ts` runs `claude -p` on the owner's login for chats,
   job runs, follow-ups and drafts, or `grok -p` for an Odd that runs on Grok,
   `codex exec` for one on Codex, or `gemini` for one on Gemini (`staff.agent`;
   each but Claude Code gets ready through `LAUNCHES` in `src/lib/server/cli.ts`). The owner picks under "Runs on" (`RunsOn.svelte`) in the hire
   drawer, stored with the hire before its hello runs, and on the Access tab
   (`AccessTab.svelte`); both list the tools `/api/agents` finds on PATH
   (Grok in xAI's install folder `~/.grok/bin` too, and Claude Code where
   `claudeCommand` finds it on Windows, `agentCommand`),
   with each one's sign-in, which the owner starts beside the picker,
   only those offered on this system (`AGENT_PLATFORMS` in the ledger: Grok
   and Codex on a Mac only, Gemini nowhere until a live run proves its walls); a
   switch on the Access tab goes through `setAgent` from the staff PATCH, clears the Odd's chat
   session, and gets a 409 while the Odd is replying. A computer without the
   picked tool fails the run naming it; it never falls back to the other.
   `src/lib/server/grok.ts` starts a Grok run from the office's own Grok home,
   `~/.oddboro/grok` (`GROK_HOME`), never the owner's `~/.grok`. The owner signs
   in to it from the office's page (`agent-sign-in.ts`, item 18); a run from a
   home with no sign-in fails pointing to the Access tab (`endedEarly` in `cli.ts`),
   a run past Grok's plan limit says so in the office's own words, with no
   link (`GROK_PLAN_LIMIT`), and any other early end gives the tool's own words. The sandbox keeps Grok
   from saving a renewed sign-in, so a sign-in that could run out before a
   run ends is renewed first with `grok models` outside the sandbox, and a
   run whose sign-in has still run out is refused pointing to the Access tab
   (`grokSignedOut` in `grok.ts`). Its files are
   held by a kernel sandbox profile per Odd (per run on a thread), built on
   Grok's `strict`, which reads the Odd's folders (a lead's chat also its live
   goals' folders, in the Odd's own profile), the owner's data folder and the tool server's code and
   shuts `~/Library`, `/Library`, `/tmp` and `/var`; Read deny rules
   (`UNREADABLE`) cover what the kernel still lets it read, Grok's home among
   them, and Edit and Write deny rules cover Grok's home, whose sessions folder
   the kernel lets it write. Every deny rule, for either tool, names the path
   and everything under it (`denyRules` in `files.ts`). Grok's grep runs
   ripgrep inside the sandbox, so a run gets grep only when `rg` is on PATH,
   and the kernel then reads ripgrep's folders, which deny rules keep from the
   Odd's own tools (`ripgrep` in `grok.ts`).
   `src/lib/server/codex.ts` starts a Codex run from the office's own Codex
   home, `~/.oddboro/codex` (`CODEX_HOME`), never the owner's `~/.codex`. The
   office writes its `config.toml` only into a home with none, before the
   sign-in check, so the sign-in from the office's page (item 18), where a run
   without one points, is kept as a file. Every run
   passes the office's switches as `-c` (`SWITCHES`) under `--strict-config`.
   A Codex Odd has a shell, held by one kernel permission profile per run
   (`filesystem` in `codex.ts`): everything shut but the system's own folders
   and Apple's developer tools (`DEVELOPER_TOOLS`, and the folder `xcode-select -p`
   names, Xcode.app's on a Mac that uses it, found once: `developerReads`) and node's OpenSSL config (`NODE_OPENSSL`), read, `/tmp` shut, its thread folders and the owner's data folder read, its
   folder, its part of a thread and its own temp folder
   (`codex-tmp/<run key>`) written, instruction files and the edited file
   never, and no network. The run is a process group of its
   own; when it ends or times out, that group and each of its commands'
   groups stop (`stopGroups` in `launch.ts`). A job a command moves into a
   group of its own (`set -m`) outlives the run, still confined: macOS shows
   no other process's environment, so nothing finds it once it leaves the tree.
   `src/lib/server/gemini.ts` starts a Gemini run from the office's own Gemini
   home, `~/.oddboro/gemini` (`GEMINI_CLI_HOME`), never the owner's
   `~/.gemini`, signed in only with an API key the owner gives on the office's
   page (item 18), kept in the keychain like the Claude key. The keychain is
   read once per office start, the miss too, so a key put there outside the
   page is seen after a restart; with none the run points to the Access tab and
   starts nothing. A Gemini Odd has file
   tools only. Gemini holds its reads to its folder, the owner's data folder
   and its thread folders (`--include-directories`), and one policy file per
   run (`geminiRules`), in a run folder outside every readable path with the
   run's settings and instructions, is its write wall: every tool it does not
   name denied, reads and the granted MCP tools allowed, writes allowed only
   by full path under its folder and its part of a thread, and refused for an
   instruction file there in any case, the edited file in any case, and any
   path with a `.` or `..` part, `//`, a backslash or a character past ASCII.
   The policy is proved against Gemini's own engine
   (`gemini-policy.test.ts`); a message starting with `/` goes in after a line
   break, so Gemini never runs it as a command.
   A chat never waits: it resumes the
   Odd's one chat session, so only a second chat does. Claude Code keeps a
   session's first system prompt, so a resumed chat's message opens with the
   time and each section that changed since that session last saw it, in full
   (`catchUp` in `src/lib/server/resume.ts`; `session.json` keeps what it saw).
   The office tells each run's tool server about the run through its
   environment (`officeEnv` in `src/lib/server/run-env.ts`): every run gets a
   `RUN_KEY`, and a `denied` or `edited` run, which only reads the owner's
   words for a lesson, gets `LESSON_RUN`, so it is offered no `hand_off`. Jobs, follow-ups
   and drafts each start a fresh session and run side by side, up to three
   per Odd (`AT_ONCE`); the next waits for a slot. Each one is listed in
   `inProgress` (the `Work` shape in `src/lib/staff/work.ts`) with what it
   is, when it started, and the tool it is using now. The list reaches the
   page with each `working` event; only work starting or ending reloads the
   card's tabs. Every Claude Code run gets five file
   tools, reads only its own folder, the owner's data folder (as a Grok run does), Claude
   Code's sessions folder for its own folder, where long
   tool results land, and on a thread, the thread's folder. A lead's chat reads
   the folder of each live (active or paused) goal it leads, and is told where
   each stands, as its pick-ups there are (`readable` in `staff.ts`; Read rules cover Glob and Grep,
   and `dontAsk` turns down every other path). Deny rules beat any allow,
   the owner's own Claude Code settings included, so `unreadable` names what
   stays shut whatever else allows it: `~/.ssh`, `~/.aws`, `~/.gnupg`,
   `~/.config`, `~/Library`, `~/.claude.json`, `~/.google_workspace_mcp` (where
   that MCP server keeps its sign-ins for other apps on the Mac), everything
   in `~/.oddboro` besides `staff/` and `data/` (and `threads/<id>/` for a
   run on that thread), every other
   Odd's folder, and everything in `~/.claude` besides this run's sessions.
   A run writes only inside `~/.oddboro/staff/<id>/`, and on a thread its own
   part of the thread's folder, never an instruction file in either
   (`CLAUDE.md`, `CLAUDE.local.md`, `.claude`, `.grok`, `AGENTS.md`,
   `.mcp.json`, `AGENTS.override.md`, `.codex`, `.agents`, `GEMINI.md`, `.gemini`; `INSTRUCTIONS` and `deniedEdits` in `files.ts`), nor the file a run
   reading the owner's edit is reading, and gets no skills, no
   plugins, none of the owner's own CLAUDE.md files and no Claude Code
   auto-memory (`cleanEnv` in `claude.ts`), the office's own MCP server (`packages/ledger/src/mcp.ts`) with
   only the office tools the owner ticked under "In the office" on the Access tab,
   and whatever outside access the owner granted: servers at read (the tools
   the owner ticked as read-only) or write (every tool, only while the Odd
   holds Act). Which outside tools a run gets comes from `capabilities()` in
   `packages/ledger/src/capabilities.ts`, which also says why a granted one is
   held back (above the Odd's level, still connecting). The prompt's "What you
   can do" section, `my_access`, `office_report` and the owner's Access tab all
   read it for the level and each outside tool. A hosted sign-in that ran out
   shows only to the run, which passes it to its own `my_access` as
   `SIGNED_OUT`; `office_report` and the Access tab still show that tool as
   working. A run below the Odd's own level (a hand-off's, either side, or a
   hub's pick-up) passes its ceiling as `CEILING` the same way, so `my_access`
   says Draft and why, with a write grant read only, as the prompt does
   (`capped`, `accessInRun`). Hosted servers sign in with
   OAuth (`src/lib/server/oauth.ts`): the task's Sign in opens the service, it
   returns to `/connect/callback`, the tokens go in the keychain, and each run
   gets a fresh access token as a header. A token is refreshed one at a time
   per sign-in (`once`), since a service may end a sign-in whose refresh token
   arrives twice. For the same reason `steadyFetch` retries only a request
   that never left this computer; one whose answer was lost is not retried
   within one request. The same provider signs the owner in to New Altitude (see
   "A New Altitude account"). When a tool an Odd holds stops working, it calls
   `reconnect_access` (every Odd has it): the office puts its own connect
   steps on the desk again (`reconnectTask`), after the Odd's steps for
   getting a new key, with no ask, one open per tool. Odds never write
   connect steps by hand.
10. Every run records its tokens per model and the owner's plan windows (5 hours
    and weekly), read from Claude Code's own stream. A run often reports only
    one window, so each is kept as it last came (`notePlan`). The card's back shows
    them (`src/lib/ui/UsageStats.svelte`, LayerChart bars). An Odd's text renders
    as Markdown through `src/lib/ui/Markdown.svelte` (markdown-it, raw HTML
    off). Only a written-out address links out: one with its scheme
    (`https://`, `http://`, `mailto:`, `ftp://`), one that starts `//`, an
    email address, or a Markdown link (markdown-it refuses `javascript:` and
    the like). A bare name like `plan.md` or `www.example.com` stays text
    (linkify's `fuzzyLink` off).
11. The job clock (`src/lib/server/jobs.ts`, started from `hooks.server.ts`)
    keeps one timer for the soonest due job, poke or parked thread, resets on
    any change to the jobs, pokes or threads table, and looks at the time at least every ten minutes because macOS
    stops timers in sleep. A run's result goes in the ledger, and on the owner's
    desk as a report when the job says so. Each run records its trigger:
    `schedule` when the timer started it, `manual` when the owner pressed Run now.
    A thread its hub parked with `resume_at` wakes at that time: the clock
    starts the hub's `resume` follow-up. So does a thread the usage window
    held, at the window's reset (`usage-window.ts` in the ledger).
    A manual run leaves the schedule where it was, and the Office Manager's report data
    (office times) tells the two apart. The Jobs tab edits a job in place, and opens the Odd's job description
    in the document editor (`src/lib/ui/JobDescription.svelte`); a save
    refuses if the description changed since the owner opened it. While an
    update is about to install it starts no scheduled job (item 17).
12. **Hire** on the office plate opens a five-step drawer
    (`src/lib/ui/HireDrawer.svelte`). Step one draws the person: the owner
    describes them, `src/lib/ui/LookStudio.svelte` asks `/api/looks`, and
    the owner sees the portrait and the walk, then redraws with a note or keeps it.
    Nobody is hired without a kept look. While it draws,
    `src/lib/ui/PixelDrawing.svelte` paints a bust pixel by pixel beside the
    stage and the time. Step three picks the level and the tool its runs go
    through ("Runs on", Claude Code unless the owner picks another, item 9).
    Hiring grants no tools: access goes through the
    Odd's Access tab when they ask. A first job reports to the owner's desk unless they
    untick it; a proposal can say either way. "Draft it" drafts the job
    description. Both run as the office (`src/lib/server/office-run.ts`),
    never as an Odd, so a new office can hire its first. Opened from a
    proposed hire, it starts filled in, reading the job description from the
    proposer's file at that moment. Hiring writes a `staff` row; the Odd
    walks in live. When the office opens, Odds do not walk in: each starts
    already at its spot (`StaffActor.arrive`), outside the owner's door if they owe
    it an answer, in its room if a job is running, anywhere else otherwise.
13. **Files** an Odd attaches to an ask or a task are rows in the
    `attachments` table, sent with the desk. `src/lib/ui/Attachments.svelte`
    lists them under the item and shows a Markdown one in
    `src/lib/ui/FileEditor.svelte` (a file in `DocEditor.svelte`, the one
    document editor) right there (a task starts in Edit); any
    other file opens in its own window. A file attached from a thread's folder,
    such as a page a colleague built for a goal, is named
    `threads/<id>/<odd>/<path>` (the ledger's `work-paths.ts`). It shows by its
    bare name and opens to read only, since the Odd that attached it may not be
    the one that wrote it (`src/lib/ui/viewer.ts` says what the viewer offers). While an attached file has unsaved
    edits, the desk's finishing buttons wait and leaving the item asks first.
    Files an Odd names in any text it writes open as a window of
    their own (`src/lib/ui/FileViewer.svelte`, the same editor in a window): rendered or editable, saved
    only by Save, with Back asking first when there are unsaved changes. `Markdown.svelte` links a full path, or a path
    inside the writer's folder in code or a link, only once `/api/files/resolve`
    says the viewer opens it, or that it is a page the browser opens (a page links
    even when too big or not text for the viewer), and links that file; anything else stays
    text (`src/lib/ui/file-links.ts` asks once per name per page;
    `src/lib/ui/markdown.ts` renders it). A bare file
    name opens the one file with that name in the Odd's folder, outside hidden folders.
    When no file there has that name, it opens the newest file of that name in
    the Odd's own parts of thread folders, such as a goal's, and the link, the
    viewer and the Ledger still show only the bare name.
    `src/lib/server/files.ts` serves only text files up to 1 MB that already
    exist inside that Odd's own folder or its parts of thread folders, never
    through a link to a file or a folder. It takes a bare name, or a path
    inside the Odd's own folder such as `site/index.html`, which opens only
    when its real path lands inside that folder; never a full path, and a path
    with a folder never reaches a thread, except an attached file's
    `threads/<id>/...` name, which opens that one file in any part of the
    folder while the Odd is on that thread (`workFile` in the ledger). A folder
    it may not read hides only what is in it. An error the owner reads names
    only the file's bare name (`ownerMessage`); the rest goes to the log. It
    refuses a save if the Odd changed the file
    since the owner opened it, and records each save in the ledger. A save
    that changed the file starts an `edited` follow-up (`learnFromEdit`): the
    Odd reads its version beside the owner's and keeps a lesson only if the
    change shows how the owner wants such work done, as a guess waiting for
    Keep. That run may not write the file. One runs per file: a save before
    it ends joins it, and once it ends, a file changed since it read it starts
    one more (`readEditAgain`). A file on a task is a form the owner fills in,
    so saving it starts none.
    A page an Odd built (`.html` or `.htm`, `src/lib/pages.ts`) links to the
    viewer like any file, which shows its source, and gets an "Open in
    browser" button beside the link and in the viewer's own header, so an
    attached page gets one too. The button posts the same name to
    `/api/files/open`, which finds the file the viewer would open, takes its
    real path, refuses anything else, and opens it as a file on the Mac with
    the system opener (`openFile` in the ledger's `platform.ts`: no shell, and
    the office does not wait on the browser). The office never reads a page it
    opens this way, so a page over the viewer's 1 MB still gets its link and
    button, and only the viewer says it is too big. An opener that fails to
    start or exits with an error within a second tells the owner it could not
    open the page. Like every action, only the
    owner's page reaches it (see "Who the office answers").
14. **Looks.** `src/lib/server/looks.ts` draws a person (`drawLook`): one
    office run with the parts library, the swatches, the body, two example
    parts and two example portraits in the prompt. It checks every piece
    (`problemsWith`) and retries once with what was wrong; a failed reply from
    words alone is kept in `~/.oddboro/office/last-look.md`. `/api/staff/[id]/look` and
    `/portrait` serve a hired Odd's frames and portrait, cached per
    version, and PUT on `look` saves a redraw from the card's **Redraw look**. A
    persona Odd's card has no Redraw look and `setLook` refuses one: its look
    is its package's ("A New Altitude persona as an Odd").
    The floor loads each drawn look into the atlas under its own variant
    (`src/lib/floor/looks.ts`), and `Pixel` takes an image `src`.
    The owner can draw someone from a headshot: `LookStudio` shrinks it to
    512 px as a JPEG on the page (which drops its metadata), `/api/looks`
    passes it to `drawLook`, and `runAsOffice` sends it as an image block
    over stream-json input, so the run still has no tools. Office runs pass
    `--no-session-persistence`, so Claude Code keeps no transcript of one. The
    photo, and Claude's `read` and `check` of the face, are never written to
    disk or the ledger.
    With a photo, the prompt (`PHOTO` in `looks.ts`) has Claude write a
    `read` block first (hair darkness and hairline, facial hair and its colour,
    glasses, skin, expression, neckline), then build the look from it.
    Swatches are listed with their hex values so colours match by darkness,
    not name. Without a photo a drawing is one run at low effort, one to two
    minutes; high effort took five to ten and drew no better from words. With
    one, it is two at medium, five to seven minutes, and the hire window says
    so: the drawing, then a look-and-fix run (`lookAndFix`)
    that sees the photo beside the portrait and sprite at 8x, lists what
    differs in a `check` block, and redraws. A fix that fails the checks is
    dropped and the first drawing stands. `/api/looks` takes a `model` from a
    short list (`MODELS` in its route) to compare models; the page never sends
    one, so the office's default draws.
15. **Pokes.** An Odd sets a one-time message for later with `poke_owner`,
    from a chat or a job run; it belongs to the Odd, never to a job. The
    office clock (`src/lib/server/jobs.ts`) delivers it on the minute
    (`deliverPoke` in `staff.ts`): a `poke` line in the Odd's chat and a
    notification on the owner's computer (`notifyMac`: as Oddboro's in the
    app; from the repo through `osascript` on a Mac, `notify-send` on Linux,
    and a toast shown as Windows PowerShell's on Windows). More than 15 minutes late (the Mac
    slept) it is marked missed instead (`pokeMissed`); time the app spent
    down for an update does not count, so a poke due then lands after the
    restart. The chat ends with a line per poke to
    come ("Ada will message you at 7:01 AM"), with Send now (`pokeNow`) and
    Cancel but not its words, so a poke reads first as a message from the
    Odd when it lands. `in_minutes: 0` sends one now. A job run the
    owner starts by hand (Run now) is told they are at the screen, so it
    sends now whatever quiet hours it keeps. The Odd's next chat turn
    is told which pokes landed since the owner last wrote.
16. **Switches.** Any prop that gives off light (a light line or glowing
    pixels) can be switched: lamps, desk screens, fires, the shop windows.
    A tap on the floor (a press that does not drag) switches the prop drawn
    on top there, and the cursor shows a hand over one. A tap on a library
    shelf no switch covers opens the Lessons on All (`onShelf`, `tapAt` in
    `engine.ts`), so the library's lamps and fire still switch. The page
    flips a switch at once and `PUT /api/switches` keeps it in the ledger's
    `switched_off` table, whose trigger brings every open page along. Off, the prop shows
    its `off` frame (drawn, like the cold fireplace, or compiled with each
    glowing colour in its palette `off` colour), its glow and light go out,
    and its animation stops. A desk whose screen is off is nobody's: its
    work spot counts as taken, so whoever works there gets up for another
    desk, or something else to do when none is free.

17. **Updates.** The shell (`apps/desktop`) finds, downloads and checks a
    new version, then tells the server through `/api/update`
    (`src/lib/server/update.ts`). Only the shell may report one: from
    127.0.0.1 with the `ODDBORO_UPDATE_TOKEN` it passed in. The office picks
    `installAt`: the start of the owner's next window (02:00 to 04:00 office
    time by default, `app_update` in the ledger), or now when the owner presses
    Install now. The rules are in `@oddboro/ledger/update-window`. From 15
    minutes before `installAt` the Odds are held (`held()`): the job clock and
    follow-ups start nothing new, and every run's "How the office works" says
    when Oddboro updates, to start nothing that runs past it and to write where
    it is to its notes. The shell asks `GET /api/update` every 30 seconds;
    `install` turns true once `installAt` has come and no chat, job,
    follow-up, draft or office drawing runs, or 20 minutes after it whatever
    runs. That answer records `downAt`; the next start records `upAt` and
    forgets the ready update (`loadUpdate`). The Setup window's Updates section
    (`src/lib/ui/UpdatesSection.svelte`) shows the version (`ODDBORO_VERSION`,
    or "development"), Check now (the server writes `oddboro:update-check` on
    its stdout), the window, and a ready update with Install now and Install
    tonight. It hears `app_update` changes on `/api/events`.
18. **Installing and signing other tools in.** The owner installs the
    office's Grok, Codex and Gemini, signs Grok and Codex in, and gives Gemini
    its API key, from the page, never Terminal
    (`src/lib/server/agent-sign-in.ts`). `/api/agents` carries each tool's
    sign-in: signed in when Grok's `auth.json` in its office home holds an
    account (its email shown), when Codex's exists (the email from its
    `id_token`), or when Gemini has a key. `/api/agents/[tool]` changes one,
    only for a tool this system offers and never Claude Code. Sign in runs the
    tool's browser sign-in in its office home (`grok login --oauth`, and
    `codex login -c cli_auth_credentials_store="file"`), streamed through the
    runner Claude Code's sign-in uses (`src/lib/server/command-stream.ts`), with
    the sign-in page's address as a link; a second one starts over, Cancel
    stops it, and at five minutes the office stops it and says so. Install runs
    the tool's own installer
    on the same runner (`npm install -g` for Codex and Gemini, xAI's script
    through `bash -c` for Grok, which adds Grok to `~/.grok` and the shell's
    PATH), with no key and no Grok or xAI setting of the office's own
    (`installEnv`). It runs to its end, however long, and while it runs
    every other request about that tool gets 409; `/api/agents` says it is
    installing, so a refreshed page shows it. Installed means `agentCommand` finds
    the command: on PATH, and for Grok also in `~/.grok/bin`, where its
    installer puts it when no folder on the office's PATH can take its link.
    Every grok the office starts, a run's too, is that file
    (`grokCommand` in `grok.ts`), so one installed there runs without a
    restart. Every `grok` the office starts outside a
    run (the sign-in and the renewal's `grok models`) names the home's own
    `leader.sock`, since Grok's default is the owner's `~/.grok`. Sign out
    deletes that home's `auth.json` and never runs a tool's own logout, which
    once removed the owner's own `~/.grok` sign-in. A Gemini key is tried once
    with a listing of Google's models before the keychain keeps it. The page's
    side is `src/lib/ui/agent-tools.svelte.ts`, used by the Other AI tools
    rows (`src/lib/ui/ToolRows.svelte`) and by "Runs on". The rows show on
    onboarding's card (`ToolsCard.svelte`) and as the Setup window's Other AI
    tools section, each only where this system offers a tool to sign in to
    (`offersOtherTools`). Each row offers one action
    (`toolAction` in `src/lib/ui/tool-action.ts`: Install, nothing while
    installing, Sign in, Cancel, Sign in again over a sign-in that may have
    stopped working, or a key), and Sign out beside it when signed in and not
    installing (`offersSignOut`). An install that ends with the tool still not
    found says to restart Oddboro. Each list reads the tools when made, after
    any of them installs a tool or changes a sign-in, and on window focus while
    a sign-in waits or an install runs; nothing polls.

## Designing the office

The Office window (`src/lib/ui/OfficeDesigner.svelte`) takes the owner's words
and `POST /api/office/design` asks Claude, as the office, for an `OfficeSpec`
(a room the owner places carries `side`, west or east, and `row`, back or
front; a change to an office is told where its rooms stand now)
plus a `draw` list: up to 12 pieces the library lacks (props, wall hangings,
desk pieces, floors, wall styles). `drawArt` (`src/lib/server/office-art.ts`)
draws each in its own run, all at once, from `FORMAT.md`, `ART.md`, the
palette and two library pieces of the same kind; a piece that fails twice is
left out and the room falls back to the library. `drawOffice` builds the spec
with `generateOffice` and sends it back once with the problems if it fails.
The drawing runs as a job on the server (`src/lib/server/design-job.ts`), one
at a time: `POST /api/office/design` starts it, and `GET` follows it a line of
JSON per step (`spec`, `plan` with the floor built from library stand-ins for
the pieces still drawing, each `art`, then `done`), so the window shows each
piece as it lands. A page that reloads follows it again and gets every line so
far. `PUT { moveIn: true }` moves in the moment it is done. The window previews the real
floor (`Floor.create(..., { preview: true })`) with the new art loaded by
`addArt` (`src/lib/floor/art.ts`), in the window and in a full-screen
**View larger** dialog. A preview zooms below 1x only to levels where each
tile covers whole device pixels; anything between leaves black seams at tile
edges. The window lists the rooms, what was drawn, and what a floor seen from
above cannot show, and redraws with a note, keeping the pieces already drawn.
The office the owner is in changes the same way: `/api/office/layouts` returns
its spec as `current`, and a note redraws it from that spec. Each note is
added to the layout's words as a "Then:" line, so a later change starts from
everything asked so far. A change in words also shows Claude every room's
items by id and tile, so it can return room `edits` (remove, move, add) that
name the very thing. In the large view, **Arrange by hand** turns on arranging: dragging a placed
thing carries it (the floor's `onMove`, with an outline where it lands) to a
tile in its own room, or its own area (the halls, the street, the grounds),
and a tap picks it (`onPick`, `highlight`) to Move or
Remove. The **Library** panel down the right lists what the office drew for
itself, then every library piece by the room kind it belongs to
(`libraryPieces`), the halls, the street and the grounds, searchable; drag one
onto the floor, or pick one and tap where it goes. Undo steps back. Each change
is an edit on its room, or under `areas` for one outside the rooms, in the spec,
kept in the order made; one the office refuses is not kept, and its reason
shows over the floor. Each is built at once by `POST /api/office/build`
(`buildOnly`, no Claude run). **Save to the office** in the large view moves in
at once. For a whole look the library lacks, like a
dungeon, Claude makes a theme: it draws stand-ins with `replaces` (drawn over
the original, keeping its footprint and spots) and maps them in the spec's
`swaps`, with `windows: false` for a place underground. Once a drawing builds,
`lookOver` paints every room and the building's front and street
(`paintWorld` from `@oddboro/world/render`) and shows Claude each with its
inventory in one run. It fixes what reads wrong with room edits, furnishes
rooms a theme left bare, and asks for stand-ins, swaps and a facade for
anything still off the look, inside or out. Those pieces draw as a second
round (`drawAll`), and the office keeps everything it asked for if that
builds, else only the room edits, else the first version. A change keeps to
what it touched (`scopeOf`): the look-over sees only rooms whose spec changed,
and the front and street only if the theme did; its edits elsewhere are
ignored, and with nothing touched it does not run. The office the owner is in can be refurnished by
the latest rules, or arranged by hand, the same way. Nothing changes until **Move in**:
`POST /api/office/move-in` (`moveInto` in `src/lib/server/move-in.ts`) checks
the art and builds the spec again on the server, keeps the layout and its art (`saveArt`), and `moveIn` makes it the
office. Kept art joins the library for every later drawing: `officeLibrary()`
in `space.ts` merges it into the catalog and the page loads its sheet beside
the atlas. It first remembers where
each Odd works in the office being left, puts anyone it remembers back in
the one being entered, and moves the rest to the work room with the most free
seats. The `offices` trigger reloads every open page. Earlier layouts and the
sample stay in the window to move back to.

## A new owner's first visit

`npm run setup` asks nothing and opens the browser. Until the owner is
welcomed, the page loads the sample's empty lot (`currentOffice({ lot: true })`,
`lotOf` from `@oddboro/world`), and `Onboarding.svelte` runs ten cards in
the start panel, titled "{name}'s Lot" until the office stands on it. The
command center's buttons and tabs appear there once the first run is over, so
the owner meets the panel first. The cards: Your computer (`MacCard`, the checks
from `/api/setup`, and Notifications: a test of the Mac's (`notifyMac` in `src/lib/server/notify.ts`, which macOS shows as Oddboro's in the app and as Script Editor's from the repo) with the way to System Settings if it does not show, and, outside the app, the browser's for the Desk, with buttons that install Claude Code or start its sign-in
through `/api/setup/claude`; the owner moves on with Next), their name, Your Claude (`ClaudeCard`: a Claude plan tab with the account Claude Code is signed in to, from `claude auth status`, and Switch account, or an API key tab; a model picker in both. Sonnet cannot draw looks or design offices: `canDraw()` in `claude.ts` refuses them, and the later cards offer only the ready-made managers and Main Street; the model,
or an API key kept in the keychain; `src/lib/server/claude.ts` passes both to
every run), Other AI tools (`ToolsCard`, item 18: Grok, Codex and Gemini as
this system offers them, each with its install and sign-in; the card is skipped where
no other tool is offered), the Office Manager (`ManagerCard`: four ready-made ones from
`GET /api/onboarding`, or one described and drawn by `/api/looks` while the
owner carries on), the space (`SpaceCard`: Quick is Main Street, the default; Custom (1-2 minutes) is
a description or a chip, and starts the design job), New Altitude
(`AccountCard`, an optional sign-in to the owner's account, with Skip; see "A
New Altitude account"), New Altitude personas (`PersonaCard`, only when the
account is offered one: each persona's portrait, New Altitude's disclosure and
Add; see "A New Altitude persona as an Odd"), Help fix Oddboro
(`DiagnosticsCard`, only when the office has somewhere to send reports: Send
reports or Don't send, each kept at once; Next works without an answer, and the
Desk asks once the office is open), and Open the office. `POST /api/onboarding` keeps the time zone, finishes the
welcome, hires the manager (`hireManager`), writes their hello into their chat
(each ready-made manager's `hello` in `managers.ts`, in their own voice; a
described one gets `customHello`),
adds each persona granted on its card right after the manager
(`installGrantedPersonas`; one that fails is told to the page and never fails
the welcome), and tells the design job to move in when it is done. The hello asks three questions, each skippable
with its default said: what the office should help them get done (the manager
offers an answer as a goal), how much to do without checking with them (until
they say, the office checks before anything leaves it), and everything or
only what needs them (until they say, only what needs them, plus the daily
report). The manager keeps each answer about how the office works as a lesson
for every Odd. No run wrote the hello, so `sayInChat` marks it `told` and the
manager's first chat is told it said it (item 9). Then the reveal
(`src/lib/floor/reveal.ts`) plays on the page's own floor. A drawn office waits
behind a "Building the layout" card (tiles laid in a loop, the design's progress
line, a bar of pieces drawn) until the job's `done`, so it goes up the way it
will look, never on library stand-ins. A described manager still drawing keeps
a card up ("Drawing Rosa") while the office goes up behind it: the drawn art
goes in the atlas, `Floor.swap` puts the office in place with every part hidden, and
`raise` chalks the rooms, lays the floors row by row, raises the walls and drops
the furniture in, room by room, lamps on. Once the manager is ready (at once for
a ready-made one), a bus drives up the street, and they walk from the bus stop
to the owner's desk, where their card opens on the chat. Skip, under the caption
while they come, sends the bus off and puts them at the desk at once
(`StaffActor.arrive`). Until the office has
moved in, the page keeps the floor it raised (`landing`) rather than reloading on the move. "Good Morning, Neighbor" opens the music over it. The music is a player (`music.svelte.ts`, one per page) over the 25 tracks in `static/audio/`, named in `tracks.ts`: a random order that skips the last few played, loved tracks twice as often, passed ones never, repeat one, and the Mac's media keys. Later visits play only if the owner left it on. Every choice is per viewer in localStorage. The tracks are AAC with every tag stripped but the title, since Safari won't play Opus, and LICENSE-ASSETS keeps the folder out of the Apache license. The bottom of the start panel (`FloorControls.svelte`), there during the first run and after, holds the player on the start side (the track's name, then love, back, play, next, repeat, pass, then the seek bar with the time, and a speaker that opens a vertical volume slider with a mute). A hairline separates it from the end side, where the light and, under it, the zoom stack at the same width. The light: Auto follows the office clock, the sun and the moon hold the floor at day or night for that viewer. Then the zoom: Fit shows the whole office in the room the panels leave (and stops following an Odd), and minus and plus step a crisp level out or in (`Floor.zoomBy`), gliding. A plan that fails twice raises the sample instead.

## The office's address

`https://local.oddboro.com` (a public DNS record points it at 127.0.0.1),
falling back to `oddboro.localhost` where a network's DNS drops that answer.
The desktop app (`ODDBORO_APP`) skips all of this: it opens the office in its own
window, onboarding shows no address step, and it never touches Caddy.

Caddy takes ports 80 and 443 and hands everything to the office on 4500
(`src/lib/server/address.ts`, the Address row on the first card). With nothing on
port 80 the office runs its own Caddy as `com.oddboro.caddy`, downloading it
from Caddy's releases (checked against the published checksum) if the Mac has
none. With the owner's Caddy on port 80 it adds two routes and a certificate
policy through Caddy's admin API (127.0.0.1:2019, with an explicit origin, which
that API wants), touches none of their files, and adds them again when the
office starts and when a page loads (`keepAddress`). With anything else on port
80 it stays at `:4500`; on Windows that is often http.sys, Windows' own web
server. On Windows the office's Caddy listens on 127.0.0.1 only, so the
firewall never asks. HTTPS uses Caddy's own authority; the Mac trusts it once,
with the owner's password in the macOS dialog (Make it secure; Windows asks in
its own dialog and adds it to the owner's list, with no admin), because a
browser shows notifications only on a secure page. Firefox keeps its own trusted
list, and the card says so to Firefox users. `npm run setup` opens the secure
address when it answers and is trusted.

## Who the office answers

Other pages open in the owner's browser can send requests to the office too,
so `guardOffice` (`src/lib/server/owner-page.ts`, the first step of the
server's `handle` in `hooks.server.ts`, before Sentry's) checks every route and API request before the route sees
it, in every mode. SvelteKit's own check covers form posts only. In the
built server it also refuses a POST, PUT, PATCH or DELETE with no content
type, since there the server takes its own origin as https; so `call()`
(`src/lib/ui/api.ts`) says JSON on every one, with a body or without. Files built
into the page (scripts, styles, images) are served before the check.

1. The Host must be one of the office's names, whatever the port: 127.0.0.1,
   [::1], localhost, the addresses through Caddy (`HOSTS` in
   `src/lib/server/hosts.ts`) and the app's `ORIGIN`. A site that points its
   own name at 127.0.0.1 looks same-origin to the browser, so only the name
   gives it away. A route asked by any other name gets 403.
2. Anything but GET, HEAD and OPTIONS must come from the owner's page
   (`fromOwnerPage`): Sec-Fetch-Site says same-origin, or, with none, the
   Origin names the Host asked, whatever the scheme, since through Caddy the
   page is https and the office http. With neither, 403.
3. The one other client is the app's shell, which reports updates to
   `/api/update` with the token it passed the server (`fromShell` in
   `src/lib/server/update.ts`).
4. `/account/callback` and `/connect/callback` arrive as GETs from the
   owner's browser, sent back by the service's sign-in page, so they pass
   rule 2 with no Origin.
5. Vite's dev server has its own route, `/__open-in-editor`, that opens a file
   in an editor and runs before the handle. `noEditorLaunch` in
   `vite.config.ts` refuses it with 403, always: nothing in the office uses it.

## Diagnostics

Error and trace reports go to Sentry only after the owner's yes.

1. The address is `ODDBORO_DIAGNOSTICS_DSN`, from the environment or `.env`.
   The app's shell passes its own (`apps/desktop/CLAUDE.md`). With none,
   `serverOptions` (`src/lib/server/diagnostics.ts`) returns nothing: the SDK
   never starts, the office never asks, and the relay drops what it gets.
2. The answer is `OFFICE_DIAGNOSTICS` in `.env`: `yes`, `no`, or unasked for
   anything else. `PUT /api/diagnostics` writes it, from the first visit's
   card, the Desk's From Oddboro item and the Setup switch
   (`DiagnosticsSection`). It holds from the next report, with no restart.
   `npm run reset` clears it.
3. The gate: `gated` wraps the SDK's transport and asks `diagnosticsOn()` on
   every send. What leaves has passed the one allow list in
   `src/lib/diagnostics.ts` (`scrubEvent`, `scrubSpan`):
   - An error's message only in a shape code writes (`keptMessage`): an
     engine template with any property key as `[key]`, a system error's code
     and call (`ENOENT open`), a Postgres error's SQLSTATE with its table,
     column and constraint names, or a message Oddboro's code wrote
     (`fixedError` in `@oddboro/ledger/errors`). Every other text leaves as
     `[withheld]`.
   - No address the office reaches. Every outgoing request, to the office
     itself or another service, is named by its method alone, and no span
     keeps `server.address`. A page frame from the office (the host and port
     the page reached the relay on, whatever the scheme, or `HOSTS` on its
     default port) keeps its origin, and its path under `/_app/`; any other
     URL (another loopback port, a host, a browser extension, `file:`,
     `blob:`) keeps its file name alone. Not the scheme: the built office
     sees its own URL as https, since adapter-node reads no `ORIGIN`, while
     the desktop window loads it over http.
   - File paths by `reportPath`: relative to Oddboro's own code, from
     `node_modules/` on inside a package, the file name alone anywhere else
     under the home folder, and whole outside it. The shell's `report_path`
     is the same rule.
   - None of what the SDK collects by default (`DATA_COLLECTION`).

   Every span container tells Sentry never to infer an address
   (`infer_ip: 'never'`), and `fitDoor` cuts an envelope to the door's size
   limit.

4. The relay: the page's SDK (`hooks.client.ts`) posts to
   `/api/diagnostics/envelope`, never to Sentry. The route scrubs each event
   and span again and sends them through the office's own transport, so the
   gate applies to them too.
5. Traces: about one in ten (`TRACE_SAMPLE_RATE`). `QUIET_ROUTES` are never
   traced: `/api/events` stays open as long as the page, `/api/update` is the
   shell's poll, and the relay would trace itself.
6. `instrumentation.server.ts` loads before the server, so
   `src/lib/server/diagnostics.ts` and `src/lib/server/hosts.ts` import
   nothing that brings in Postgres.

## A New Altitude account

An owner who already has a New Altitude account can sign in to it, on the
first visit (`AccountCard`) or in Setup (`AccountSection`); both show
`AccountSignIn.svelte`. The office works without it; only the personas New
Altitude offers use it (see "A New Altitude persona as an Odd").

1. The site is `ODDBORO_ACCOUNT_SITE`, `https://members.newaltitude.ai` when
   unset. The issuer comes from that site's protected resource document; the
   resource sent is always the configured site.
2. `src/lib/server/account.ts` signs in through the connectors' provider
   (`oauth.ts`) as its own public client, asks for `profile` and `personas`
   (the personas New Altitude offers, `persona.ts`), and returns to
   `/account/callback`. It asks `/api/me` once and keeps only the
   id, name and email. Everything lives in one secret,
   `new-altitude-account:oauth`, in the system's secret store, never in the
   settings file. With no store, Sign in refuses before any request, and a
   store that cannot write gets the same words. Only the newest Sign in's
   page can finish, and none while a sign-in holds tokens; the same holds
   for each persona's sign-in. A persona's sign-in returns to the same
   callback, and its page stays good when the account's sign-in starts
   again. An old page says to start again from Oddboro. Any failure after
   the tokens are kept signs out, so no tokens stay without an account. If
   the store cannot keep them, nothing is kept here, and the grant lapses at
   New Altitude on its own.
3. The states (`AccountStatus` in `src/lib/account.ts`): `in` while the
   sign-in holds tokens, `expired` once New Altitude refused a refresh (the
   account is kept, so the page can say whose it was), `out` with none.
4. Every change goes to every open page on the live line as
   `{ type: 'account', status }`; the page keeps it in `account.svelte.ts`.
   `GET /api/account` checks it live, refreshing only a token close to
   running out. `POST` starts a sign-in. `DELETE` signs out: it ends each persona's
   sign-in (`endPersonaGrants`), then revokes the
   refresh token at New Altitude, then removes the secret even when New
   Altitude cannot be reached. The page makes these requests only through
   `src/lib/ui/account-actions.ts`. Its Switch account, shown with the
   signed-in line, signs out and then starts a new sign-in, so a Cancel or a
   refused start leaves the office signed out.
5. `accountToken()` is the one way to get the account's token.
   `npm run reset` leaves the sign-in, as it leaves connector sign-ins.

## A New Altitude persona as an Odd

New Altitude may offer a signed-in account a persona as an Odd. The owner
adds it on the first visit (`PersonaCard`) or in Setup's Account section
(`PersonaOffer.svelte`); it then works like any Odd, except that it speaks in
the persona's voice.

1. The package. `GET /api/personas` asks New Altitude's `/api/personas/odds`
   with the account's token (`syncPersonas` in `src/lib/server/persona.ts`).
   That read calls New Altitude and writes the ledger, so a browser that
   says it comes from another site gets 403, as for an action.
   Each listed persona brings its package: name, role, remit, hello, look,
   portrait and parts, the same in every office. `persona-package.ts` checks
   its shape, then the look checks a drawn look passes. Every part is named
   `<slug>-<name>`, in the package and in its drawing (`checkPart`), and
   replaces only a part drawn for an Odd of the same persona; a built-in
   part or one drawn for any other Odd refuses the package. An account
   signed in with `profile` alone answers
   `rescope`, read from the kept scope with no request, and the offer shows
   Sign in again, which signs out and in, since a refresh never widens a
   grant.
2. The grant. Add and Reconnect (`POST /api/personas/[slug]`) run the
   persona's own sign-in for its door, `new-altitude-persona-<slug>:oauth`
   with scope `stream`, through the account's provider and callback.
   Add reads New Altitude's list first: a persona it does not offer now
   gets 404 and no sign-in. A kept sign-in whose refresh New Altitude did
   not answer gets 502 and no page, since that page could never finish.
   Disconnect (`DELETE`) ends it and makes the Odd quiet. Signing out ends
   every persona's sign-in. The secret store cannot list its entries, so
   each write of a persona's sign-in also names the persona in
   `new-altitude-personas:granted` there, and ending one takes the name out
   once its secret is gone. Sign-out ends each sign-in that list or a
   persona Odd names, whatever New Altitude lists. A door that turns the
   sign-in's token down drops its tokens, so Reconnect opens New Altitude's
   page again instead of refreshing a sign-in the door refuses.
3. The install. `installPersona` hires it with the package's look and
   portrait (`hirePersona` in `@oddboro/ledger`), saves its parts, and says
   its hello with `sayInChat`. An install it refuses ends that persona's
   sign-in, since nothing here would use it. Nothing is drawn.
   `staff.package` holds the slug, the version, New Altitude's disclosure
   sentence and `quiet`; it is null for every other Odd. A granted persona
   in an office not yet welcomed joins right after the manager. The page
   keeps it off the floor until the manager has walked in, then it walks on
   (`firstRun` in `+page.svelte`).
4. Hands, then voice. `run()` in `staff.ts` hands a persona Odd's chat, job
   or follow-up to `personaRun` (`persona-run.ts`). Its own coding tool runs
   first, as its hands, with `personaDesk` as its job description, and only
   its tool steps reach the page. Then the door answers: `persona-door.ts`
   sends the owner's words and the hands' report, cut to fit 4,000
   characters, to `<issuer>/<slug>/stream`. A chat sends its earlier answered
   exchanges and keeps the door's session in the Odd's folder. Any answer but
   `answered` returns a one-line note and the report, so no work is lost. A
   follow-up keeps the hands' Outcome line after the voice. Every other
   run, such as a draft or a follow-up that reads the owner's no or edit
   for a lesson, stays with the hands. Every word sent to the door is in
   `persona-run.ts`, and every detail of the door's address and answer in
   `persona-door.ts`.
5. Quiet. `quiet` is `access` (New Altitude stopped offering it), `grant`
   (its sign-in ended) or `signed-out`. A quiet Odd answers its line at once
   and runs nothing; its chat shows the line and one button
   (`PersonaQuiet.svelte`): Check again for `access`, Reconnect for the
   others.
6. Sync. `syncPersonas` runs when the office starts, on each
   `GET /api/personas` and on Check again, never on a timer. A newer package
   version replaces the name, role, remit, look, portrait and the package's
   own parts; the hello is not said again. A persona no longer listed goes
   quiet for `access`, and listed again it lifts that quiet only. An
   unreachable New Altitude changes nothing. A listed persona whose sign-in
   is kept with no Odd, as after a restart before Open the office, joins
   this run's sign-ins, so Open the office installs it.
7. The page. Every change reaches open pages on the live line as
   `{ type: 'persona', slug, joined, problem? }`. `persona-offers.svelte.ts`
   keeps one map for the page, so the offer and a quiet Odd's chat show the
   same wait or problem. The chat prints the disclosure above the messages.
   `hand_off` tells a colleague that a persona's replies come from New
   Altitude, so what is handed to it leaves this computer.

## Running it always

1. `npm run service:install -w apps/office` installs a login service
   (`scripts/office-service.ts`, label `com.oddboro.office`): launchd on a
   Mac, a systemd user unit on Linux, a Task Scheduler task on Windows
   (`@oddboro/ledger/platform`). On Linux it starts with the desktop session,
   so what it runs can open windows. On a Mac it runs the office under
   `caffeinate -s`, so the Mac stays awake on power. On Windows the task runs
   a batch loop in `%LOCALAPPDATA%\Oddboro\services` under
   `conhost --headless`, so no window shows, and needs no admin. Every way, it
   restarts the office if it stops. Logs go to
   `~/Library/Logs/oddboro-office.log` on a Mac,
   `~/.local/state/oddboro/office.log` on Linux and
   `%LOCALAPPDATA%\Oddboro\Logs\office.log` on Windows.
2. `npm run service:uninstall -w apps/office` removes it. Stop it before
   running `npm run dev`, since both want port 4500.
3. The office starts its own database, so nothing else has to. A database in
   Docker needs Docker Desktop to start at login. Ollama must run for search
   by meaning; without it the ledger falls back to words.

## Where things live

| Path                                  | What it holds                                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/lib/floor/`                      | The PixiJS floor and the Odds on it                                                                   |
| `src/lib/staff/roster.ts`             | The Odd shape, hiring looks, and the label for each activity                                          |
| `src/lib/ui/`                         | The card and its tabs, the Desk, the Ledger, hiring, chat                                             |
| `src/lib/server/`                     | Staff runs, office runs, looks, the job clock, events, keychain                                       |
| `src/routes/api/`                     | One folder per thing the page reads or changes                                                        |
| `src/lib/server/office-design.ts`     | Drawing an office from the owner's words, and where Odds move to                                      |
| `src/lib/server/design-job.ts`        | The drawing as a job on the server, which pages follow                                                |
| `src/lib/ui/onboarding/`              | A new owner's first visit: the cards, the reveal's story, the music                                   |
| `src/lib/floor/reveal.ts`             | The office going up beat by beat, and the bus                                                         |
| `src/lib/diagnostics.ts`              | What a report may carry, and when a trace is taken: the server's, the relay's and the page's one rule |
| `src/lib/server/diagnostics.ts`       | The SDK's options and the gate every report passes, with the owner's answer                           |
| `src/lib/server/account.ts`           | The New Altitude sign-in: start, callback, refresh, sign out                                          |
| `src/lib/account.ts`                  | The account and its states, shared by the server and the page                                         |
| `src/lib/server/persona.ts`           | The personas New Altitude offers: sync, each persona's sign-in, install, Disconnect                   |
| `src/lib/server/persona-package.ts`   | A persona's package checked before the office trusts it                                               |
| `src/lib/server/persona-run.ts`       | A persona Odd's run: its hands, then its voice, and every word sent to its door                       |
| `src/lib/server/persona-door.ts`      | The persona's door on New Altitude: its address, scope, what a turn sends and what comes back         |
| `src/lib/persona.ts`                  | The offers, the quiet reasons and their lines, shared by the server and the page                      |
| `src/lib/ui/persona-offers.svelte.ts` | The page's offers and each persona's wait or problem, with Add, Reconnect, Disconnect and Check again |
| `src/lib/ui/PersonaQuiet.svelte`      | A quiet persona Odd's line and its one button                                                         |
| `src/lib/server/hosts.ts`             | The office's names through Caddy (`HOSTS`), alone so reporting loads before Postgres                  |
| `scripts/office-service.ts`           | The login service                                                                                     |
| `src/app.css`                         | Tokens. Every colour in the chrome reads these.                                                       |

## Rules for this app

- Imports use `#lib/...` with the file extension. SvelteKit 3 replaced `$lib`
  with Node subpath imports, declared in `package.json`.
- Zoom follows the wheel or pinch as it happens, then settles on the next
  level the way the gesture went (`settleFrom`), where every art pixel covers
  whole device pixels (half steps on a Retina screen). A small scroll takes one
  step and never springs back; a nudge under 2% stays put. The floor only
  rests at those levels.
- The camera never shows past the grounds' edge: the farthest zoom out still
  fills the screen, and panning stops at the edge.
- The floor draws only when something on screen changed. Pixi's own
  every-frame draw is off. Anything that changes the picture outside the
  camera calls `floor.invalidate()`. Name tags and room signs move in
  `floor.onRender`, never in the ticker.
- Room signs scale with the floor: laid out at 11px for 1.5x (`SIGN_ZOOM`, the
  usual fit), centred on the back wall's top band, and cut short with an
  ellipsis past the room's width. They keep the same size and place against
  the room at every zoom, and hide below 1x, which only a preview reaches. The owner renames a room with the pencil on its sign
  (`PUT /api/rooms`); the names live in the ledger's `room_names` table and
  reach the page with the office state. Code that shows a room name reads
  the page's `world`, which has them applied, not `office.world`.
- The world's sprites are filed into 16-tile blocks, and a draw shows only
  the blocks on screen. A bigger office costs the same to draw as this one.
  A new kind of world sprite goes through `addToBlock`.
- Animated sprites are plain sprites whose frames the ambient clock turns, 12
  times a second. Never use `AnimatedSprite`: it ticks every frame on its own.
  An icon over an Odd (`pop`) turns in the Odd's own `update`, like its walk,
  because it moves with the Odd and lasts about 1.5 s; the ambient clock's
  sprites stand still in their blocks.
- Street lamps follow the daylight: the floor puts them out from about 6:50 am
  to 6:15 pm and lights them otherwise (`DAYLIGHT_LAMPS` in
  `src/lib/floor/engine.ts`). A lamp the owner switched off stays off.
- The camera never jumps. Every move it makes (the overview, following a
  Odd, a swap to another world) glides through `glideTo` in
  `src/lib/floor/engine.ts`; only the first frame and a resize place it at
  once. A swap keeps the owner's view on the street and glides out only if the
  new building would not fit. Dragging or zooming takes the camera back. Past the grounds the floor lays a meadow (`MEADOW` tiles a side) with the street carried out to its edges and trees scattered over it (`countryside` in `engine.ts`), so the camera can pull back far enough to fit the whole office between open panels (`viewCover`).
- No CSS animation loops forever. Play it once, or only while something is
  happening, like the dots while a reply loads.
- The office keeps the owner's time zone (`zone()` from `@oddboro/ledger/time`),
  never the screen's. There is no time slider and there are no office hours:
  Odds work around the clock.
- A new owner lands on the first visit (`src/lib/ui/onboarding/`) until they
  press Open the office. The plate's Setup link opens the Setup window
  (`src/lib/ui/Welcome.svelte`) after that.
- Never show demo numbers as real ones. The card's back shows only measured
  usage.
- A tool connects at read or write: read gets the tools the owner ticked as
  read-only, write gets every tool, and only while the Odd holds Act.
- A headless Odd cannot reuse Claude Code's own MCP sign-ins (it reports
  `needs-auth`). That is why the office runs OAuth itself.
- Charts use LayerChart. Its tooltip reads `--color-surface-*`; set them from
  the office tokens on the chart's wrapper.
- Render an Odd's text with `Markdown.svelte`, never `{@html}` of anything else.
- Night is a per-sprite tint, not a multiply blend. PixiJS 8 multiply
  darkened the whole scene when its source was a render texture. The preview
  renderer in `packages/world` still multiplies, so its night renders differ
  a little from the office.
- In dev, `window.floor` holds the `Floor` for poking at from the console.
