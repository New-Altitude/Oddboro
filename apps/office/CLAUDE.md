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
   and otherwise it wanders between work and breaks. A free Odd's own
   clock starts when it arrives, for a random stay that depends on the
   activity (`STAY` in the page), so Odds never all get up at once. An
   Odd on a job stays at it until the job ends. While an Odd walks, its
   tag reads "→ Room". Odds never go home.
   A spot holds one Odd at a time, from the moment one sets off for it:
   every move (the schedule, the Send tab, a chat) skips held spots. A chat
   brings an Odd to the owner's desk, or outside the owner's door when someone is
   already at the desk. The Send tab shows a full place as taken, by whom.
5. `/api/events` is the page's one live line: Postgres NOTIFY (fired by
   triggers on every table, whichever process wrote the row) plus who is
   running a job (`src/lib/server/events.ts`). The page refetches
   `/api/office` on a change. Nothing polls.
6. Two full-height panels flank the floor (`src/lib/ui/SidePanel.svelte`).
   Each resizes by dragging its inner edge (or the arrow keys on it), and
   remembers its width per viewer. The start side is the office plate (name,
   the clock, Setup, and the Odds, Desk, Goals, Ledger, Hire and Office buttons),
   which opens into a bar of windows (`src/lib/ui/windows.svelte.ts`): the
   Odds list, the Desk, the Goals, the Ledger, each hire and each open file is a tab.
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
   Odd on it; Iterate sends it back with the owner's words and the new version
   arrives linked to the old; a task an Odd gave them, marked done, goes back to that Odd to
   pick up from (an intake becomes the hire it was for). A report has Reply and
   Read: feedback is a reply in its writer's chat, not a form on the desk. Opening
   any item selects it in its sender's chat on the end side. Selecting text in a report offers Chat (`src/lib/ui/SelectToChat.svelte`):
   the owner picks any Odd, and its chat opens with the passage quoted as a
   draft (`chat-about.svelte.ts` carries it to `ChatPanel`). Each of those is a follow-up (`src/lib/server/follow-ups.ts`,
   started from `hooks.server.ts`, woken by changes to `follow_ups`). Its reply
   ends in an outcome line; every outcome goes in the ledger, a failure always
   goes on the desk, and a success only when the owner ticked "Report when done". A
   restart mid-run marks it failed rather than run it twice. A proposed hire
   has "Open hire window" in place of Approve; hiring from it approves it,
   copies the owner's intake into the hire's `notes/intake.md` and links it to
   the goal it was proposed for. Every hire then gets going alone (`firstDay`):
   its first job comes with the hire, its panel opens on Chat while it walks
   in, it says hello there in the session later chats resume, and a
   `first_day` follow-up starts its work at once: questions the intake left
   open go on the desk as a task, missing tools as an access ask, otherwise the
   first real piece of work, whose result goes on the desk. A goal ask (the manager heard one in chat) has
   "Set the goal". A plan ask lists its parts, each ticked: Odds already here
   taking a part, with a new job or a change to one, and hires. Approving takes
   the ticked parts (`approvePlan`): Odds already here start at once, each hire
   becomes a hire ask the page opens in its own hire window, and the owner's
   steps land as a task.
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
9. The Odd's panel has **Chat, Card, In progress, Jobs and Access** tabs,
   and opens on Chat. Send is a button on the card. The chat stays mounted
   while the panel is open, so a
   reply survives switching tabs or collapsing. The chat shows every ask, task
   and report the Odd put on the desk, where it landed (`chatLog` merges
   `deliveries()` into `chat.jsonl`), with where each stands now. A click opens
   it on the start side: on the Desk while it waits, else a report in its own
   window (`ReportView.svelte`). Reply under one sends the next message about
   it: the run gets the item in full, and a reply about a report marks it read
   and goes in the ledger as the owner's feedback (`replyToReport`). Each
   message also tells the session what the Odd delivered since it last
   replied, the way it does for pokes. The owner's line is stamped when sent,
   so what lands during a reply sits between the two. Its input grows with the text
   up to 60% of the chat, and the bar above it drags it taller; that height is
   remembered per viewer. Every run's system prompt opens with "Who you work
   for" (`whoFor` in `staff.ts`): the owner, `data/people.json` when it
   exists, the Odd's own `notes/intake.md` when it has one, and the active
   goals it serves with its part and the latest progress. An Odd sees only
   the goals it serves. Prompts never name the owner: they say `{owner}`, and
   `run()` in `staff.ts` and `runAsOffice` fill in `ownerName()` for this
   install. `src/lib/server/staff.ts` runs `claude -p` on the owner's login for chats,
   job runs, follow-ups and drafts. A chat never waits: it resumes the
   Odd's one chat session, so only a second chat does. Jobs, follow-ups
   and drafts each start a fresh session and run side by side, up to three
   per Odd (`AT_ONCE`); the next waits for a slot. Each one is listed in
   `inProgress` (the `Work` shape in `src/lib/staff/work.ts`) with what it
   is, when it started, and the tool it is using now. The list reaches the
   page with each `working` event; only work starting or ending reloads the
   card's tabs. Every run gets five file
   tools, reads only its own folder, the owner's data folder and Claude
   Code's sessions folder for its own folder, where long
   tool results land (`readable` in `staff.ts`; Read rules cover Glob and Grep,
   and `dontAsk` turns down every other path). Deny rules beat any allow,
   the owner's own Claude Code settings included, so `unreadable` names what
   stays shut whatever else allows it: `~/.ssh`, `~/.aws`, `~/.gnupg`,
   `~/.config`, `~/Library`, `~/.claude.json`, `~/.google_workspace_mcp` (where
   that MCP server keeps its sign-ins for other apps on the Mac), everything
   in `~/.oddboro` besides `staff/` and `data/`, every other
   Odd's folder, and everything in `~/.claude` besides this run's sessions.
   A run writes only inside `~/.oddboro/staff/<id>/`, and gets no skills or
   plugins, the office's own MCP server (`packages/ledger/src/mcp.ts`) with
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
   working. Hosted servers sign in with
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
    off).
