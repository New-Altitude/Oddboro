# AGENTS.md

This file points to the rules. It is not the rules. Read `CLAUDE.md` at the
repo root before doing anything, then the `CLAUDE.md` in the directory you are
working in.

Codex reads `AGENTS.md` and Claude Code reads `CLAUDE.md`. Keeping one copy of
the rules means they cannot drift apart. If you are about to add a rule here,
add it to `CLAUDE.md` instead.

## Read first

- **`CLAUDE.md`** at the root. Hard rules, layout, commands, and the index of
  context files.
- **`docs/decisions/`**. One file per decision. Grep it before planning a
  change: `grep -ril <keyword> docs/decisions/`.
- **`docs/code-standard.md`**. The rules code is written to and a pull request is
  reviewed against, Q1 to Q12.
- **The `CLAUDE.md` in your directory.** These are not loaded for you
  automatically. Open them.

## The rules that cost the most to break

1. No commits or pushes without the owner saying so.
2. No Odd sends, posts, schedules, accepts or deletes anything outside the
   office without the owner's yes on that exact action.
3. The web is Svelte and SvelteKit only.
4. No em-dashes anywhere.
5. Write for a person: answer first, plain words, one action per step.

## Before you call it done

```sh
npm run lint
npm run check-types
npm run format:check
```

All three at zero. A change to setup (onboarding or the Setup window) also
gets a pass on a Mac, Linux and Windows: hard rule 14 in `CLAUDE.md`.
