# Explain an office runtime gap

Setup and the read-only `office_runtime` tool show the app's recorded startup, server state, login setting, sleep-prevention request and clock checks. They distinguish an unexplained gap from a proven shutdown. They do not establish continuous research coverage or delivery.

## Review the change

1. The desktop's `runtime.rs` writes a bounded local record when the existing shell starts, checks or changes Open at login, starts Node, receives its first response, plans a restart, reaches its restart limit or observes a clean exit after a requested quit. `server.rs` still owns supervision and sleep prevention.
2. `packages/ledger/src/runtime.ts` reads only declared fields from that record. The existing job clock supplies its last successful check and next expected check. A check more than a minute late records a gap from the expected check to the next successful check. The gap's cause stays unknown. A ten-minute idle timer is expected, not an outage.
3. `jobs.ts` keeps one timer. A failed database read now records a failed check and schedules its next attempt after thirty seconds. Writing diagnostic evidence cannot stop the clock. Restart uses the existing stale-run and due-job handling; no second scheduler is added.
4. `checkService` in a packaged app reports the shell's Open at login setting. It no longer prescribes the repository development-service command. `RuntimeStatus.svelte` shows the record in Setup; Refresh reads it again. The manager's current capability brief names the read-only tool.

The files live under the office home in `runtime/desktop.json` and `runtime/clock.json`. They contain no chats, work files, log text, credentials or remote destinations. The shell retains forty event names; the clock retains forty gaps. A malformed, missing or oversized record is unknown. These files supplement the existing database and logs; they do not copy office records.

## What the evidence means

On a Mac, a successful `caffeinate -s -w` spawn records a request for AC-only sleep prevention. Its exit is recorded. On Linux, a successful `systemd-inhibit` spawn records a request. On Windows, the result of `SetThreadExecutionState` records whether the request was accepted. A request is not proof that a lid close, explicit sleep or power loss was prevented. A different Node process cannot inherit an old process's request.

A clean shutdown means the shell requested a quit and observed Node exit successfully. It does not mean every unfinished job completed. A clock gap alone cannot identify sleep, power loss, a blocked event loop or a database outage. The shell's separate events may establish a restart or shutdown. No additional OS sleep listener is installed, so an unexplained gap remains unexplained.

## Checks and release walkthrough

The runtime tests cover expected idle time, a late check through restart, a failed check and recovery, stale process evidence, bounded records and packaged setup data for Mac, Windows and Linux. A real Read-level MCP client verifies that inspecting the runtime changes no checkpoint. The scheduler's existing two-job file-exchange test still runs its real clock. Rust tests cover bounded event history and unknown login state; the full Mac Rust suite also runs.

Before shipping, use a disposable installed office on each supported system. Close and reopen its window, stop Node and observe restart, exhaust the restart allowance, change Open at login, suspend and resume, interrupt the network, and restart during an update. Compare the runtime record with the native shell log. The fixture checks do not replace those installed-app walkthroughs. Release build and health checks in PRs #81 and #84 remain separate prerequisites.

There is no database migration or change to existing goals, jobs, chats, permissions or files. This release does not provide an always-on host for periods when the owner's computer is unavailable.
