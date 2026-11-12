# B4 hand-off (W2a, the office guard asks for the owner's key)

Builder 1 stopped at the 200K hand-off point. Read this, then the brief
(common.md, w2a-common.md, w2a-b4.md). Delete this file before the last commit.

## Head

See `git log -1` on `root-fixes-b4`: one commit on f421b4b, "work in progress"
for the slice below. It is NOT a green slice: `owner-page.test.ts` still holds
its old tests, several of which assert today's header trust and now fail by
design. Rewriting that file is the first job.

## Done

- `owner-page.ts`: `guardOffice` per plan 2.1 steps 1 to 6. `provesItself`
  runs steps 1 to 3 only when `isExceptionPath(event.url.pathname)`;
  `withoutKey` builds the 303 (`Location` with leading `/` and `\` folded to
  one `/`, `OWNER_PARAM` dropped via URLSearchParams); `notTheOwner` picks
  `NOT_THE_OWNER_TEXT` under `/api/`, else `NOT_THE_OWNER_PAGE` as
  text/html. Header comment rewritten. Its own refusal text is gone.
- `gateway.ts`: `GATEWAY_PATH` now imported from `@oddboro/ledger/owner-key`
  (line 45 removed). NOT re-exported: after this change nothing imports it from
  gateway.ts (`git grep -n GATEWAY_PATH`), so a re-export would be an unused
  export (code standard Q9). Say so in the report as a deviation from the
  brief's "re-exports".
- `hooks.server.ts`: `init` calls `ownerKey()` first, with the why; header
  comment updated.
- `route-ids.ts` (new): `ROUTES` and `routeIds`, moved from
  owner-actions.test.ts, which now imports both (ROUTES moved too, one home).
- `diagnostics-harness.ts`: `PAGE` is now async `page()` (dynamic import of
  owner-key after tempOffice). All seven importers changed. account.test.ts
  aliases it `ownerPage` (it already has a `page` const, the root page
  module). diagnostics.test.ts joins its own cookie to the owner's and now
  also checks the key never reaches a report. persona.test.ts: `call`'s GET
  default sends `page()`; the personas GET test sends the cookie with
  cross-site headers (so the route's own check is what refuses) and "a client
  that says nothing" became "a client with only the key".

## Left (brief order)

1. Fix the guard-test files still red. Builder 1's single-file runs (G-office-one,
   logs `one-<file>.log` in the scratchpad `b4/` folder, counts by
   `grep -E '^ℹ (pass|fail)'`), BEFORE the two name-clash fixes:
   account-reports 1/0, diagnostics-new-altitude 2/0, persona 16/0 (pass/fail);
   account 0/1 and diagnostics-unset 0/1 were a `page` name clash with the
   root page module, fixed after (aliased `ownerPage`), not re-run;
   diagnostics-account 2/4, diagnostics-idle 0/1, diagnostics-own 1/2,
   diagnostics-private 5/1, diagnostics 4/8 still red. Likely cause, not yet
   confirmed: `sender` requests with no headers (GETs, `send({ route })`) now
   carry no cookie and get 403, so reports the tests wait 30 s for never come.
   Fix by sending `await page()` (or its cookie) where those tests act as the
   page, never by loosening the guard. A test whose point is a refusal (for
   example diagnostics.test.ts "a request the guard refuses never reaches the
   relay or Sentry") must keep refusing: read it before changing it.
2. `owner-page.test.ts`: make `send` build `event.url` as Kit does (import
   Kit's own `src/pathname.js` by file URL from
   `createRequire(import.meta.url).resolve('@sveltejs/kit/package.json')`; it
   has no imports; strip `/__route.js` or `/__data.json` with
   `has_*`/`strip_*`), return headers too. Existing tests that act as the
   page add `cookie: ownerCookie()`; "reads pass without saying where they
   come from" sends the cookie (its premise, reads without the key, is what
   the plan removes; A1 and A7 assert the opposite). Then add A1 to A7, A28,
   A29 per PLAN 3.8. Route counts at base: 69 `+server.ts`, 3
   `+page.server.ts`. A29 'passes' rows: pick the prover by Kit's path
   (UPDATE_PATH: shell token; `isGatewayPath`: a run token from
   `openGateway`; OWN_PROOF: GET); 'unparsed': `assert.throws(new Request)`.
3. `owner-key-init.test.ts` (A27): `tempOffice`, then mock
   `@oddboro/ledger/upgrade` as `{ ...real, bringUpToDate: reject sentinel }`
   and delete `ODDBORO_LOCAL_DB` (tempOffice sets it; with it, init starts a
   real database). Import hooks, `await assert.rejects(init(), sentinel)`,
   then the key file exists and matches `/^[A-Za-z0-9_-]{43}$/`. Only hooks
   imports `@oddboro/ledger/upgrade` in that graph (grep checked), so the
   spread mock is safe.
4. `desktop-names.test.ts` (A11 Rust half): main.rs holds `"oddboro-key"`
   (`OWNER_PARAM`, line 39), env.rs holds `"owner-key"` (`OWNER_KEY_FILE`,
   line 37). Build both strings from the imports.
5. Mutations (brief Check 4), A28 timing, all gates, full suites under the lock.

## Checks already answered

- Check 1, `git grep -ln "guardOffice\|hooks.server\|sender(\|diagnostics-harness" f421b4b -- 'apps/office/src/**/*.test.ts'`:
  11 files (account-reports, account, diagnostics-account, -idle,
  -new-altitude, -own, -private, -unset, diagnostics, owner-page, persona).
- Check 2, `git grep -n "fetch(" HEAD -- 'apps/office/src/routes/**/+page.server.ts'`:
  0 hits (exit 1); `grep -rn fetch` over all three page loads and layouts:
  0 too, so no load calls `fetch`.
- Check 3: root `+layout.svelte` only imports app.css; CallbackCard makes no
  request; logo.png and `_app/` files are served by adapter-node's
  `serve_static` before Kit (handler.js:188). No request from the callback
  pages reaches the guard in a release, so the layout is unchanged. In dev
  those files go through `ownerOnly` (B10's), not this guard.

## Notes for the report

- `apps/office/CLAUDE.md` "Who the office answers" (about lines 1420-1447) now
  describes header trust as the gate: false after this change. W4 owns it.
- `routes/api/personas/+server.ts:13` restates `NOT_THE_OWNER_TEXT`; not mine.
- Gates run so far: `npm run check-types -w @oddboro/office` exit 0 (svelte-check 3267 files, 0 errors), run before the diagnostics-unset alias fix. No full gate, no suite.
