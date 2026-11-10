# Code standard

Every code change here, by a person or an agent, is written to the twelve rules
below, and the pull request's reviewer checks the diff against them. They target
code that passes every check yet makes the next change slow or unsafe: one change
needing edits in many places, too much for a reader to hold in mind, or what must
change hidden. Finding bugs is the other half of a review, not this doc.

- The hard rules in the root `CLAUDE.md` and the live decisions in
  `docs/decisions/` win over this doc. This doc wins over any general standard an
  agent brings.
- What prettier, `npm run check-types` and the guards in `scripts/` enforce is not
  repeated here; their output is zero (hard rule 12).
- The ids Q1 to Q12 stay fixed so findings can be counted. A cut rule's id is
  retired, never reused.

"The PR body" means the pull request's description and its commit messages.

## Rules

### Q1. The change solves the problem, not only its checklist.

**Good.** The diff fixes the problem the PR body names, on every path a person
takes to it (for setup, see hard rule 14). Anything else it changes, the PR body
names with a reason. A fix changes the cause, where behaviour first departs from
what was expected, not where the symptom shows. A symptom patch (a delay that
hides a timing problem, a retry that masks broken logic, a value hardcoded to the
cases seen, extra state that covers for wrong state, a special case around a
flawed design, a check switched off or a test weakened) appears only when an
outside constraint forces it, and the PR body names that constraint.

**Check.** Can the problem still be reached another way (a route, app, system or
error path)? Does the diff change something the PR body does not name, or add a
delay, a retry, a literal that fits only a fixture's cases, or a skipped check?
Does the PR body name the cause?

### Q2. One home per concept, one way per job.

**Good.** Each value, list, condition and set of words is defined once, and code
and tests import or derive it, as they do `LEVELS` in
`packages/ledger/src/access-words.ts` and `AGENTS` in
`packages/ledger/src/agents.ts`. Colours: hard rule 7. A test may write the one
value the change sets as a literal; that is not a copy. A job nearby code already
does one way is done that way; a new way replaces the old everywhere in the same
change, or is not added. A block copied from a sibling (a workflow job, a config
section) differs from its source only where the PR body says so.

**Check.** Grep each new number, key, name or list used as data. Does the diff, in
code or a test, restate or recompute something that exists? Where two places must
differ, does a comment say why?

### Q3. The smallest design that meets the need.

**Good.** Hard rule 13 sets the aim; this is how a diff meets it. No interface,
base class, factory, option or parameter with one implementation, caller or value.
A one-caller helper is fine when it names a step of a longer function. A new
guard, flag, setting or table replaces or merges with an existing one where it
can, without losing what either guarantees. A guard that matches text where it
could check structure (a type, a declaration) is the bigger design. Small means
least total complexity, not fewest changed lines.

**Check.** Count each new function's and option's callers, in the diff and on
`main`. With one caller, does it only forward or rename (inline it), or name a
step (keep it)? Does the PR body say what a new mechanism replaces?

### Q4. Readable without the plan.

**Good.** Names use the code's own words: an Odd, an ask, a task, the desk, a
grant. A function does one thing a reader can name in a sentence. Two adjacent
arguments of one type whose swap changes the result, or a bare `true` or `false`
argument, become a named object or distinct types. New behaviour gets its own
module or component instead of landing in a file over about 1,000 lines.

**Check.** Does each new name and signature say what it does? Could two arguments
be swapped with every check green? Does a new concern land in a file over about
1,000 lines (`wc -l`)?

### Q5. Types say what is true.

**Good.** A closed set of words is a union built from one list, as `Level` is
from `LEVELS`. Input the code did not make (a request body, a tool input, parsed
JSON, a file) gets a type only after code checks its shape, as `parseLevel` does,
or the zod schema on each tool of the office's MCP server. A value that can be missing
stays optional until checked.

**Check.** Does each new `as`, non-null `!`, `@ts-expect-error` or `@ts-ignore`
carry a comment saying what makes it true? Could a check at run time replace it?

### Q6. Every failure is handled, reported or named.

**Good.** Each `catch` and rejection handler handles the failure (a safe
fallback, or one the owner is told about), reports it, rethrows it, or names the
swallow and its reason, as the `catch` comments in `packages/ledger/src/checks.ts`
do. A function that returns failure as a value returns a closed set, like
`Picked` in `apps/office/src/lib/server/folder-picker.ts`, and its caller handles
each member. An error report keeps a message only when code wrote it, so such a
message is made with `fixedError` (`packages/ledger/src/errors.ts`). A test makes
the callee fail and checks what the owner or the log gets.

