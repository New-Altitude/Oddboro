# scripts/

Lint guards. Plain Node running TypeScript directly, no dependencies. All run
first in `npm run lint` through `lint:guards`.

- `check-voice.ts`. Fails on em-dashes and stock machine-written phrases in any text file. Add a phrase when one slips through.
- `check-stack.ts`. Fails if any package depends on a UI framework other than Svelte.
- `check-directions.ts`. Fails on physical left and right in Svelte classes, style blocks and CSS.
- `check-context-index.ts`. Fails if a `CLAUDE.md` is missing from its nearest ancestor's index, or if one names a file that does not exist.
- `check-ledger.ts`. Fails if a decision file is misnamed, holds more than one entry, runs over 4,000 bytes, repeats a headline, or reads as provisional.
- `check-private.ts`. Fails if a word from `data/private-words.txt` (personal names and accounts; git ignores the list) appears in any tracked file or file name. Fails when the list is missing, and skips with a notice when `CI` is set. `ODDBORO_PRIVATE_WORDS` points it at another list.
- `check-secrets.ts`. Fails if a tracked file is a key, certificate or `.env` file, holds a private key or an API token in a provider's published shape (Anthropic, OpenAI, GitHub, AWS, Google, Slack, Stripe, Apify, the updater's signing key), or names a home folder (`/Users/<name>/`, `/home/<name>/`; `/Users/Shared` and CI's `runner` pass). It needs no list, so it runs the same in CI.
- `check-platform.ts`. Fails if a `.ts` or `.svelte` source file under `apps/office/src` or `packages/*/src` reads `process.platform` anywhere but `packages/ledger/src/platform.ts`; every other reader calls `currentPlatform()`, so a test that fakes the system reaches it. Tests and comments are left out. So is `apps/desktop/scripts`: those build the app, they are not the office. Fails when `platform.ts` has no read, since then there is nothing to check.
- `check-outbound.ts`. Fails if a file in the office's `src` (`.ts` and `.svelte`), the packages or the desktop app makes a different number of calls by the names it counts than its entry in `outbound.ts` says, if an entry's file has no call, or if it finds no call at all. It counts `fetch(`, `navigator.sendBeacon(`, the connector transports, `WebSocket`, `EventSource` and `XMLHttpRequest` where each is made, `Sentry.init(`, the functions and classes in its `NET_MODULES` (those that open a connection from Node's http, https, http2, tls and net modules, every lookup in `dns` and `dns/promises`, and undici's `request`, `fetch`, `stream`, `pipeline`, `connect`, `upgrade`, `Client` and `Pool`) however they are imported, and the desktop's updater, `reqwest` and Sentry, in text with comments taken out, because the guards take no dependencies. A `net.Socket` counts where it is made, not where it connects. It does not count child processes (`npm install -g`, `grok update --check`, each AI tool's run), what the desktop updater does after `updater_builder`, `require` or `import()`, a call through `dns.promises` or through a name a counted one was copied to, what markup loads (`<img src="https://...">` in a `.svelte` file), or a library's own calls that start from a name it does not list. A new kind of call adds its name here.
- `outbound.ts`. Not a guard: the list `check-outbound.ts` reads. Each entry says where a file's calls go, what they send and whose yes covers them.
- `test-times.ts`. Not a guard: a reporter for Node's test runner. CI's test steps add it through `NODE_OPTIONS`, and it writes one JSON line as each test file starts and ends and as each top-level test finishes, so a hang still shows which file never ended.
- `test-summary.ts`. Not a guard: reads those lines and prints each suite's time, the 20 slowest tests, the 10 slowest files and any file that never ended, to the log and the CI run's summary page.
- `hang-report.ts`. Not a guard: runs a CI test step's command, and if it is still going after the minutes given, records each test process's CPU and state, its JavaScript stack and what keeps it alive (from Node's report on SIGUSR2), and on a Mac its native stack, then stops the step. Windows only runs the command.
- `lib/files.ts`. The shared file list, comment stripper and reporter.

## Later

Each line says what to do when its trigger comes.

- Once no open pull request still grows a code file already over 1,000 lines
  (NEW-1733): add `check-size.ts` at the end of `lint:guards`. It fails when a
  code file (`.ts`, `.js`, `.svelte` or `.rs`, not a test) is over 1,000 lines
  and longer than at the merge base. A file new since the base counts from 0,
  and a renamed one from its old path's length. The base is
  `ODDBORO_SIZE_BASE`, else `origin/main`, and CI's lint step sets it to the
  pull request's. It fails when it cannot find the base or finds no code file
  at all. Record it as a decision and give it its line above.