11. The job clock (`src/lib/server/jobs.ts`, started from `hooks.server.ts`)
    keeps one timer for the soonest due job, resets on any change to the jobs
    table, and looks at the time at least every ten minutes because macOS
    stops timers in sleep. A run's result goes in the ledger, and on the owner's
    desk as a report when the job says so. Each run records its trigger:
    `schedule` when the timer started it, `manual` when the owner pressed Run now.
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
    stage and the time. Hiring grants no tools: access goes through the
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
    other file opens in its own window. While an attached file has unsaved
    edits, the desk's finishing buttons wait and leaving the item asks first.
    Files an Odd names in any text it writes open as a window of
    their own (`src/lib/ui/FileViewer.svelte`, the same editor in a window): rendered or editable, saved
    only by Save, with Back asking first when there are unsaved changes. `Markdown.svelte` turns a full path, or a path
    inside the writer's folder in code or a link, into the link.
    `src/lib/server/files.ts` serves only text files that already exist inside
    that Odd's own folder, refuses a save if the Odd changed the file
    since the owner opened it, and records each save in the ledger.
14. **Looks.** `src/lib/server/looks.ts` draws a person (`drawLook`): one
    office run with the parts library, the swatches, the body, two example
    parts and two example portraits in the prompt. It checks every piece
    (`problemsWith`) and retries once with what was wrong; a failed reply from
    words alone is kept in `~/.oddboro/office/last-look.md`. `/api/staff/[id]/look` and
    `/portrait` serve a hired Odd's frames and portrait, cached per
    version, and PUT on `look` saves a redraw from the card's **Redraw look**.
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
    on top there, and the cursor shows a hand over one. The page flips it at
    once and `PUT /api/switches` keeps it in the ledger's `switched_off`
    table, whose trigger brings every open page along. Off, the prop shows
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
`lotOf` from `@oddboro/world`), and `Onboarding.svelte` runs eight cards in
the start panel, titled "{name}'s Lot" until the office stands on it. The
command center's buttons and tabs appear there once the first run is over, so
the owner meets the panel first. The cards: Your computer (`MacCard`, the checks
from `/api/setup`, and Notifications: a test of the Mac's (`notifyMac` in `src/lib/server/notify.ts`, which macOS shows as Oddboro's in the app and as Script Editor's from the repo) with the way to System Settings if it does not show, and, outside the app, the browser's for the Desk, with buttons that install Claude Code or start its sign-in
through `/api/setup/claude`; the owner moves on with Next), their name, Your Claude (`ClaudeCard`: a Claude plan tab with the account Claude Code is signed in to, from `claude auth status`, and Switch account, or an API key tab; a model picker in both. Sonnet cannot draw looks or design offices: `canDraw()` in `claude.ts` refuses them, and the later cards offer only the ready-made managers and Main Street; the model,
or an API key kept in the keychain; `src/lib/server/claude.ts` passes both to
every run), the Office Manager (`ManagerCard`: four ready-made ones from
`GET /api/onboarding`, or one described and drawn by `/api/looks` while the
owner carries on), the space (`SpaceCard`: Quick is Main Street, the default; Custom (1-2 minutes) is
a description or a chip, and starts the design job), New Altitude
(`AccountCard`, an optional sign-in to the owner's account, with Skip; see "A
New Altitude account"), Help fix Oddboro
(`DiagnosticsCard`, only when the office has somewhere to send reports: Send
reports or Don't send, each kept at once; Next works without an answer, and the
Desk asks once the office is open), and Open the office. `POST /api/onboarding` keeps the time zone, finishes the
welcome, hires the manager (`hireManager`), writes their hello into their chat
(each ready-made manager's `hello` in `managers.ts`, in their own voice, asks
for goals and lets the owner skip them; a described one gets `customHello`),
and tells the design job to move in when it is done. Then the reveal
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
`AccountSignIn.svelte`. Nothing in the office needs it.

1. The site is `ODDBORO_ACCOUNT_SITE`, `https://members.newaltitude.ai` when
   unset. The issuer comes from that site's protected resource document; the
   resource sent is always the configured site.
2. `src/lib/server/account.ts` signs in through the connectors' provider
   (`oauth.ts`) as its own public client, asks for `profile` alone, and
   returns to `/account/callback`. It asks `/api/me` once and keeps only the
   id, name and email. Everything lives in one secret,
   `new-altitude-account:oauth`, in the system's secret store, never in the
   settings file. With no store, Sign in refuses before any request, and a
   store that cannot write gets the same words. Only the newest Sign in's
   page can finish, and none while a sign-in holds tokens. Any failure after
   the tokens are kept signs out, so no tokens stay without an account. If
   the store cannot keep them, nothing is kept here, and the grant lapses at
   New Altitude on its own.
3. The states (`AccountStatus` in `src/lib/account.ts`): `in` while the
   sign-in holds tokens, `expired` once New Altitude refused a refresh (the
   account is kept, so the page can say whose it was), `out` with none.
4. Every change goes to every open page on the live line as
   `{ type: 'account', status }`; the page keeps it in `account.svelte.ts`.
   `GET /api/account` checks it live, refreshing only a token close to
   running out. `POST` starts a sign-in. `DELETE` signs out: it revokes the
   refresh token at New Altitude, then removes the secret even when New
   Altitude cannot be reached. The page makes these requests only through
   `src/lib/ui/account-actions.ts`. Its Switch account, shown with the
   signed-in line, signs out and then starts a new sign-in, so a Cancel or a
   refused start leaves the office signed out.
5. `accountToken()` is the one way to get the account's token.
   `npm run reset` leaves the sign-in, as it leaves connector sign-ins.

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

| Path                              | What it holds                                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/lib/floor/`                  | The PixiJS floor and the Odds on it                                                                   |
| `src/lib/staff/roster.ts`         | The Odd shape, hiring looks, and the label for each activity                                          |
| `src/lib/ui/`                     | The card and its tabs, the Desk, the Ledger, hiring, chat                                             |
| `src/lib/server/`                 | Staff runs, office runs, looks, the job clock, events, keychain                                       |
| `src/routes/api/`                 | One folder per thing the page reads or changes                                                        |
| `src/lib/server/office-design.ts` | Drawing an office from the owner's words, and where Odds move to                                      |
| `src/lib/server/design-job.ts`    | The drawing as a job on the server, which pages follow                                                |
| `src/lib/ui/onboarding/`          | A new owner's first visit: the cards, the reveal's story, the music                                   |
| `src/lib/floor/reveal.ts`         | The office going up beat by beat, and the bus                                                         |
| `src/lib/diagnostics.ts`          | What a report may carry, and when a trace is taken: the server's, the relay's and the page's one rule |
| `src/lib/server/diagnostics.ts`   | The SDK's options and the gate every report passes, with the owner's answer                           |
| `src/lib/server/account.ts`       | The New Altitude sign-in: start, callback, refresh, sign out                                          |
| `src/lib/account.ts`              | The account and its states, shared by the server and the page                                         |
| `src/lib/server/hosts.ts`         | The office's names through Caddy (`HOSTS`), alone so reporting loads before Postgres                  |
| `scripts/office-service.ts`       | The login service                                                                                     |
| `src/app.css`                     | Tokens. Every colour in the chrome reads these.                                                       |

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