**Check.** Which of the four does each new `catch`, `.catch` and status-returning
call do? Is the failure path tested by making the callee fail?

### Q7. Dependencies point one way.

**Good.** Packages import nothing from apps, and apps nothing from each other.
`sprites` imports no other package, `world` builds on `sprites`, and `ledger` on
both. Code the browser loads imports no server-only module: SvelteKit refuses
a `src/lib/server` module or a `*.server.ts` file there. From `@oddboro/ledger`, whose root is server only, the page
imports types alone (`import type`); its values come from browser-safe entries
such as `@oddboro/ledger/access`.

**Check.** Does a new import run from a package into an app, between apps, against
the order above, or from browser code to a server-only value?

### Q8. Tests and guards describe behaviour and fail when it breaks.

**Good.** Tests run on Node's own runner: `npm test -w @oddboro/office` and
`npm test -w @oddboro/ledger`. A test's name is a sentence about behaviour, so the
names read as a spec ("a plain step never holds up Mark done"). A test drives the
real code, never a copy of its logic: a ledger test runs the real queries on the
in-memory database in `packages/ledger/test/pglite.ts`, and an office run test
stands in only for outside tools (`apps/office/src/lib/server/office-under-test.ts`).
Each new test or guard fails with its fix reverted, and a guard with nothing to
check fails. A failing test's assertion changes only when the test was wrong or
an outside constraint forces it (Q1), and the PR body says why.

**Check.** Do the new test names alone say what the change does? Does each new
test fail with its fix reverted? Does a test recompute the code's answer? For each
path through a new guard that passes, name an input that must fail it: does it?

### Q9. Nothing is left behind.

**Good.** No commented-out code, unused export, unreachable branch, debug log,
`TODO` or `FIXME`: open questions, ideas and unstarted work stay out of the repo
(the 2026-11-02 `[meta]` decision). A replacement removes what it replaced, with its flag,
setting, tests and doc lines. A new flag says, beside its declaration, when it can
go. A column or table nothing reads is dropped in a new migration
(`npm run db:generate`).

**Check.** Does anything call each new export? (One the file also calls, exported
so its tests can reach it, is fine.) Does the replaced path still run? Does a
column or table lose its last reader with no drop?

### Q10. A new dependency earns its place.

**Good.** A package is added only when Node, the browser, Svelte or a few lines of
the repo's own code cannot do the job, and the PR body says why. UI frameworks:
hard rule 3.

**Check.** Does a `package.json` or `Cargo.toml` gain a dependency, and does the
PR body say why?

### Q11. Prose stays true when the code changes, and comments say why.

**Good.** Every sentence the change makes false is fixed in the same diff: in a
`CLAUDE.md`, a doc, a decision (followed or superseded in place), the README, a
comment or the PR body. A new comment says why, a constraint or a trap the code
cannot show; it does not restate a value, count or list the code defines. How
prose reads: hard rules 1 and 2. This rule is whether it is true.

**Check.** For each name or value the diff changes, does a grep of the prose find
a sentence left false? Does the code do what each new sentence about it says?
Does a new comment restate the code instead of saying why?

### Q12. Adding one member of a set fails the build wherever it is missed.

**Good.** Every place that must know each member derives from one declaration, or
is a map the type checker makes cover every member. `AGENT_NAMES` is a
`Record<Agent, string>`, so a tool added to `AGENTS` fails `npm run check-types`
until it has a name. Where neither works, one test lists the declaration and every
place. A set the diff creates or reshapes is linked in the same change. Rooms and floor plans:
hard rule 8. A member added to a set not yet linked is added in every place, and
the PR body names in one line the declaration that would link it. A new guard is
one such member: its call in `lint:guards` in the root `package.json` and its line
in `scripts/CLAUDE.md`.

**Check.** When the diff adds a member (a union member, an AI tool, a route, an
env var, a column, a guard), grep an existing member to list each place that must
know the new one. Does each derive from one declaration, or fail without it?

## Reviewing to this standard

- A finding here asks for a change; on its own it does not block the merge. Code
  that is also wrong is a bug, and the review blocks it as one.
- A fix that changes no behaviour lands in the same pull request. A fix that
  changes behaviour gets another look before the merge.
- Every finding shows the better version ("inline this into its one caller",
  "build this map from `AGENTS`"). "This is complex" is not a finding.
- Where a guard or type check could hold a finding and none exists, the finding
  names it as follow-up work for the owner, not a fix for this pull request.
- Code the change did not touch is not its finding, except Q12's missing link: one
  line, never more.
