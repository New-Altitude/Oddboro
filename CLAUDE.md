# Oddboro platform

The monorepo behind the owner's virtual office. AI workers, called Odds, work
on a pixel-art floor they can watch. Where an Odd stands is what it is doing.
Turborepo and npm workspaces, SvelteKit for the web, PixiJS for the floor,
Postgres with Drizzle and pgvector for the office's records.

This file carries hard rules, layout, commands and pointers. Nothing else.
Decisions live in `docs/decisions/`, and the reasons behind each rule in
`docs/hard-rules.md`.

## Hard rules

Each rule's reason is in `docs/hard-rules.md`, under the same heading.

1. **Write for a person.** Answer first, plain words, short sentences. When
   the owner has to act, numbered steps, one action each. This covers docs, code
   comments, commit messages, and everything an Odd says to the owner.
2. **No em-dashes anywhere.** Enforced by `scripts/check-voice.ts`, which also
   fails on stock machine-written phrases.
3. **The web is Svelte and SvelteKit only.** No React, Vue or any other UI
   framework. PixiJS draws the floor because it is a renderer, not a
   framework. Enforced by `scripts/check-stack.ts`.
4. **Nothing leaves the office without the owner's yes.** No Odd sends, posts,
   schedules, accepts or deletes anything outside the office unless the owner
   approved that exact action, or gave that Odd write access to the tool
   it acts through and the Act level to use it. Drafting is always allowed.
5. **No commits or pushes without the owner saying so.**
6. **Logical properties only.** `ms`, `me`, `ps`, `pe`, `start`, `end`, never
   left or right. Enforced by `scripts/check-directions.ts`.
7. **Every colour on the floor comes from the palette.** Sprites draw from
   `packages/sprites/src/palette.json`, and the page chrome reads the tokens
   in `apps/office/src/app.css`.
8. **Spaces are data.** A room is a JSON stamp and an office is a JSON floor
   plan. Adding a space never needs engine code.
9. **Family data never reaches a tracked file.** People and family data
   live in the gitignored `data/` folder. Which AI tool an Odd runs on is
   the owner's choice per Odd. Enforced by `scripts/check-private.ts`.
10. **Every `CLAUDE.md` is named in its nearest ancestor `CLAUDE.md`.**
    Enforced by `scripts/check-context-index.ts`.
11. **Decisions are one file each in `docs/decisions/`, and never provisional.**
    Undecided things stay out of the repo. Enforced by
    `scripts/check-ledger.ts`.
12. **Zero is the only number** for lint, type-check and prettier output.
13. **The simplest, lightest approach wins.** Pick the one with the fewest
    moving parts and the least work at run time. Work happens when something
    changes, never on a loop: nothing redraws, polls or animates forever while
    the screen is still. Every change leaves the code simpler or lighter, or
    says why it could not.
14. **Setup works on a Mac, Linux and Windows.** Every change to onboarding
    (`apps/office/src/lib/ui/onboarding/`), the Setup window and the routes
    they call gets a pass on all three: a test of what the server gives each
    system (`onPlatform` in the office's tests), and a walk through setup on
    each before a release ships it.

## Layout

```
apps/
  office/       The floor. SvelteKit, port 4500. Main Street runs here on the owner's computer.
  site/         The public site, oddboro.com. SvelteKit, port 4501, prerendered to static files.
  desktop/      Oddboro for the Mac, Linux and Windows. A Tauri shell in Rust around the office, on a bundled Node.
packages/
  sprites/      Every piece of art as .px text, the palette, and the compiler.
  world/        Room stamps, floor plans, and the code that turns them into a world.
  ledger/       Postgres: Odds (the `staff` table) and their job descriptions, asks, tasks, access, jobs, and the searchable ledger.
scripts/        The lint guards. Plain Node, no dependencies.
docs/           Decisions, hard rules, the office design, and the backlog.
data/           Gitignored. People and family data. Never tracked.
docker-compose.yml  Postgres 17 with pgvector, on 127.0.0.1 only.
.github/workflows/release.yml  Every merge to main that changes the app redrafts the next release, Mac, Linux and Windows.
.github/workflows/codeql.yml   Code scanning, for only the languages a change touches.
```

## Commands

```sh
npm run setup               # check this computer, start the office, open it in the browser
npm run setup -- --check    # check everything, change nothing
npm run reset               # start over: move the office aside into ~/.oddboro/backups
npm run db:up               # Postgres in Docker, when .env names it instead of the office's own
npm run db:migrate          # apply migrations (the office also does it as it starts)
npm run dev                 # build the sprites, then start the office on :4500
npm run service:install -w apps/office   # run the office at login instead
npm run sprites             # recompile the art after editing a .px file
npm run mark -w @oddboro/sprites  # redraw the mark into every icon and logo file, on a Mac
npm run render -- main-street  # render the Main Street floor to packages/world/out/
npm run lint                # guards, prettier, then each workspace
npm run check-types         # tsc and svelte-check everywhere
npm run format              # prettier write
npm run bundle -w @oddboro/desktop   # build Oddboro.app and the .dmg from apps/desktop/stage
npm run shell -w @oddboro/desktop    # the desktop shell against a running office (ODDBORO_SERVER_URL)
```

## Ports

| App      | Port  | Where                                                        |
| -------- | ----- | ------------------------------------------------------------ |
| office   | 4500  | 127.0.0.1 only                                               |
| site     | 4501  | dev and preview; ships as static files                       |
| desktop  | 4500  | the app's own office; `ODDBORO_PORT` moves it                |
| database | 54329 | 127.0.0.1 only, the office's own; `ODDBORO_DB_PORT` moves it |
| postgres | 5432  | 127.0.0.1 only, in Docker, when `.env` names it              |

## Decisions

Before planning a change, run `grep -ril <keyword> docs/decisions/` and read
what it lists. Follow a live decision or supersede it in place. Never quietly
diverge. How to record one is in `docs/decisions/CLAUDE.md`.

## Context files

- `AGENTS.md`. A pointer for non-Claude agents. Never a second rulebook.
- [apps/CLAUDE.md](apps/CLAUDE.md). One line per app, with its port.
- [packages/CLAUDE.md](packages/CLAUDE.md). One line per package.
- [scripts/CLAUDE.md](scripts/CLAUDE.md). Every lint guard, one line each.
- [docs/CLAUDE.md](docs/CLAUDE.md). Every doc with its status, and the ledger.
