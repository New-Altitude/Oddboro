# Review the existing-office upgrade

This stack adds the new workflows to the office already on disk. It does not reset onboarding, recreate the manager or replace goals, jobs, chats or work files. Review each branch against its predecessor, then exercise the combined candidate.

## Order and ownership

The existing shared-work changes, #79 and #80, come first. The repaired draft sequence is #56, #57, #58, #59, #60, #61, #62, #63, then #67. Their original heads and reviews remain. New work follows as [A: #102](https://github.com/New-Altitude/Oddboro/pull/102), [B: #103](https://github.com/New-Altitude/Oddboro/pull/103), [C: #104](https://github.com/New-Altitude/Oddboro/pull/104), [E: #105](https://github.com/New-Altitude/Oddboro/pull/105), [D: #106](https://github.com/New-Altitude/Oddboro/pull/106). E precedes D because delivery retains its runtime gap evidence. Each PR description links a comparison against its immediate predecessor. Review that focused comparison; the main-branch diff includes the earlier PRs.

| Change                | Main place to review                                               | Behavior to check                                                                                                           |
| --------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| A: persona completion | `persona-run.ts`, ledger `persona-consultations.ts`                | Required judgment needs an authentic answer. A voice retry reuses preparation.                                              |
| B: persona recovery   | `persona-requests.ts`, `personas.ts`, `ChatPersonaRequests.svelte` | Explicitly map the owner's request to an offered persona. Preserve the existing Odd and continuation; clear carried grants. |
| C: project review     | `project-reviews.ts`, `ProjectReviews.svelte`, project controller  | Preview exact source, preserve its revision, return the complete answer to the same native conversation.                    |
| E: runtime evidence   | desktop `runtime.rs`, ledger `runtime.ts`, `jobs.ts`               | Report observed native state and clock gaps. Unknown causes stay unknown.                                                   |
| D: daily result       | ledger and server `scheduled-results.ts`, `scheduled-delivery.ts`  | Join existing jobs, check current review evidence, preserve one edition and bound recovery and sending.                     |

Each feature has a focused guide: `persona-recovery.md`, `project-reviews.md`, `runtime-evidence.md`, and `scheduled-results.md`. The persona completion decision and consultation module describe A's saved preparation and answer.

## Upgrade preservation

`packages/ledger/test/upgrade-preservation.test.ts` starts with the released 0.0.10 migration set, verified against its recorded hashes. It populates existing staff, goals, memberships, jobs, run history, open setup requests, checked task steps, an exact owner answer, grants, reports, shared work and files.

The test runs the real database startup and migration path in a separate process, restarts it twice, and compares every pre-existing column and file. New workflow tables must remain empty: database migration itself must not launch work. The test also opens the supported pre-upgrade backup and checks the original rows. The fixture contains no personal office data, credentials or external destinations.

To check an existing office, take a consistent read-only database export and copy its work files into a private disposable folder. Restore the release schema there and run only the same database worker. Never start app hooks, schedules, follow-up watchers or delivery from a copied personal office. Keep the export and full records out of this repository. Compare row and file counts and hashes; publish only the validation summary the owner permits.

## Combined checks

Run root lint, types and formatting, then build the office. The affected office tests cover durable chat, exact task responses, failures, persona preparation, connection recovery, native project review, current file exchange and delivery. Ledger tests cover transactional claims, migration order and live notifications. The real-clock file test uses the actual file server and controlled model and Gmail services.

An isolated browser walkthrough should open an existing goal, its original native session and latest result; open a saved manager conversation and its unresolved persona request; answer a task with exact wording; inspect packaged runtime evidence; and save a recovery allowance on the existing producer job. This proves the controls are reachable. It does not replace a live provider or installed-app lifecycle check.

## Release checks still required

Before upgrading a real office, complete the release, platform and installed-app checks from #81, #83 and #84, alongside the improved approval wording in #98. Use a disposable installed app to check native login startup, window close, server restart and restart limit, suspend and wake, network interruption and update restart on the supported systems.

Then verify authentic persona consent and native provider sessions through the supported flows. Finally observe seven consecutive newsroom deadlines and actual receipt at the chosen destination. Keep unanswered consultations, unknown delivery and historical runtime gaps visible. Neither passing fixtures nor a provider message ID establishes these live outcomes.
